// Package live fans out "something changed in your space" events to connected
// clients. Events carry what changed and who changed it, never presence: nothing
// here records or reveals whether a partner is online (handoff 5.4).
//
// Publish goes through Postgres NOTIFY so every API instance hears every event,
// and a notification sent inside a transaction is only delivered on commit.
package live

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const channel = "space_events"

type Event struct {
	Space uuid.UUID `json:"-"`
	Type  string    `json:"type"`  // e.g. pin.created, plan.updated, space.joined
	ID    string    `json:"id"`    // the thing that changed
	Actor string    `json:"actor"` // user id of whoever changed it
}

type wire struct {
	Space string `json:"space"`
	Event
}

type Hub struct {
	pool *pgxpool.Pool
	log  *slog.Logger

	mu   sync.Mutex
	subs map[uuid.UUID]map[chan Event]struct{}
}

func NewHub(pool *pgxpool.Pool, log *slog.Logger) *Hub {
	return &Hub{pool: pool, log: log, subs: map[uuid.UUID]map[chan Event]struct{}{}}
}

// Publish announces a change. Best-effort: a failure is logged, never surfaced.
func (h *Hub) Publish(ctx context.Context, ev Event) {
	b, err := json.Marshal(wire{Space: ev.Space.String(), Event: ev})
	if err != nil {
		return
	}
	if _, err := h.pool.Exec(ctx, "SELECT pg_notify($1, $2)", channel, string(b)); err != nil {
		h.log.Warn("live publish failed", "err", err, "type", ev.Type)
	}
}

// Subscribe returns a channel of events for a space and a cancel func.
func (h *Hub) Subscribe(space uuid.UUID) (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	if h.subs[space] == nil {
		h.subs[space] = map[chan Event]struct{}{}
	}
	h.subs[space][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs[space], ch)
		if len(h.subs[space]) == 0 {
			delete(h.subs, space)
		}
		h.mu.Unlock()
	}
}

func (h *Hub) fanout(ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[ev.Space] {
		select {
		case ch <- ev:
		default: // slow client: drop; it refetches on reconnect anyway
		}
	}
}

// Run listens for notifications until ctx ends, reconnecting with backoff.
func (h *Hub) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := h.listen(ctx)
		if ctx.Err() != nil {
			return
		}
		h.log.Warn("live listener stopped, retrying", "err", err, "in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (h *Hub) listen(ctx context.Context) error {
	conn, err := h.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
		return err
	}
	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var w wire
		if json.Unmarshal([]byte(n.Payload), &w) != nil {
			continue
		}
		id, err := uuid.Parse(w.Space)
		if err != nil {
			continue
		}
		ev := w.Event
		ev.Space = id
		h.fanout(ev)
	}
}
