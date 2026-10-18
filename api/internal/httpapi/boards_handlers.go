package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"betweenus/api/internal/boards"
	"betweenus/api/internal/store"
)

type boardJSON struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	CreatedBy    string    `json:"createdBy"`
	CreatedAt    time.Time `json:"createdAt"`
	PinCount     int32     `json:"pinCount"`
	PlannedCount int32     `json:"plannedCount"`
}

type pinJSON struct {
	PreviewStatus      string    `json:"previewStatus"`
	PreviewSite        string    `json:"previewSite,omitempty"`
	PreviewDescription string    `json:"previewDescription,omitempty"`
	PreviewMediaID     *string   `json:"previewMediaId,omitempty"`
	ID                 string    `json:"id"`
	BoardID            string    `json:"boardId"`
	BoardName          string    `json:"boardName,omitempty"`
	CreatedBy          string    `json:"createdBy"`
	Kind               string    `json:"kind"`
	Title              string    `json:"title"`
	URL                *string   `json:"url,omitempty"`
	Note               string    `json:"note"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"createdAt"`
}

func toPin(p store.Pin, boardName string) pinJSON {
	return pinJSON{
		ID: p.ID.String(), BoardID: p.BoardID.String(), BoardName: boardName, CreatedBy: p.CreatedBy.String(),
		Kind: p.Kind, Title: p.Title, URL: p.Url, Note: p.Note, Status: p.Status, CreatedAt: p.CreatedAt,
		PreviewStatus: p.PreviewStatus, PreviewSite: p.PreviewSite, PreviewDescription: p.PreviewDescription, PreviewMediaID: idPtr(p.PreviewMediaID),
	}
}

// space resolves the caller's active space (for writes) or writes the error.
func (s *Server) space(w http.ResponseWriter, r *http.Request) (boards.Space, bool) {
	sp, err := s.boards.Resolve(r.Context(), session(r).UserID)
	if err != nil {
		s.domainError(w, r, err)
		return boards.Space{}, false
	}
	return sp, true
}

// readSpace also allows a closed space during its read-only window (reads only).
func (s *Server) readSpace(w http.ResponseWriter, r *http.Request) (boards.Space, bool) {
	sp, err := s.boards.ResolveRead(r.Context(), session(r).UserID)
	if err != nil {
		s.domainError(w, r, err)
		return boards.Space{}, false
	}
	return sp, true
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	recent, err := s.boards.RecentFromPartner(r.Context(), sp)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	pins := make([]pinJSON, 0, len(recent))
	for _, p := range recent {
		pins = append(pins, toPin(store.Pin{
			ID: p.ID, RelationshipID: p.RelationshipID, BoardID: p.BoardID, CreatedBy: p.CreatedBy, Kind: p.Kind,
			Title: p.Title, Url: p.Url, Note: p.Note, Status: p.Status, CreatedAt: p.CreatedAt,
			PreviewStatus: p.PreviewStatus, PreviewSite: p.PreviewSite, PreviewDescription: p.PreviewDescription, PreviewMediaID: p.PreviewMediaID,
		}, p.BoardName))
	}
	out := map[string]any{"newFromPartner": pins}
	if p, err := store.New(s.pool).OldestUnplannedPin(r.Context(), sp.ID); err == nil {
		out["waitingForADate"] = map[string]string{"id": p.ID.String(), "title": p.Title, "kind": p.Kind}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.readSpace(w, r)
	if !ok {
		return
	}
	rows, err := s.boards.ListBoards(r.Context(), sp)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := make([]boardJSON, 0, len(rows))
	for _, b := range rows {
		out = append(out, boardJSON{ID: b.ID.String(), Name: b.Name, CreatedBy: b.CreatedBy.String(), CreatedAt: b.CreatedAt, PinCount: b.PinCount, PlannedCount: b.PlannedCount})
	}
	writeJSON(w, http.StatusOK, map[string]any{"boards": out})
}

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	b, err := s.boards.CreateBoard(r.Context(), sp, in.Name)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sp.ID, "board.created", b.ID.String())
	writeJSON(w, http.StatusCreated, map[string]any{"board": boardJSON{ID: b.ID.String(), Name: b.Name, CreatedBy: b.CreatedBy.String(), CreatedAt: b.CreatedAt}})
}

