package httpapi

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"betweenus/api/internal/store"
)

// v2 colour families: one per space, either partner can change it.
var palettes = map[string]bool{"cherry": true, "lavender": true, "matcha": true, "ocean": true, "peach": true, "midnight": true}

// Handwriting ink, chosen per person.
var inks = map[string]bool{"accent": true, "second": true, "ink": true, "pencil": true}

// POST /space/palette — repaint the space; the other person gets a little note.
func (s *Server) handleSetPalette(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Palette string `json:"palette"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !palettes[in.Palette] {
		writeError(w, http.StatusBadRequest, "invalid_input", "That colour family doesn’t exist.")
		return
	}
	uid := session(r).UserID
	sp, err := s.boards.Resolve(r.Context(), uid)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	if sp.Palette == in.Palette {
		writeJSON(w, http.StatusOK, map[string]string{"palette": in.Palette})
		return
	}
	q := store.New(s.pool)
	if err := q.SetPalette(r.Context(), store.SetPaletteParams{ID: sp.ID, Palette: in.Palette}); err != nil {
		s.serverError(w, r, err)
		return
	}
	if me, err := q.GetUser(r.Context(), uid); err == nil {
		others, _ := q.OtherMembers(r.Context(), store.OtherMembersParams{RelationshipID: sp.ID, UserID: uid})
		for _, o := range others {
			_ = s.notice(r.Context(), q, o, "palette_changed", map[string]string{"palette": in.Palette, "name": me.DisplayName})
		}
	}
	s.audit(r, uid, &sp.ID, "palette_changed", map[string]any{"palette": in.Palette})
	s.publish(r, sp.ID, "space.palette", in.Palette)
	writeJSON(w, http.StatusOK, map[string]string{"palette": in.Palette})
}

type songJSON struct {
	PinID     string  `json:"pinId"`
	Title     string  `json:"title"`
	URL       *string `json:"url,omitempty"`
	Note      string  `json:"note,omitempty"`
	Kind      string  `json:"kind"`
	CreatedBy string  `json:"createdBy"`
}

// spaceSong is the space's song, or nil when none is picked (or its pin was removed).
func (s *Server) spaceSong(r *http.Request, spaceID uuid.UUID) *songJSON {
	row, err := store.New(s.pool).SpaceSong(r.Context(), spaceID)
	if err != nil {
		return nil
	}
	return &songJSON{PinID: row.ID.String(), Title: row.Title, URL: row.Url, Note: row.Note, Kind: row.Kind, CreatedBy: row.CreatedBy.String()}
}

// POST /space/song {"pinId": "…"} — make a saved song (or any playable link) our
// song; {"pinId": null} clears it. The other person gets a little note.
func (s *Server) handleSetSong(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PinID *string `json:"pinId"`
	}
	if !decode(w, r, &in) {
		return
	}
	uid := session(r).UserID
	sp, err := s.boards.Resolve(r.Context(), uid)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	q := store.New(s.pool)
	var pinID *uuid.UUID
	var title string
	if in.PinID != nil {
		id, ok := parseUUID(w, *in.PinID)
		if !ok {
			return
		}
		pin, err := q.GetPin(r.Context(), store.GetPinParams{ID: id, RelationshipID: sp.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "That pin isn’t here any more.")
			return
		}
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		if pin.Url == nil || (pin.Kind != "song" && pin.Kind != "link") {
			writeError(w, http.StatusBadRequest, "invalid_input", "Pick a song or a link you can play.")
			return
		}
		pinID, title = &id, pin.Title
	}
	if err := q.SetSong(r.Context(), store.SetSongParams{PinID: pinID, ID: sp.ID}); err != nil {
		s.serverError(w, r, err)
		return
	}
	if pinID != nil {
		if me, err := q.GetUser(r.Context(), uid); err == nil {
			others, _ := q.OtherMembers(r.Context(), store.OtherMembersParams{RelationshipID: sp.ID, UserID: uid})
			for _, o := range others {
				_ = s.notice(r.Context(), q, o, "song_changed", map[string]string{"pinId": pinID.String(), "title": title, "name": me.DisplayName})
			}
		}
	}
	s.publish(r, sp.ID, "space.song", "")
	writeJSON(w, http.StatusOK, map[string]any{"song": s.spaceSong(r, sp.ID)})
}
