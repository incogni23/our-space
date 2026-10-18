// Package boards owns boards and pins (canvas C1–C3). Everything is scoped to the
// caller's active space; nothing is ever addressable across spaces.
package boards

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
)

var (
	ErrNoActiveSpace = errors.New("boards: no active space")
	ErrNotFound      = errors.New("boards: not found")
	ErrInvalid       = errors.New("boards: invalid input")
	ErrBoardRequired = errors.New("boards: choose a board")
)

type Service struct {
	pool *pgxpool.Pool
	Now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, Now: time.Now}
}

// Space is the caller's active space, resolved once per request.
type Space struct {
	ID            uuid.UUID
	Name          string
	UserID        uuid.UUID
	ReadOnly      bool
	ReadOnlyUntil *time.Time
	Palette       string
}

func (s *Service) Resolve(ctx context.Context, userID uuid.UUID) (Space, error) {
	row, err := store.New(s.pool).ActiveSpaceFor(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Space{}, ErrNoActiveSpace
	}
	if err != nil {
		return Space{}, err
	}
	return Space{ID: row.ID, Name: row.Name, UserID: userID}, nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func clean(s string, min, max int) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < min || n > max {
		return "", ErrInvalid
	}
	return s, nil
}

func (s *Service) ListBoards(ctx context.Context, sp Space) ([]store.ListBoardsRow, error) {
	return store.New(s.pool).ListBoards(ctx, sp.ID)
}

func (s *Service) CreateBoard(ctx context.Context, sp Space, name string) (store.Board, error) {
	name, err := clean(name, 1, 60)
	if err != nil {
		return store.Board{}, err
	}
	return store.New(s.pool).CreateBoard(ctx, store.CreateBoardParams{RelationshipID: sp.ID, Name: name, CreatedBy: sp.UserID})
}

type BoardWithPins struct {
	Board store.Board
	Pins  []store.Pin
}

func (s *Service) Board(ctx context.Context, sp Space, id uuid.UUID) (BoardWithPins, error) {
	q := store.New(s.pool)
	b, err := q.GetBoard(ctx, store.GetBoardParams{ID: id, RelationshipID: sp.ID})
	if err != nil {
		return BoardWithPins{}, notFound(err)
	}
	pins, err := q.ListPins(ctx, store.ListPinsParams{BoardID: id, RelationshipID: sp.ID})
	if err != nil {
		return BoardWithPins{}, err
	}
	return BoardWithPins{Board: b, Pins: pins}, nil
}

type NewPin struct {
	Text         string // a link, or any words for an idea
	Title        string // optional
	Note         string // "why are you saving it?"
	BoardID      *uuid.UUID
	NewBoardName string
}

// classify turns what was typed into a kind, a canonical URL and a default title.
func classify(text string) (kind string, link *string, title string) {
	t := strings.TrimSpace(text)
	if strings.ContainsAny(t, " \n\t") || !strings.Contains(t, ".") {
		return "idea", nil, t
	}
	raw := t
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || !strings.Contains(u.Host, ".") || (u.Scheme != "https" && u.Scheme != "http") {
		return "idea", nil, t
	}
	u.Fragment = ""
	canon := u.String()
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	switch {
	case host == "maps.app.goo.gl" || host == "maps.apple.com" || host == "goo.gl" && strings.HasPrefix(u.Path, "/maps") ||
		strings.HasPrefix(host, "google.") && strings.HasPrefix(u.Path, "/maps") || host == "maps.google.com":
		kind = "place"
	case host == "open.spotify.com" || host == "music.apple.com" || host == "music.youtube.com" || host == "soundcloud.com":
		kind = "song"
	default:
		kind = "link"
	}
	return kind, &canon, host
}

var defaultBoard = map[string]string{"place": "Places", "song": "Songs", "link": "Ideas", "idea": "Ideas"}

// CreatePin saves something for both of you. The first save creates the first board.
func (s *Service) CreatePin(ctx context.Context, sp Space, in NewPin) (store.Pin, error) {
	if _, err := clean(in.Text, 1, 2000); err != nil {
		return store.Pin{}, err
	}
	note, err := clean(in.Note, 0, 1000)
	if err != nil {
		return store.Pin{}, err
	}
	kind, link, title := classify(in.Text)
	if t := strings.TrimSpace(in.Title); t != "" {
		title = t
	}
	if title, err = clean(title, 1, 200); err != nil {
		return store.Pin{}, err
	}

	var pin store.Pin
	err = s.inTx(ctx, func(q *store.Queries) error {
		var boardID uuid.UUID
		switch {
		case strings.TrimSpace(in.NewBoardName) != "":
			name, err := clean(in.NewBoardName, 1, 60)
			if err != nil {
				return err
			}
			b, err := q.CreateBoard(ctx, store.CreateBoardParams{RelationshipID: sp.ID, Name: name, CreatedBy: sp.UserID})
			if err != nil {
				return err
			}
			boardID = b.ID
		case in.BoardID != nil:
			b, err := q.GetBoard(ctx, store.GetBoardParams{ID: *in.BoardID, RelationshipID: sp.ID})
			if err != nil {
				return notFound(err)
			}
			boardID = b.ID
		default:
			existing, err := q.ListBoards(ctx, sp.ID)
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				return ErrBoardRequired
			}
			b, err := q.CreateBoard(ctx, store.CreateBoardParams{RelationshipID: sp.ID, Name: defaultBoard[kind], CreatedBy: sp.UserID})
			if err != nil {
				return err
			}
			boardID = b.ID
		}
		pin, err = q.CreatePin(ctx, store.CreatePinParams{
			RelationshipID: sp.ID, BoardID: boardID, CreatedBy: sp.UserID,
			Kind: kind, Title: title, Url: link, Note: note,
		})
		return err
	})
	return pin, err
}

