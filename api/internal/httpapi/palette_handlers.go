package httpapi

import (
	"net/http"

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
