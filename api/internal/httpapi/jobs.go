package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"betweenus/api/internal/jobs"
	"betweenus/api/internal/live"
	"betweenus/api/internal/notes"
	"betweenus/api/internal/pairing"
	"betweenus/api/internal/plans"
	"betweenus/api/internal/push"
	"betweenus/api/internal/store"
)

const jobPreview = "link.preview"

// registerJobs wires every background job kind to its handler.
func (s *Server) registerJobs() {
	s.jobs.Handle(notes.JobDeliver, s.jobDeliverNote)
	s.jobs.Handle(plans.JobRemind, s.jobRemindPlan)
	s.jobs.Handle(pairing.JobPurge, s.jobPurgeSpace)
	s.jobs.Handle(jobPreview, s.jobLinkPreview)
}

func parseID(payload []byte, field string) (uuid.UUID, error) {
	var m map[string]string
	if err := json.Unmarshal(payload, &m); err != nil {
		return uuid.Nil, jobs.Permanent(err)
	}
	id, err := uuid.Parse(m[field])
	if err != nil {
		return uuid.Nil, jobs.Permanent(fmt.Errorf("bad %s", field))
	}
	return id, nil
}

func (s *Server) notice(ctx context.Context, q *store.Queries, user uuid.UUID, kind string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.CreateNotice(ctx, store.CreateNoticeParams{UserID: user, Kind: kind, Payload: b, CreatedAt: time.Now()})
}

// note.deliver: open the envelope at its time and tell the recipient quietly.
func (s *Server) jobDeliverNote(ctx context.Context, payload []byte) error {
	id, err := parseID(payload, "noteId")
	if err != nil {
		return err
	}
	n, ok, err := s.notes.Deliver(ctx, id)
	if err != nil || !ok {
		return err // !ok: edited, taken back or already delivered
	}
	q := store.New(s.pool)
	author, err := q.GetUser(ctx, n.AuthorID)
	if err != nil {
		return err
	}
	if err := s.notice(ctx, q, n.RecipientID, "note_delivered", map[string]string{"noteId": n.ID.String(), "fromName": author.DisplayName}); err != nil {
		return err
	}
	s.live.Publish(ctx, live.Event{Space: n.RelationshipID, Type: "note.delivered", ID: n.ID.String(), Actor: n.AuthorID.String()})
	// Lock-screen safe: no sender name, no words from the note.
	s.cfg.Push.Send(ctx, n.RecipientID, push.Message{Title: "Between Us", Body: "A note is here for you.", URL: "/notes/" + n.ID.String(), Tag: "note-" + n.ID.String()[:8]})
	return nil
}

// plan.remind: a quiet in-app reminder for one person, then schedule the next one.
func (s *Server) jobRemindPlan(ctx context.Context, payload []byte) error {
	var m map[string]string
	if err := json.Unmarshal(payload, &m); err != nil {
		return jobs.Permanent(err)
	}
	planID, err1 := uuid.Parse(m["planId"])
	userID, err2 := uuid.Parse(m["userId"])
	occ, err3 := time.Parse(time.RFC3339, m["occurrence"])
	if err1 != nil || err2 != nil || err3 != nil {
		return jobs.Permanent(errors.New("bad reminder payload"))
	}
	q := store.New(s.pool)
	p, err := q.GetPlanByID(ctx, planID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if p.Status != "proposed" && p.Status != "confirmed" || p.Remind == "none" {
		return nil
	}
	// The plan may have moved since this was scheduled; only remind for a real occurrence.
	real := plans.Occurrences(p, occ.Add(-time.Minute), occ.Add(time.Minute), 1)
	if len(real) == 1 {
		if err := s.notice(ctx, q, userID, "plan_reminder", map[string]any{
			"planId": p.ID.String(), "title": p.Title, "at": occ, "kind": p.Kind,
		}); err != nil {
			return err
		}
		s.live.Publish(ctx, live.Event{Space: p.RelationshipID, Type: "notice.created", ID: p.ID.String(), Actor: userID.String()})
		if u, err := q.GetUser(ctx, userID); err == nil {
			loc, lerr := time.LoadLocation(u.TimeZone)
			if lerr != nil {
				loc = time.UTC
			}
			when := occ.In(loc).Format("Mon 2 Jan, 3:04 pm")
			s.cfg.Push.Send(ctx, userID, push.Message{Title: p.Title, Body: when, URL: "/plans/" + p.ID.String(), Tag: "plan-" + p.ID.String()[:8]})
		}
	}
	if p.Repeat == "weekly" {
		return plans.ScheduleReminders(ctx, q, p, occ.Add(time.Minute))
	}
	return nil
}

// space.purge: delete a closed space's content once its read-only window ended.
func (s *Server) jobPurgeSpace(ctx context.Context, payload []byte) error {
	id, err := parseID(payload, "relationshipId")
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)
	if _, err := q.LockPurgeable(ctx, id); errors.Is(err, pgx.ErrNoRows) {
		return nil // not due, already purged, or never closed
	} else if err != nil {
		return err
	}
	steps := []func(context.Context, uuid.UUID) error{
		q.PurgeShareLinks, q.PurgeCreationApprovals, q.PurgeCreations,
		q.PurgeNotes, q.PurgePinNotes, q.PurgeMemoryMedia, q.PurgePlans, q.PurgeMemories, q.PurgePins, q.PurgeBoards,
	}
	for _, step := range steps {
		if err := step(ctx, id); err != nil {
			return err
		}
	}
	keys, err := q.PurgeMedia(ctx, id)
	if err != nil {
		return err
	}
	if err := q.MarkPurged(ctx, id); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for _, k := range keys { // rows are gone; blobs best-effort
		_ = s.media.DeleteKey(ctx, k.KeyFull)
		_ = s.media.DeleteKey(ctx, k.KeyThumb)
	}
	s.log.Info("purged closed space", "relationship", id, "photos", len(keys))
	return nil
}

// link.preview: fetch a pin's Open Graph preview (see previews.go).
func (s *Server) jobLinkPreview(ctx context.Context, payload []byte) error {
	id, err := parseID(payload, "pinId")
	if err != nil {
		return err
	}
	q := store.New(s.pool)
	p, err := q.GetPinAny(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if p.Url == nil || p.PreviewStatus != "pending" {
		return nil
	}
	defaultTitle := ""
	if u, err := url.Parse(*p.Url); err == nil {
		defaultTitle = strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	}
	params := store.SetPinPreviewParams{ID: p.ID, Status: "failed", DefaultTitle: defaultTitle}
	if page, err := s.unfurl.Page(ctx, *p.Url); err == nil {
		params.Status = "done"
		params.Site, params.Description, params.NewTitle = page.Site, page.Description, page.Title
		if page.ImageURL != "" {
			if raw, err := s.unfurl.Image(ctx, page.ImageURL); err == nil {
				// Stored like any photo: re-encoded, metadata dropped, served only to members.
				if m, err := s.media.Upload(ctx, p.RelationshipID, p.CreatedBy, bytes.NewReader(raw)); err == nil {
					params.MediaID = &m.ID
				}
			}
		}
	} else {
		s.log.Info("link preview failed", "pin", p.ID, "err", err)
	}
	if err := q.SetPinPreview(ctx, params); err != nil {
		return err
	}
	s.live.Publish(ctx, live.Event{Space: p.RelationshipID, Type: "pin.updated", ID: p.ID.String(), Actor: p.CreatedBy.String()})
	return nil
}
