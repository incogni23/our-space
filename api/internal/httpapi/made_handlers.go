package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"betweenus/api/internal/made"
	"betweenus/api/internal/media"
)

type decisionJSON struct {
	UserID   string    `json:"userId"`
	Decision string    `json:"decision"`
	Comment  string    `json:"comment,omitempty"`
	At       time.Time `json:"at"`
}

type linkJSON struct {
	ID        string     `json:"id"`
	Version   int32      `json:"version"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
	CreatedBy string     `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
}

type creationJSON struct {
	ID            string          `json:"id"`
	CreatedBy     string          `json:"createdBy"`
	MemoryID      *string         `json:"memoryId,omitempty"`
	Format        string          `json:"format"`
	Spec          json.RawMessage `json:"spec"`
	Version       int32           `json:"version"`
	RenderMediaID *string         `json:"renderMediaId,omitempty"`
	Audience      string          `json:"audience"`
	Status        string          `json:"status"`
	Decisions     []decisionJSON  `json:"decisions"`
	Links         []linkJSON      `json:"links,omitempty"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

func toCreation(v made.View) creationJSON {
	c := v.Creation
	out := creationJSON{
		ID: c.ID.String(), CreatedBy: c.CreatedBy.String(), MemoryID: idPtr(c.MemoryID), Format: c.Format, Spec: c.Spec,
		Version: c.Version, RenderMediaID: idPtr(c.RenderMediaID), Audience: c.Audience, Status: v.Status,
		Decisions: []decisionJSON{}, UpdatedAt: c.UpdatedAt,
	}
	for _, d := range v.Decisions {
		out.Decisions = append(out.Decisions, decisionJSON{UserID: d.UserID.String(), Decision: d.Decision, Comment: d.Comment, At: d.At})
	}
	for _, l := range v.Links {
		out.Links = append(out.Links, linkJSON{ID: l.ID.String(), Version: l.Version, ExpiresAt: l.ExpiresAt, RevokedAt: l.RevokedAt, CreatedBy: l.CreatedBy.String(), CreatedAt: l.CreatedAt})
	}
	return out
}

func (s *Server) madeScope(w http.ResponseWriter, r *http.Request, write bool) (made.Scope, bool) {
	get := s.readSpace
	if write {
		get = s.space
	}
	sp, ok := get(w, r)
	if !ok {
		return made.Scope{}, false
	}
	return made.Scope{SpaceID: sp.ID, UserID: sp.UserID}, true
}

func (s *Server) madeID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	return parseUUID(w, chi.URLParam(r, "id"))
}

func (s *Server) handleListCreations(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, false)
	if !ok {
		return
	}
	list, err := s.made.List(r.Context(), sc)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]creationJSON, 0, len(list))
	for _, v := range list {
		out = append(out, toCreation(v))
	}
	writeJSON(w, http.StatusOK, map[string]any{"creations": out})
}

func (s *Server) handleCreateCreation(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	var in struct {
		Format   string          `json:"format"`
		MemoryID *string         `json:"memoryId"`
		Spec     json.RawMessage `json:"spec"`
	}
	if !decode(w, r, &in) {
		return
	}
	var mem *uuid.UUID
	if in.MemoryID != nil && *in.MemoryID != "" {
		id, ok := parseUUID(w, *in.MemoryID)
		if !ok {
			return
		}
		mem = &id
	}
	v, err := s.made.Create(r.Context(), sc, in.Format, mem, in.Spec)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"creation": toCreation(v)})
}

func (s *Server) handleGetCreation(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, false)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	v, err := s.made.Get(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"creation": toCreation(v)})
}

func (s *Server) handleUpdateCreation(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	var in struct {
		Spec json.RawMessage `json:"spec"`
	}
	if !decode(w, r, &in) {
		return
	}
	v, err := s.made.UpdateSpec(r.Context(), sc, id, in.Spec)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"creation": toCreation(v)})
}

// POST /creations/{id}/render — multipart "file": the image the maker previewed.
func (s *Server) handleRenderCreation(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+1<<20)
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_upload", "That didn’t come through. Try again.")
		return
	}
	defer file.Close()
	v, err := s.made.Render(r.Context(), sc, id, file)
	switch {
	case errors.Is(err, media.ErrUnsupported), errors.Is(err, media.ErrTooLarge):
		writeError(w, http.StatusBadRequest, "bad_upload", "That image couldn’t be saved. Try again.")
		return
	case err != nil:
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.updated", id.String())
	writeJSON(w, http.StatusOK, map[string]any{"creation": toCreation(v)})
}

func (s *Server) handleCreationAudience(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	var in struct {
		Audience string `json:"audience"`
	}
	if !decode(w, r, &in) {
		return
	}
	v, err := s.made.SetAudience(r.Context(), sc, id, in.Audience)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.updated", id.String())
	writeJSON(w, http.StatusOK, map[string]any{"creation": toCreation(v)})
}

func (s *Server) handleCreationRespond(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	var in struct {
		Decision string `json:"decision"`
		Comment  string `json:"comment"`
	}
	if !decode(w, r, &in) {
		return
	}
	v, err := s.made.Respond(r.Context(), sc, id, in.Decision, in.Comment)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.updated", id.String())
	writeJSON(w, http.StatusOK, map[string]any{"creation": toCreation(v)})
}

func (s *Server) handleCreationWithdraw(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	v, err := s.made.Withdraw(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.updated", id.String())
	writeJSON(w, http.StatusOK, map[string]any{"creation": toCreation(v)})
}

// GET /creations/{id}/download — the exported image, when allowed.
func (s *Server) handleCreationDownload(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, false)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	v, err := s.made.Get(r.Context(), sc, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	if err := made.CanDownload(v, sc.UserID); err != nil {
		s.domainError(w, r, err)
		return
	}
	rc, err := s.media.Open(r.Context(), sc.SpaceID, *v.Creation.RenderMediaID, "full")
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", `attachment; filename="between-us-`+v.Creation.Format+`.jpg"`)
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = io.Copy(w, rc)
}

func (s *Server) handleCreateLink(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	var in struct {
		Days int `json:"days"`
	}
	if !decode(w, r, &in) {
		return
	}
	plain, l, err := s.made.CreateLink(r.Context(), sc, id, time.Duration(in.Days)*24*time.Hour)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.updated", id.String())
	writeJSON(w, http.StatusCreated, map[string]any{
		"url":  s.cfg.AppOrigin + "/p/" + plain,
		"link": linkJSON{ID: l.ID.String(), Version: l.Version, ExpiresAt: l.ExpiresAt, CreatedBy: l.CreatedBy.String(), CreatedAt: l.CreatedAt},
	})
}

func (s *Server) handleRevokeLink(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "linkId"))
	if !ok {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	if err := s.made.RevokeLink(r.Context(), sc, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.updated", chi.URLParam(r, "id"))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteCreation(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.madeScope(w, r, true)
	if !ok {
		return
	}
	id, ok := s.madeID(w, r)
	if !ok {
		return
	}
	if err := s.made.Delete(r.Context(), sc, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sc.SpaceID, "creation.deleted", id.String())
	w.WriteHeader(http.StatusNoContent)
}

func publicHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store") // turning a link off takes effect at once
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

// GET /public/links/{token} — whether a preview link works. No session, no tracking.
func (s *Server) handlePublicLink(w http.ResponseWriter, r *http.Request) {
	publicHeaders(w)
	_, expires, err := s.made.PublicImage(r.Context(), chi.URLParam(r, "token"))
	if errors.Is(err, made.ErrNotFound) {
		writeError(w, http.StatusGone, "link_off", "This link has been turned off.")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"expiresAt": expires})
}

// GET /public/links/{token}/image — the shared image only. No session, no tracking.
func (s *Server) handlePublicLinkImage(w http.ResponseWriter, r *http.Request) {
	publicHeaders(w)
	key, _, err := s.made.PublicImage(r.Context(), chi.URLParam(r, "token"))
	if errors.Is(err, made.ErrNotFound) {
		http.Error(w, "This link has been turned off.", http.StatusGone)
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	rc, err := s.media.OpenKey(r.Context(), key)
	if err != nil {
		http.Error(w, "This link has been turned off.", http.StatusGone)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	_, _ = io.Copy(w, rc)
}
