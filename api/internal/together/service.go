// Package together runs Together v1 (5.4 #04): a shared start, a shared pause and
// messages while you each play the same thing in your own app.
//
// The session (what, status, position) is stored. Who is "here" lives only in
// memory, only for the session, and is never recorded: per 5.4 there is no
// global presence. Messages are never stored; they vanish with the session.
//
// Single instance for now: presence and messages fan out in-process.
package together

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
)

var (
	ErrNotFound    = errors.New("together: not found")
	ErrInvalid     = errors.New("together: invalid input")
	ErrAlreadyOpen = errors.New("together: a session is already open")
	ErrEnded       = errors.New("together: session ended")
	ErrNotBothHere = errors.New("together: waiting for both of you")
)

const (
	startCountdown = 3 * time.Second
	dropGrace      = 10 * time.Second
	HoldPlace      = 5 * time.Minute
)

type Scope struct{ SpaceID, UserID uuid.UUID }

// Event is what a connected client receives.
type Event struct {
	Type    string            `json:"type"` // state | message
	Session *Snapshot         `json:"session,omitempty"`
	Message *Message          `json:"message,omitempty"`
	Here    []string          `json:"here,omitempty"`
	Extra   map[string]string `json:"extra,omitempty"`
}

type Message struct {
	From string    `json:"from"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

type Snapshot struct {
	ID           string     `json:"id"`
	StartedBy    string     `json:"startedBy"`
	Title        string     `json:"title"`
	URL          *string    `json:"url,omitempty"`
	Status       string     `json:"status"`
	PositionMs   int64      `json:"positionMs"`
	PositionAt   time.Time  `json:"positionAt"`
	PausedReason *string    `json:"pausedReason,omitempty"`
	UpdatedBy    *string    `json:"updatedBy,omitempty"`
	EndedAt      *time.Time `json:"endedAt,omitempty"`
	ServerNow    time.Time  `json:"serverNow"`
}

func snapshot(s store.TogetherSession, now time.Time) *Snapshot {
	var by *string
	if s.UpdatedBy != nil {
		v := s.UpdatedBy.String()
		by = &v
	}
	return &Snapshot{
		ID: s.ID.String(), StartedBy: s.StartedBy.String(), Title: s.Title, URL: s.Url, Status: s.Status,
		PositionMs: s.PositionMs, PositionAt: s.PositionAt, PausedReason: s.PausedReason, UpdatedBy: by,
		EndedAt: s.EndedAt, ServerNow: now,
	}
}

// position is where playback is now.
func position(s store.TogetherSession, now time.Time) int64 {
	if s.Status != "playing" || now.Before(s.PositionAt) {
		return s.PositionMs
	}
	return s.PositionMs + now.Sub(s.PositionAt).Milliseconds()
}

type room struct {
	here  map[uuid.UUID]int // connections per person
	subs  map[chan Event]struct{}
	drops map[uuid.UUID]*time.Timer
}

type Service struct {
	pool  *pgxpool.Pool
	Now   func() time.Time
	mu    sync.Mutex
	rooms map[uuid.UUID]*room
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, Now: time.Now, rooms: map[uuid.UUID]*room{}}
}

func (s *Service) roomFor(id uuid.UUID) *room {
	r := s.rooms[id]
	if r == nil {
		r = &room{here: map[uuid.UUID]int{}, subs: map[chan Event]struct{}{}, drops: map[uuid.UUID]*time.Timer{}}
		s.rooms[id] = r
	}
	return r
}

func (s *Service) hereList(id uuid.UUID) ([]string, int) {
	r := s.rooms[id]
	if r == nil {
		return []string{}, 0
	}
	out := []string{}
	for u, n := range r.here {
		if n > 0 {
			out = append(out, u.String())
		}
	}
	return out, len(out)
}

func (s *Service) broadcast(id uuid.UUID, ev Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.rooms[id]
	if r == nil {
		return
	}
	if ev.Type == "state" {
		ev.Here, _ = s.hereList(id)
	}
	for ch := range r.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}

func (s *Service) broadcastState(sess store.TogetherSession, extra map[string]string) {
	s.broadcast(sess.ID, Event{Type: "state", Session: snapshot(sess, s.Now()), Extra: extra})
}

func cleanURL(raw string) (*string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || len(raw) > 2048 || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, ErrInvalid
	}
	s := u.String()
	return &s, nil
}

// Start opens a session; if one is already open, it returns that one with ErrAlreadyOpen.
func (s *Service) Start(ctx context.Context, sc Scope, title, rawURL string) (store.TogetherSession, error) {
	title = strings.TrimSpace(title)
	if n := utf8.RuneCountInString(title); n < 1 || n > 120 {
		return store.TogetherSession{}, ErrInvalid
	}
	u, err := cleanURL(rawURL)
	if err != nil {
		return store.TogetherSession{}, err
	}
	q := store.New(s.pool)
	sess, err := q.CreateTogether(ctx, store.CreateTogetherParams{RelationshipID: sc.SpaceID, StartedBy: sc.UserID, Title: title, Url: u})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		open, err := q.OpenTogether(ctx, sc.SpaceID)
		if err != nil {
			return store.TogetherSession{}, err
		}
		return open, ErrAlreadyOpen
	}
	return sess, err
}

func (s *Service) Current(ctx context.Context, sc Scope) (*store.TogetherSession, error) {
	sess, err := store.New(s.pool).OpenTogether(ctx, sc.SpaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

func (s *Service) Get(ctx context.Context, sc Scope, id uuid.UUID) (*Snapshot, []string, error) {
	sess, err := store.New(s.pool).GetTogether(ctx, store.GetTogetherParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	s.mu.Lock()
	here, _ := s.hereList(id)
	s.mu.Unlock()
	return snapshot(sess, s.Now()), here, nil
}

// Act applies start | pause | resume | seek | end, for both people.
func (s *Service) Act(ctx context.Context, sc Scope, id uuid.UUID, action string, seekMs int64) (store.TogetherSession, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return store.TogetherSession{}, err
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)
	cur, err := q.GetTogetherForUpdate(ctx, store.GetTogetherForUpdateParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return store.TogetherSession{}, ErrNotFound
	}
	if err != nil {
		return store.TogetherSession{}, err
	}
	if cur.Status == "ended" {
		return store.TogetherSession{}, ErrEnded
	}
	now := s.Now()
	me := sc.UserID
	p := store.SetTogetherStateParams{ID: id, RelationshipID: sc.SpaceID, Status: cur.Status, PositionMs: position(cur, now), PositionAt: now, UpdatedBy: &me}
	switch action {
	case "start", "resume":
		if cur.Status == "playing" {
			return cur, nil
		}
		s.mu.Lock()
		_, n := s.hereList(id)
		s.mu.Unlock()
		if n < 2 {
			return store.TogetherSession{}, ErrNotBothHere
		}
		p.Status = "playing"
		p.PositionAt = now.Add(startCountdown) // a shared 3-2-1, then press play together
	case "pause":
		if cur.Status != "playing" {
			return cur, nil
		}
		reason := "someone"
		p.Status, p.PausedReason = "paused", &reason
	case "seek":
		if seekMs < 0 || seekMs > 24*3600*1000 {
			return store.TogetherSession{}, ErrInvalid
		}
		p.PositionMs = seekMs
		if cur.Status == "playing" {
			p.PositionAt = now.Add(startCountdown)
		}
	case "end":
		p.Status, p.EndedAt = "ended", &now
	default:
		return store.TogetherSession{}, ErrInvalid
	}
	next, err := q.SetTogetherState(ctx, p)
	if err != nil {
		return store.TogetherSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return store.TogetherSession{}, err
	}
	s.broadcastState(next, nil)
	return next, nil
}

// Say sends a message to whoever is in the session. Never stored.
func (s *Service) Say(ctx context.Context, sc Scope, id uuid.UUID, text string) error {
	text = strings.TrimSpace(text)
	if n := utf8.RuneCountInString(text); n < 1 || n > 300 {
		return ErrInvalid
	}
	sess, err := store.New(s.pool).GetTogether(ctx, store.GetTogetherParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if sess.Status == "ended" {
		return ErrEnded
	}
	s.broadcast(id, Event{Type: "message", Message: &Message{From: sc.UserID.String(), Text: text, At: s.Now()}})
	return nil
}

// Join registers a live connection for the session. The returned func leaves.
// When someone's last connection drops mid-play, playback pauses for both after
// a short grace period (5.2 · "Dev's connection dropped").
func (s *Service) Join(ctx context.Context, sc Scope, id uuid.UUID) (<-chan Event, func(), error) {
	sess, err := store.New(s.pool).GetTogether(ctx, store.GetTogetherParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan Event, 32)
	s.mu.Lock()
	r := s.roomFor(id)
	r.subs[ch] = struct{}{}
	r.here[sc.UserID]++
	if t := r.drops[sc.UserID]; t != nil {
		t.Stop()
		delete(r.drops, sc.UserID)
	}
	s.mu.Unlock()
	s.broadcastState(sess, map[string]string{"joined": sc.UserID.String()})

	leave := func() {
		s.mu.Lock()
		delete(r.subs, ch)
		r.here[sc.UserID]--
		gone := r.here[sc.UserID] <= 0
		if gone {
			delete(r.here, sc.UserID)
			r.drops[sc.UserID] = time.AfterFunc(dropGrace, func() { s.dropped(id, sc) })
		}
		if len(r.subs) == 0 && len(r.drops) == 0 {
			delete(s.rooms, id)
		}
		s.mu.Unlock()
		if gone {
			if latest, err := store.New(s.pool).GetTogetherByID(context.Background(), id); err == nil {
				s.broadcastState(latest, map[string]string{"left": sc.UserID.String()})
			}
		}
	}
	return ch, leave, nil
}

func (s *Service) dropped(id uuid.UUID, sc Scope) {
	s.mu.Lock()
	r := s.rooms[id]
	still := r != nil && r.here[sc.UserID] > 0
	if r != nil {
		delete(r.drops, sc.UserID)
		if len(r.subs) == 0 && len(r.drops) == 0 {
			delete(s.rooms, id)
		}
	}
	s.mu.Unlock()
	if still {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)
	cur, err := q.GetTogetherForUpdate(ctx, store.GetTogetherForUpdateParams{ID: id, RelationshipID: sc.SpaceID})
	if err != nil || cur.Status != "playing" {
		return
	}
	now := s.Now()
	reason := "connection"
	who := sc.UserID
	next, err := q.SetTogetherState(ctx, store.SetTogetherStateParams{
		ID: id, RelationshipID: sc.SpaceID, Status: "paused", PositionMs: position(cur, now), PositionAt: now, PausedReason: &reason, UpdatedBy: &who,
	})
	if err != nil || tx.Commit(ctx) != nil {
		return
	}
	s.broadcastState(next, map[string]string{"dropped": who.String()})
}
