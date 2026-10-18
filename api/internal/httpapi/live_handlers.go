package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"betweenus/api/internal/live"
	"betweenus/api/internal/pairing"
)

// GET /live — Server-Sent Events for the caller's current space (pending or active).
// The stream ends when the space changes; the client reconnects and resubscribes.
func (s *Server) handleLive(w http.ResponseWriter, r *http.Request) {
	uid := session(r).UserID
	sp, err := s.pairing.CurrentSpace(r.Context(), uid)
	if errors.Is(err, pairing.ErrNotInSpace) {
		w.WriteHeader(http.StatusNoContent) // nothing to listen to; EventSource stops on 204
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // long-lived: lift the server's write timeout
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	events, cancel := s.live.Subscribe(sp.Relationship.ID)
	defer cancel()

	fmt.Fprint(w, "retry: 3000\n: hello\n\n")
	if rc.Flush() != nil {
		return
	}
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil || rc.Flush() != nil {
				return
			}
		case ev := <-events:
			b, _ := json.Marshal(ev)
			if _, err := fmt.Fprintf(w, "event: change\ndata: %s\n\n", b); err != nil || rc.Flush() != nil {
				return
			}
			if ev.Type == "space.closed" || ev.Type == "space.joined" {
				return // the space changed shape; reconnect to pick up the new state
			}
		}
	}
}

// publish announces a change in a space after a successful write.
func (s *Server) publish(r *http.Request, space uuid.UUID, typ, id string) {
	s.live.Publish(r.Context(), live.Event{Space: space, Type: typ, ID: id, Actor: session(r).UserID.String()})
}
