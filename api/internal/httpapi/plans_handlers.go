package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"betweenus/api/internal/plans"
	"betweenus/api/internal/store"
)

type planJSON struct {
	ID                string      `json:"id"`
	CreatedBy         string      `json:"createdBy"`
	PinID             *string     `json:"pinId,omitempty"`
	Kind              string      `json:"kind"`
	Title             string      `json:"title"`
	Place             string      `json:"place"`
	Notes             string      `json:"notes"`
	StartsAt          time.Time   `json:"startsAt"`
	AnchorTz          string      `json:"anchorTz"`
	Repeat            string      `json:"repeat"`
	Status            string      `json:"status"`
	SuggestedStartsAt *time.Time  `json:"suggestedStartsAt,omitempty"`
	SuggestedBy       *string     `json:"suggestedBy,omitempty"`
	RespondedBy       *string     `json:"respondedBy,omitempty"`
	CreatedAt         time.Time   `json:"createdAt"`
	Occurrences       []time.Time `json:"occurrences,omitempty"`
}

func idPtr(u *uuid.UUID) *string {
	if u == nil {
		return nil
	}
	s := u.String()
	return &s
}

func toPlan(p store.Plan, occ []time.Time) planJSON {
	return planJSON{
		ID: p.ID.String(), CreatedBy: p.CreatedBy.String(), PinID: idPtr(p.PinID), Kind: p.Kind, Title: p.Title,
		Place: p.Place, Notes: p.Notes, StartsAt: p.StartsAt, AnchorTz: p.AnchorTz, Repeat: p.Repeat, Status: p.Status,
		SuggestedStartsAt: p.SuggestedStartsAt, SuggestedBy: idPtr(p.SuggestedBy), RespondedBy: idPtr(p.RespondedBy),
		CreatedAt: p.CreatedAt, Occurrences: occ,
	}
}

func (s *Server) planScope(w http.ResponseWriter, r *http.Request) (plans.Scope, bool) {
	sp, ok := s.space(w, r)
	if !ok {
		return plans.Scope{}, false
	}
	return plans.Scope{SpaceID: sp.ID, UserID: sp.UserID}, true
}

// GET /plans?days=120 — live plans with occurrences from now (minus 2h) onward.
func (s *Server) handleListPlans(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.planScope(w, r)
	if !ok {
		return
	}
	now := time.Now()
	from := now.Add(-2 * time.Hour)
	to := now.AddDate(0, 0, 120)
	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil && t.After(from) && t.Sub(from) < 400*24*time.Hour {
			to = t
		}
	}
	views, err := s.plans.List(r.Context(), sc, from, to)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]planJSON, 0, len(views))
	for _, v := range views {
		out = append(out, toPlan(v.Plan, v.Occurrences))
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": out})
}

func (s *Server) handleCreatePlan(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.planScope(w, r)
	if !ok {
		return
	}
	var in struct {
		Title        string  `json:"title"`
		Local        string  `json:"local"`
		TimeZone     string  `json:"timeZone"`
		Kind         string  `json:"kind"`
		Repeat       string  `json:"repeat"`
		Place        string  `json:"place"`
		Notes        string  `json:"notes"`
		PinID        *string `json:"pinId"`
		AskToConfirm bool    `json:"askToConfirm"`
	}
	if !decode(w, r, &in) {
		return
	}
	np := plans.NewPlan{
		Title: in.Title, Local: in.Local, TimeZone: in.TimeZone, Kind: in.Kind, Repeat: in.Repeat,
		Place: in.Place, Notes: in.Notes, AskToConfirm: in.AskToConfirm,
	}
	if in.PinID != nil && *in.PinID != "" {
		id, ok := parseUUID(w, *in.PinID)
		if !ok {
			return
		}
		np.PinID = &id
	}
	p, err := s.plans.Create(r.Context(), sc, np)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"plan": toPlan(p, nil)})
}

func (s *Server) handleGetPlan(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.planScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	v, err := s.plans.Get(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"plan": toPlan(v.Plan, v.Occurrences)})
}

func (s *Server) handleRespondPlan(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.planScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Action   string `json:"action"`
		Local    string `json:"local"`
		TimeZone string `json:"timeZone"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, err := s.plans.Respond(r.Context(), sc, id, in.Action, in.Local, in.TimeZone)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"plan": toPlan(p, nil)})
}

func (s *Server) handleUpdatePlan(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.planScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Title    string `json:"title"`
		Place    string `json:"place"`
		Notes    string `json:"notes"`
		Local    string `json:"local"`
		TimeZone string `json:"timeZone"`
		Repeat   string `json:"repeat"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, err := s.plans.Update(r.Context(), sc, id, plans.Edit{
		Title: in.Title, Place: in.Place, Notes: in.Notes, Local: in.Local, TimeZone: in.TimeZone, Repeat: in.Repeat,
	})
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"plan": toPlan(p, nil)})
}

func (s *Server) handleCancelPlan(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.planScope(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	if err := s.plans.Cancel(r.Context(), sc, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
