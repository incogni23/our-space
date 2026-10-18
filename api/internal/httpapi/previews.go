package httpapi

import (
	"context"
	"time"

	"betweenus/api/internal/boards"
	"betweenus/api/internal/jobs"
	"betweenus/api/internal/store"
)

// startPreview queues a link preview after a pin is saved (handled by jobLinkPreview).
func (s *Server) startPreview(_ boards.Space, p store.Pin) {
	if p.Url == nil || p.Kind == "idea" {
		return
	}
	ctx := context.Background()
	q := store.New(s.pool)
	if err := q.SetPinPreviewPending(ctx, p.ID); err != nil {
		return
	}
	if err := jobs.Enqueue(ctx, q, jobPreview, map[string]string{"pinId": p.ID.String()}, time.Now(), jobPreview+":"+p.ID.String()); err != nil {
		s.log.Warn("queueing link preview failed", "pin", p.ID, "err", err)
	}
}