func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.readSpace(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	b, err := s.boards.Board(r.Context(), sp, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	pins := make([]pinJSON, 0, len(b.Pins))
	planned := int32(0)
	for _, p := range b.Pins {
		pins = append(pins, toPin(p, ""))
		if p.Status == "planned" {
			planned++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"board": boardJSON{ID: b.Board.ID.String(), Name: b.Board.Name, CreatedBy: b.Board.CreatedBy.String(), CreatedAt: b.Board.CreatedAt, PinCount: int32(len(pins)), PlannedCount: planned},
		"pins":  pins,
	})
}

func (s *Server) handleCreatePin(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	var in struct {
		Text         string  `json:"text"`
		Title        string  `json:"title"`
		Note         string  `json:"note"`
		BoardID      *string `json:"boardId"`
		NewBoardName string  `json:"newBoardName"`
	}
	if !decode(w, r, &in) {
		return
	}
	np := boards.NewPin{Text: in.Text, Title: in.Title, Note: in.Note, NewBoardName: in.NewBoardName}
	if in.BoardID != nil && *in.BoardID != "" {
		id, ok := parseUUID(w, *in.BoardID)
		if !ok {
			return
		}
		np.BoardID = &id
	}
	p, err := s.boards.CreatePin(r.Context(), sp, np)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sp.ID, "pin.created", p.ID.String())
	s.startPreview(sp, p)
	p.PreviewStatus = "pending"
	if p.Url == nil {
		p.PreviewStatus = "none"
	}
	writeJSON(w, http.StatusCreated, map[string]any{"pin": toPin(p, "")})
}

func (s *Server) handleGetPin(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.readSpace(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	d, err := s.boards.Pin(r.Context(), sp, id)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	p := d.Pin
	type noteJSON struct {
		ID        string    `json:"id"`
		AuthorID  string    `json:"authorId"`
		Body      string    `json:"body"`
		CreatedAt time.Time `json:"createdAt"`
	}
	notes := make([]noteJSON, 0, len(d.Notes))
	for _, n := range d.Notes {
		notes = append(notes, noteJSON{ID: n.ID.String(), AuthorID: n.AuthorID.String(), Body: n.Body, CreatedAt: n.CreatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"pin": toPin(store.Pin{
			ID: p.ID, RelationshipID: p.RelationshipID, BoardID: p.BoardID, CreatedBy: p.CreatedBy, Kind: p.Kind,
			Title: p.Title, Url: p.Url, Note: p.Note, Status: p.Status, CreatedAt: p.CreatedAt,
			PreviewStatus: p.PreviewStatus, PreviewSite: p.PreviewSite, PreviewDescription: p.PreviewDescription, PreviewMediaID: p.PreviewMediaID,
		}, p.BoardName),
		"notes": notes,
	})
}

func (s *Server) handleUpdatePin(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Title   *string `json:"title"`
		Note    *string `json:"note"`
		Status  *string `json:"status"`
		BoardID *string `json:"boardId"`
	}
	if !decode(w, r, &in) {
		return
	}
	up := boards.PinUpdate{Title: in.Title, Note: in.Note, Status: in.Status}
	if in.BoardID != nil {
		bid, err := uuid.Parse(*in.BoardID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "That request didn’t make sense.")
			return
		}
		up.BoardID = &bid
	}
	p, err := s.boards.UpdatePin(r.Context(), sp, id, up)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sp.ID, "pin.updated", p.ID.String())
	writeJSON(w, http.StatusOK, map[string]any{"pin": toPin(p, "")})
}

func (s *Server) handleDeletePin(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if err := s.boards.DeletePin(r.Context(), sp, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sp.ID, "pin.deleted", id.String())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRestorePin(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
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
	if err := s.boards.RestorePin(r.Context(), sp, id); err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sp.ID, "pin.created", id.String())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAddPinNote(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.space(w, r)
	if !ok {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if !decode(w, r, &in) {
		return
	}
	n, err := s.boards.AddNote(r.Context(), sp, id, in.Body)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.publish(r, sp.ID, "pin.note", id.String())
	writeJSON(w, http.StatusCreated, map[string]any{"note": map[string]any{
		"id": n.ID.String(), "authorId": n.AuthorID.String(), "body": n.Body, "createdAt": n.CreatedAt,
	}})
}
