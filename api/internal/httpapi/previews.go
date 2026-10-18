package httpapi

import (
	"bytes"
	"context"
	"net/url"
	"strings"
	"time"

	"betweenus/api/internal/boards"
	"betweenus/api/internal/live"
	"betweenus/api/internal/store"
)

// startPreview fetches a link preview in the background after a pin is saved.
// In-process for now; moves to the durable job runner with Phase 3.
func (s *Server) startPreview(sp boards.Space, p store.Pin) {
	if p.Url == nil || p.Kind == "idea" {
		return
	}
	q := store.New(s.pool)
	if err := q.SetPinPreviewPending(context.Background(), p.ID); err != nil {
		return
	}
	defaultTitle := ""
	if u, err := url.Parse(*p.Url); err == nil {
		defaultTitle = strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	}
	go func() {
		s.previewSem <- struct{}{}
		defer func() { <-s.previewSem }()
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()

		params := store.SetPinPreviewParams{ID: p.ID, Status: "failed", DefaultTitle: defaultTitle}
		if page, err := s.unfurl.Page(ctx, *p.Url); err == nil {
			params.Status = "done"
			params.Site = page.Site
			params.Description = page.Description
			params.NewTitle = page.Title
			if page.ImageURL != "" {
				if raw, err := s.unfurl.Image(ctx, page.ImageURL); err == nil {
					// Stored like any photo: re-encoded, metadata dropped, served only to members.
					if m, err := s.media.Upload(ctx, sp.ID, p.CreatedBy, bytes.NewReader(raw)); err == nil {
						params.MediaID = &m.ID
					}
				}
			}
		} else {
			s.log.Info("link preview failed", "pin", p.ID, "err", err)
		}
		if err := q.SetPinPreview(ctx, params); err != nil {
			s.log.Warn("saving link preview failed", "pin", p.ID, "err", err)
			return
		}
		s.live.Publish(ctx, live.Event{Space: sp.ID, Type: "pin.updated", ID: p.ID.String(), Actor: p.CreatedBy.String()})
	}()
}
