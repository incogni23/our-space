// Package notes owns letters between the two of you (NoteLetter, 4.3).
//
// Rules, enforced here rather than in the UI:
//   - the recipient never receives a note's body before it is delivered; while it
//     waits they see only who it's from and when it opens
//   - the author sees when a delivered note was read (product decision, replacing
//     the canvas's "never Opened"); the reader is told the author will see it
package notes

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/jobs"
	"betweenus/api/internal/store"
)

var (
	ErrNotFound   = errors.New("notes: not found")
	ErrInvalid    = errors.New("notes: invalid input")
	ErrInPast     = errors.New("notes: time is in the past")
	ErrNoPartner  = errors.New("notes: nobody to write to")
	ErrDelivered  = errors.New("notes: already delivered")
	ErrNotAuthor  = errors.New("notes: only the writer can change this")
	ErrNotForThem = errors.New("notes: only the recipient can do this")
)

const JobDeliver = "note.deliver"

type Service struct {
	pool *pgxpool.Pool
	Now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool, Now: time.Now} }

type Scope struct{ SpaceID, UserID uuid.UUID }

// View is a note as one person may see it.
type View struct {
	ID          uuid.UUID
	Mine        bool
	State       string // draft | scheduled | waiting | delivered
	Body        *string
	DeliverAt   *time.Time
	DeliverTz   *string
	DeliveredAt *time.Time
	ReadAt      *time.Time // author: when the recipient first opened it
	Opened      *bool      // recipient only
	Kept        *bool      // recipient only
	CreatedAt   time.Time
}

func view(n store.Note, me uuid.UUID) View {
	v := View{ID: n.ID, Mine: n.AuthorID == me, State: n.State, DeliverAt: n.DeliverAt, DeliverTz: n.DeliverTz, DeliveredAt: n.DeliveredAt, CreatedAt: n.CreatedAt}
	switch {
	case v.Mine:
		b := n.Body
		v.Body = &b
		if n.State == "delivered" {
			v.ReadAt = n.OpenedAt
		}
	case n.State == "delivered":
		b, opened, kept := n.Body, n.OpenedAt != nil, n.Kept
		v.Body, v.Opened, v.Kept = &b, &opened, &kept
	default:
		v.State = "waiting" // sealed: who and when only
	}
	return v
}

type Write struct {
	Body     string
	When     string // draft | now | at
	Local    string // "2006-01-02T15:04" when When == "at"
	TimeZone string
}

func (s *Service) resolveWhen(in Write) (state string, at *time.Time, tz *string, err error) {
	now := s.Now()
	switch in.When {
	case "draft":
		return "draft", nil, nil, nil
	case "now":
		return "scheduled", &now, nil, nil
	case "at":
		l, err := time.LoadLocation(in.TimeZone)
		if err != nil || in.TimeZone == "" || len(in.TimeZone) > 64 {
			return "", nil, nil, ErrInvalid
		}
		t, err := time.ParseInLocation("2006-01-02T15:04", strings.TrimSpace(in.Local), l)
		if err != nil {
			return "", nil, nil, ErrInvalid
		}
		if t.Before(now.Add(-time.Minute)) {
			return "", nil, nil, ErrInPast
		}
		if t.After(now.AddDate(2, 0, 0)) {
			return "", nil, nil, ErrInvalid
		}
		tzc := in.TimeZone
		return "scheduled", &t, &tzc, nil
	}
	return "", nil, nil, ErrInvalid
}

func cleanBody(b string) (string, error) {
	b = strings.TrimSpace(b)
	if n := utf8.RuneCountInString(b); n < 1 || n > 2000 {
		return "", ErrInvalid
	}
	return b, nil
}

func dedupe(id uuid.UUID) string { return JobDeliver + ":" + id.String() }

func (s *Service) Create(ctx context.Context, sc Scope, in Write) (View, error) {
	body, err := cleanBody(in.Body)
	if err != nil {
		return View{}, err
	}
	state, at, tz, err := s.resolveWhen(in)
	if err != nil {
		return View{}, err
	}
	var n store.Note
	err = s.inTx(ctx, func(q *store.Queries) error {
		others, err := q.OtherMembers(ctx, store.OtherMembersParams{RelationshipID: sc.SpaceID, UserID: sc.UserID})
		if err != nil {
			return err
		}
		if len(others) == 0 {
			return ErrNoPartner
		}
		n, err = q.CreateNote(ctx, store.CreateNoteParams{
			RelationshipID: sc.SpaceID, AuthorID: sc.UserID, RecipientID: others[0],
			Body: body, State: state, DeliverAt: at, DeliverTz: tz,
		})
		if err != nil {
			return err
		}
		if state == "scheduled" {
			return jobs.Enqueue(ctx, q, JobDeliver, map[string]string{"noteId": n.ID.String()}, *at, dedupe(n.ID))
		}
		return nil
	})
	return view(n, sc.UserID), err
}

