package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"betweenus/api/internal/push"
	"betweenus/api/internal/store"
	"betweenus/api/internal/together"
)

func (s *Server) togetherScope(w http.ResponseWriter, r *http.Request) (together.Scope, bool) {
	sp, ok := s.space(w, r)
	if !ok {
		return together.Scope{}, false
	}
	return together.Scope{SpaceID: sp.ID, UserID: sp.UserID}, true
}

// GET /together — the open session, if any.
func (s *Server) handleTogetherCurrent(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.togetherScope(w, r)
	if !ok {
		return
	}
	cur, err := s.together.Current(r.Context(), sc)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if cur == nil {
		writeJSON(w, http.StatusOK, map[string]any{"session": nil})
		return
	}
	snap, here, err := s.together.Get(r.Context(), sc, cur.ID)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": snap, "here": here})
}

func (s *Server) handleTogetherStart(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.togetherScope(w, r)
	if !ok {
		return
	}
	var in struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	}
	if !decode(w, r, &in) {
		return
	}
	sess, err := s.together.Start(r.Context(), sc, in.Title, in.URL)
	if errors.Is(err, together.ErrAlreadyOpen) {
		writeJSON(w, http.StatusConflict, map[string]any{"error": apiError{Code: "together_open", Message: "You already have a session open."}, "sessionId": sess.ID.String()})
		return
	}
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	// Tell the other person: a quiet notice, and a push (it's happening now).
	q := store.New(s.pool)
	if me, err := q.GetUser(r.Context(), sc.UserID); err == nil {
		if others, err := q.OtherMembers(r.Context(), store.OtherMembersParams{RelationshipID: sc.SpaceID, UserID: sc.UserID}); err == nil {
			for _, o := range others {
				_ = s.notice(r.Context(), q, o, "together_invite", map[string]string{"sessionId": sess.ID.String(), "title": sess.Title, "name": me.DisplayName})
				s.cfg.Push.Send(r.Context(), o, push.Message{Title: "Together", Body: me.DisplayName + " is waiting for you.", URL: "/together/" + sess.ID.String(), Tag: "together"})
			}
		}
	}
	s.publish(r, sc.SpaceID, "together.started", sess.ID.String())
	snap, here, _ := s.together.Get(r.Context(), sc, sess.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"session": snap, "here": here})
}

func (s *Server) handleTogetherGet(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.togetherScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	snap, here, err := s.together.Get(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": snap, "here": here})
}

func (s *Server) handleTogetherAct(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.togetherScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Action     string `json:"action"`
		PositionMs int64  `json:"positionMs"`
	}
	if !decode(w, r, &in) {
		return
	}
	sess, err := s.together.Act(r.Context(), sc, id, in.Action, in.PositionMs)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	if sess.Status == "ended" {
		_ = store.New(s.pool).SeeSessionInvites(r.Context(), store.SeeSessionInvitesParams{SessionID: id.String()})
		s.publish(r, sc.SpaceID, "together.ended", id.String())
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTogetherSay(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.togetherScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.together.Say(r.Context(), sc, id, in.Text); err != nil {
		s.domainError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /together/{id}/stream — Server-Sent Events for one session. Being connected
// here is what "here" means; nothing about it is stored.
func (s *Server) handleTogetherStream(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.togetherScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	events, leave, err := s.together.Join(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	defer leave()
	uid := sc.UserID
	_ = store.New(s.pool).SeeSessionInvites(r.Context(), store.SeeSessionInvitesParams{SessionID: id.String(), UserID: &uid})
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 2000\n: hello\n\n")
	if rc.Flush() != nil {
		return
	}
	ping := time.NewTicker(20 * time.Second)
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
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b); err != nil || rc.Flush() != nil {
				return
			}
		}
	}
}
