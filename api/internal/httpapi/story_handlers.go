package httpapi

import (
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"betweenus/api/internal/media"
	"betweenus/api/internal/story"
)

type photoJSON struct {
	ID         string     `json:"id"`
	Width      int32      `json:"width"`
	Height     int32      `json:"height"`
	TakenAt    *time.Time `json:"takenAt,omitempty"`
	UploadedBy string     `json:"uploadedBy,omitempty"`
}

type memoryJSON struct {
	ID         string      `json:"id"`
	CreatedBy  string      `json:"createdBy"`
	Kind       string      `json:"kind"`
	Title      string      `json:"title"`
	Caption    string      `json:"caption"`
	Place      string      `json:"place"`
	HappenedOn string      `json:"happenedOn"`
	EndsOn     *string     `json:"endsOn,omitempty"`
	PhotoCount int32       `json:"photoCount"`
	CoverID    *string     `json:"coverId,omitempty"`
	Photos     []photoJSON `json:"photos,omitempty"`
	CreatedAt  time.Time   `json:"createdAt"`
}

func dateStr(t time.Time) string { return t.Format("2006-01-02") }

func dateStrPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := dateStr(*t)
	return &s
}

// POST /media — multipart "file". Requires X-BU-Upload: 1 (a cross-site form can't set it).
func (s *Server) handleUploadMedia(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+1<<20)
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_upload", "That photo didn’t come through. Try again.")
		return
	}
	defer file.Close()
	m, err := s.media.Upload(r.Context(), sp.ID, sp.UserID, file)
	switch err {
	case nil:
	case media.ErrUnsupported:
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_image", "That file isn’t a photo we can use. Try a JPEG, PNG or WebP.")
		return
	case media.ErrTooLarge:
		writeError(w, http.StatusRequestEntityTooLarge, "image_too_large", "That photo is too big. Try one under 25 MB.")
		return
	default:
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"photo": photoJSON{ID: m.ID.String(), Width: m.Width, Height: m.Height, TakenAt: m.TakenAt}})
}

// GET /media/{id}/{variant} — streams a photo to members of the space only.
func (s *Server) handleGetMedia(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	variant := chi.URLParam(r, "variant")
	if variant != "full" && variant != "thumb" {
		http.NotFound(w, r)
		return
	}
	rc, err := s.media.Open(r.Context(), sp.ID, id, variant)
	if err == media.ErrNotFound {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, rc)
}

func (s *Server) handleListMemories(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	rows, err := s.story.List(r.Context(), sp.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]memoryJSON, 0, len(rows))
	for _, m := range rows {
		mj := memoryJSON{
			ID: m.ID.String(), CreatedBy: m.CreatedBy.String(), Kind: m.Kind, Title: m.Title, Caption: m.Caption,
			Place: m.Place, HappenedOn: dateStr(m.HappenedOn), EndsOn: dateStrPtr(m.EndsOn), PhotoCount: m.PhotoCount, CreatedAt: m.CreatedAt,
		}
		if m.CoverID != uuid.Nil {
			c := m.CoverID.String()
			mj.CoverID = &c
		}
		out = append(out, mj)
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": out})
}

func (s *Server) handleCreateMemory(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	var in struct {
		Kind       string   `json:"kind"`
		Title      string   `json:"title"`
		Caption    string   `json:"caption"`
		Place      string   `json:"place"`
		HappenedOn string   `json:"happenedOn"`
		EndsOn     string   `json:"endsOn"`
		PhotoIDs   []string `json:"photoIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	ids := make([]uuid.UUID, 0, len(in.PhotoIDs))
	for _, p := range in.PhotoIDs {
		id, ok := parseUUID(w, p)
		if !ok {
			return
		}
		ids = append(ids, id)
	}
	m, err := s.story.Create(r.Context(), sp.ID, sp.UserID, story.NewMemory{
		Kind: in.Kind, Title: in.Title, Caption: in.Caption, Place: in.Place, HappenedOn: in.HappenedOn, EndsOn: in.EndsOn, MediaIDs: ids,
	})
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"memory": memoryJSON{
		ID: m.ID.String(), CreatedBy: m.CreatedBy.String(), Kind: m.Kind, Title: m.Title, Caption: m.Caption, Place: m.Place,
		HappenedOn: dateStr(m.HappenedOn), EndsOn: dateStrPtr(m.EndsOn), PhotoCount: int32(len(ids)), CreatedAt: m.CreatedAt,
	}})
}

func (s *Server) handleGetMemory(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	d, err := s.story.Get(r.Context(), sp.ID, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	m := d.Memory
	photos := make([]photoJSON, 0, len(d.Photos))
	for _, p := range d.Photos {
		photos = append(photos, photoJSON{ID: p.ID.String(), Width: p.Width, Height: p.Height, TakenAt: p.TakenAt, UploadedBy: p.UploadedBy.String()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"memory": memoryJSON{
		ID: m.ID.String(), CreatedBy: m.CreatedBy.String(), Kind: m.Kind, Title: m.Title, Caption: m.Caption, Place: m.Place,
		HappenedOn: dateStr(m.HappenedOn), EndsOn: dateStrPtr(m.EndsOn), PhotoCount: int32(len(photos)), Photos: photos, CreatedAt: m.CreatedAt,
	}})
}

func (s *Server) handleDeleteMemory(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if err := s.story.Delete(r.Context(), sp.ID, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
