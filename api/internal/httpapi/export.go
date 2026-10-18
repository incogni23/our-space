package httpapi

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"betweenus/api/internal/store"
)

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9 _.-]+`)

func fileSafe(s string, max int) string {
	s = strings.TrimSpace(unsafeName.ReplaceAllString(s, ""))
	if len(s) > max {
		s = strings.TrimSpace(s[:max])
	}
	if s == "" {
		return "untitled"
	}
	return s
}

// GET /export — everything in the space as a zip: boards, plans, Our Story and
// photos. Works while the space is active and during the read-only window.
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	sp, ok := s.readSpace(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	q := store.New(s.pool)
	pins, err := q.AllPins(ctx, sp.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	plansRows, err := q.AllPlans(ctx, sp.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	mems, err := q.AllMemoriesWithMedia(ctx, sp.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	members, err := q.MembersOf(ctx, sp.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	names := map[string]string{}
	for _, m := range members {
		names[m.ID.String()] = m.DisplayName
	}

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Minute))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="between-us-%s.zip"`, fileSafe(sp.Name, 40)))
	w.Header().Set("Cache-Control", "no-store")

	zw := zip.NewWriter(w)
	defer zw.Close()
	put := func(name string, v any) {
		f, err := zw.Create(name)
		if err != nil {
			return
		}
		enc := json.NewEncoder(f)
		enc.SetIndent("", "  ")
		_ = enc.Encode(v)
	}

	readme, _ := zw.Create("README.txt")
	fmt.Fprintf(readme, "%s\nExported %s from Between Us.\n\nboards.json  everything you saved\nplans.json   your plans (times in UTC, with the zone each was made in)\nstory.json   Our Story\nphotos/      photos, one folder per memory\n",
		sp.Name, time.Now().UTC().Format("2 January 2006"))

	type pinOut struct {
		Board, Kind, Title, URL, Note, Status, SavedBy string
		SavedAt                                        time.Time
	}
	po := make([]pinOut, 0, len(pins))
	for _, p := range pins {
		u := ""
		if p.Url != nil {
			u = *p.Url
		}
		po = append(po, pinOut{p.BoardName, p.Kind, p.Title, u, p.Note, p.Status, names[p.CreatedBy.String()], p.CreatedAt})
	}
	put("boards.json", po)

	type planOut struct {
		Title, Kind, Place, Notes, Zone, Repeat, Status, MadeBy string
		StartsAt                                                time.Time
	}
	pl := make([]planOut, 0, len(plansRows))
	for _, p := range plansRows {
		pl = append(pl, planOut{p.Title, p.Kind, p.Place, p.Notes, p.AnchorTz, p.Repeat, p.Status, names[p.CreatedBy.String()], p.StartsAt})
	}
	put("plans.json", pl)

	type memOut struct {
		Kind, Title, Caption, Place, From, To string
		Photos                                []string
	}
	var story []memOut
	byID := map[string]int{}
	for _, m := range mems {
		k := m.ID.String()
		i, seen := byID[k]
		if !seen {
			to := ""
			if m.EndsOn != nil {
				to = m.EndsOn.Format("2006-01-02")
			}
			story = append(story, memOut{Kind: m.Kind, Title: m.Title, Caption: m.Caption, Place: m.Place, From: m.HappenedOn.Format("2006-01-02"), To: to})
			i = len(story) - 1
			byID[k] = i
		}
		if m.KeyFull == nil {
			continue
		}
		dir := fmt.Sprintf("photos/%s %s", m.HappenedOn.Format("2006-01-02"), fileSafe(m.Title, 50))
		name := fmt.Sprintf("%s/%02d.jpg", dir, len(story[i].Photos)+1)
		blob, err := s.media.OpenKey(ctx, *m.KeyFull)
		if err != nil {
			continue
		}
		if f, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: m.HappenedOn}); err == nil {
			_, _ = io.Copy(f, blob)
			story[i].Photos = append(story[i].Photos, name)
		}
		blob.Close()
	}
	put("story.json", story)
}
