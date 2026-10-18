package httpapi

import (
	"net/http"

	"betweenus/api/internal/push"
)

// GET /push/key — the VAPID public key the browser subscribes with.
func (s *Server) handlePushKey(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Push.Enabled() {
		writeError(w, http.StatusNotFound, "push_off", "Notifications aren’t set up here.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": s.cfg.Push.PublicKey})
}

func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !s.cfg.Push.Enabled() {
		writeError(w, http.StatusNotFound, "push_off", "Notifications aren’t set up here.")
		return
	}
	if err := s.cfg.Push.Subscribe(r.Context(), session(r).UserID, in.Endpoint, in.Keys.P256dh, in.Keys.Auth); err != nil {
		if err == push.ErrBadEndpoint {
			writeError(w, http.StatusBadRequest, "bad_subscription", "That browser’s notifications aren’t supported.")
			return
		}
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if !decode(w, r, &in) {
		return
	}
	if s.cfg.Push.Enabled() {
		if err := s.cfg.Push.Unsubscribe(r.Context(), session(r).UserID, in.Endpoint); err != nil {
			s.serverError(w, r, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