type PinDetail struct {
	Pin   store.GetPinRow
	Notes []store.ListPinNotesRow
}

func (s *Service) Pin(ctx context.Context, sp Space, id uuid.UUID) (PinDetail, error) {
	q := store.New(s.pool)
	p, err := q.GetPin(ctx, store.GetPinParams{ID: id, RelationshipID: sp.ID})
	if err != nil {
		return PinDetail{}, notFound(err)
	}
	notes, err := q.ListPinNotes(ctx, id)
	if err != nil {
		return PinDetail{}, err
	}
	return PinDetail{Pin: p, Notes: notes}, nil
}

type PinUpdate struct {
	Title   *string
	Note    *string
	Status  *string
	BoardID *uuid.UUID
}

var statuses = map[string]bool{"saved": true, "planned": true, "done": true, "remembered": true}

func (s *Service) UpdatePin(ctx context.Context, sp Space, id uuid.UUID, in PinUpdate) (store.Pin, error) {
	q := store.New(s.pool)
	if in.Title != nil {
		t, err := clean(*in.Title, 1, 200)
		if err != nil {
			return store.Pin{}, err
		}
		in.Title = &t
	}
	if in.Note != nil {
		n, err := clean(*in.Note, 0, 1000)
		if err != nil {
			return store.Pin{}, err
		}
		in.Note = &n
	}
	if in.Status != nil && !statuses[*in.Status] {
		return store.Pin{}, ErrInvalid
	}
	if in.BoardID != nil {
		if _, err := q.GetBoard(ctx, store.GetBoardParams{ID: *in.BoardID, RelationshipID: sp.ID}); err != nil {
			return store.Pin{}, notFound(err)
		}
	}
	p, err := q.UpdatePin(ctx, store.UpdatePinParams{
		ID: id, RelationshipID: sp.ID, Title: in.Title, Note: in.Note, Status: in.Status, BoardID: in.BoardID,
	})
	return p, notFound(err)
}

func (s *Service) DeletePin(ctx context.Context, sp Space, id uuid.UUID) error {
	n, err := store.New(s.pool).DeletePin(ctx, store.DeletePinParams{ID: id, RelationshipID: sp.ID})
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Service) RestorePin(ctx context.Context, sp Space, id uuid.UUID) error {
	n, err := store.New(s.pool).RestorePin(ctx, store.RestorePinParams{ID: id, RelationshipID: sp.ID})
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Service) AddNote(ctx context.Context, sp Space, pinID uuid.UUID, body string) (store.PinNote, error) {
	body, err := clean(body, 1, 1000)
	if err != nil {
		return store.PinNote{}, err
	}
	q := store.New(s.pool)
	if _, err := q.GetPin(ctx, store.GetPinParams{ID: pinID, RelationshipID: sp.ID}); err != nil {
		return store.PinNote{}, notFound(err)
	}
	return q.CreatePinNote(ctx, store.CreatePinNoteParams{PinID: pinID, AuthorID: sp.UserID, Body: body})
}

// RecentFromPartner: what the other person saved in the last two weeks (B1 "New from Dev").
func (s *Service) RecentFromPartner(ctx context.Context, sp Space) ([]store.RecentPinsByRow, error) {
	q := store.New(s.pool)
	others, err := q.OtherMembers(ctx, store.OtherMembersParams{RelationshipID: sp.ID, UserID: sp.UserID})
	if err != nil || len(others) == 0 {
		return nil, err
	}
	return q.RecentPinsBy(ctx, store.RecentPinsByParams{
		RelationshipID: sp.ID, CreatedBy: others[0], CreatedAt: s.Now().Add(-14 * 24 * time.Hour),
	})
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

// ResolveRead is the space a user may read: their active space, or a closed one
// still inside its read-only window.
func (s *Service) ResolveRead(ctx context.Context, userID uuid.UUID) (Space, error) {
	row, err := store.New(s.pool).ReadableSpaceFor(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Space{}, ErrNoActiveSpace
	}
	if err != nil {
		return Space{}, err
	}
	return Space{ID: row.ID, Name: row.Name, UserID: userID, ReadOnly: row.Status != "active", ReadOnlyUntil: row.ReadOnlyUntil, Palette: row.Palette}, nil
}