func (s *Service) Update(ctx context.Context, sc Scope, id uuid.UUID, in Write) (View, error) {
	body, err := cleanBody(in.Body)
	if err != nil {
		return View{}, err
	}
	state, at, tz, err := s.resolveWhen(in)
	if err != nil {
		return View{}, err
	}
	var n store.Note
	err = s.inTx(ctx, func(q *store.Queries) error {
		cur, err := q.GetNoteForUpdate(ctx, store.GetNoteForUpdateParams{ID: id, RelationshipID: sc.SpaceID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if cur.AuthorID != sc.UserID {
			return ErrNotAuthor
		}
		if cur.State == "delivered" {
			return ErrDelivered
		}
		if n, err = q.UpdateNote(ctx, store.UpdateNoteParams{ID: id, RelationshipID: sc.SpaceID, Body: body, State: state, DeliverAt: at, DeliverTz: tz}); err != nil {
			return err
		}
		if err := jobs.Cancel(ctx, q, dedupe(id)); err != nil {
			return err
		}
		if state == "scheduled" {
			return jobs.Enqueue(ctx, q, JobDeliver, map[string]string{"noteId": id.String()}, *at, dedupe(id))
		}
		return nil
	})
	return view(n, sc.UserID), err
}

func (s *Service) Delete(ctx context.Context, sc Scope, id uuid.UUID) error {
	return s.inTx(ctx, func(q *store.Queries) error {
		n, err := q.DeleteNote(ctx, store.DeleteNoteParams{ID: id, RelationshipID: sc.SpaceID, UserID: sc.UserID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return jobs.Cancel(ctx, q, dedupe(id))
	})
}

func (s *Service) List(ctx context.Context, sc Scope) ([]View, error) {
	rows, err := store.New(s.pool).NotesFor(ctx, store.NotesForParams{RelationshipID: sc.SpaceID, UserID: sc.UserID})
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(rows))
	for _, n := range rows {
		out = append(out, view(n, sc.UserID))
	}
	return out, nil
}

// Get returns one note. Opening a delivered note as its recipient marks it read;
// firstRead reports that this call did so (the author is then told).
func (s *Service) Get(ctx context.Context, sc Scope, id uuid.UUID) (View, error) {
	q := store.New(s.pool)
	n, err := q.GetNote(ctx, store.GetNoteParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	if n.AuthorID != sc.UserID && n.RecipientID != sc.UserID {
		return View{}, ErrNotFound
	}
	if n.RecipientID == sc.UserID && n.State == "draft" {
		return View{}, ErrNotFound
	}
	return view(n, sc.UserID), nil
}

// Open records that the recipient broke the seal: this is the moment the writer
// sees as "Read". Opening twice keeps the first time.
func (s *Service) Open(ctx context.Context, sc Scope, id uuid.UUID) (v View, firstRead bool, err error) {
	v, err = s.Get(ctx, sc, id)
	if err != nil {
		return View{}, false, err
	}
	if v.Mine || v.State != "delivered" || (v.Opened != nil && *v.Opened) {
		return v, false, nil
	}
	if err := store.New(s.pool).OpenNote(ctx, store.OpenNoteParams{ID: id, RecipientID: sc.UserID}); err != nil {
		return View{}, false, err
	}
	opened := true
	v.Opened = &opened
	return v, true, nil
}

func (s *Service) Keep(ctx context.Context, sc Scope, id uuid.UUID, keep bool) error {
	n, err := store.New(s.pool).GetNote(ctx, store.GetNoteParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && n.RecipientID != sc.UserID) {
		return ErrNotForThem
	}
	if err != nil {
		return err
	}
	return store.New(s.pool).KeepNote(ctx, store.KeepNoteParams{ID: id, RecipientID: sc.UserID, Kept: keep})
}

// Deliver is the job handler body: returns the delivered note, or ok=false if it
// was edited, taken back or already delivered.
func (s *Service) Deliver(ctx context.Context, id uuid.UUID) (store.Note, bool, error) {
	n, err := store.New(s.pool).DeliverNote(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Note{}, false, nil
	}
	return n, err == nil, err
}

func (s *Service) inTx(ctx context.Context, fn func(q *store.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(store.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
