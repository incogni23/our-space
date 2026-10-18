package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"betweenus/api/internal/notes"
)

type noteJSON struct {
	ID          string     `json:"id"`
	Mine        bool       `json:"mine"`
	State       string     `json:"state"` // draft | scheduled | waiting | delivered
	Body        *string    `json:"body,omitempty"`
	DeliverAt   *time.Time `json:"deliverAt,omitempty"`
	DeliverTz   *string    `json:"deliverTz,omitempty"`
	DeliveredAt *time.Time `json:"deliveredAt,omitempty"`
	ReadAt      *time.Time `json:"readAt,omitempty"`
	Opened      *bool      `json:"opened,omitempty"`
	Kept        *bool      `json:"kept,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

func toNote(v notes.View) noteJSON {
	return noteJSON{
		ID: v.ID.String(), Mine: v.Mine, State: v.State, Body: v.Body, DeliverAt: v.DeliverAt, DeliverTz: v.DeliverTz,
		DeliveredAt: v.DeliveredAt, ReadAt: v.ReadAt, Opened: v.Opened, Kept: v.Kept, CreatedAt: v.CreatedAt,
	}
}

func (s *Server) noteScope(w http.ResponseWriter, r *http.Request, write bool) (notes.Scope, bool) {
	get := s.readSpace
	if write {
		get = s.space
	}
	sp, ok := get(w, r)
	if !ok {
		return notes.Scope{}, false
	}
	return notes.Scope{SpaceID: sp.ID, UserID: sp.UserID}, true
}

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.noteScope(w, r, false)
	if !ok {
		return
	}
	list, err := s.notes.List(r.Context(), sc)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]noteJSON, 0, len(list))
	for _, v := range list {
		out = append(out, toNote(v))
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": out})
}

type noteWrite struct {
	Body     string `json:"body"`
	When     string `json:"when"`
	Local    string `json:"local"`
	TimeZone string `json:"timeZone"`
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.noteScope(w, r, true)
	if !ok {
		return
	}
	var in noteWrite
	if !decode(w, r, &in) {
		return
	}
	v, err := s.notes.Create(r.Context(), sc, notes.Write(in))
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "note.created", v.ID.String())
	writeJSON(w, http.StatusCreated, map[string]any{"note": toNote(v)})
}

func (s *Server) handleGetNote(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.noteScope(w, r, false)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	v, err := s.notes.Get(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": toNote(v)})
}

// POST /notes/{id}/open — the recipient broke the seal (v2 letter). Works in the
// read-only window too: reading isn't writing.
func (s *Server) handleOpenNote(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	sc, ok := s.noteScope(w, r, false)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	v, firstRead, err := s.notes.Open(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	if firstRead {
		s.publish(r, sc.SpaceID, "note.read", id.String())
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": toNote(v)})
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.noteScope(w, r, true)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in noteWrite
	if !decode(w, r, &in) {
		return
	}
	v, err := s.notes.Update(r.Context(), sc, id, notes.Write(in))
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "note.updated", id.String())
	writeJSON(w, http.StatusOK, map[string]any{"note": toNote(v)})
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.noteScope(w, r, true)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if err := s.notes.Delete(r.Context(), sc, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "note.deleted", id.String())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleKeepNote(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.noteScope(w, r, true)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Keep bool `json:"keep"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.notes.Keep(r.Context(), sc, id, in.Keep); err != nil {
		s.domainError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
