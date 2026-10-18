// Package plans owns plans across two clocks (canvas D1–D3).
//
// A plan is an instant (UTC) plus the zone it's anchored to. Weekly plans repeat
// on the anchor zone's wall clock: "8:30 pm Bengaluru every Sunday" stays 8:30 pm
// there through DST changes elsewhere, and the other person's local time moves.
package plans

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/jobs"
	"betweenus/api/internal/store"
)

var (
	ErrNotFound    = errors.New("plans: not found")
	ErrInvalid     = errors.New("plans: invalid input")
	ErrInPast      = errors.New("plans: time is in the past")
	ErrNotYourTurn = errors.New("plans: waiting on the other person")
	ErrClosed      = errors.New("plans: plan is no longer open")
)

type Scope struct {
	SpaceID uuid.UUID
	UserID  uuid.UUID
}

type Service struct {
	pool *pgxpool.Pool
	Now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool, Now: time.Now} }

// View is a plan with its occurrences in a window (one for one-offs).
type View struct {
	Plan        store.Plan
	Occurrences []time.Time
}

func loc(tz string) *time.Location {
	if l, err := time.LoadLocation(tz); err == nil {
		return l
	}
	return time.UTC
}

// parseLocal reads "2006-01-02T15:04" as wall-clock time in tz.
func parseLocal(local, tz string) (time.Time, error) {
	l, err := time.LoadLocation(tz)
	if err != nil || tz == "" || len(tz) > 64 {
		return time.Time{}, ErrInvalid
	}
	t, err := time.ParseInLocation("2006-01-02T15:04", strings.TrimSpace(local), l)
	if err != nil {
		return time.Time{}, ErrInvalid
	}
	return t, nil
}

// Occurrences of p in [from, to), at most max.
func Occurrences(p store.Plan, from, to time.Time, max int) []time.Time {
	t := p.StartsAt.In(loc(p.AnchorTz))
	if p.Repeat != "weekly" {
		if !t.Before(from) && t.Before(to) {
			return []time.Time{t}
		}
		return nil
	}
	if t.Before(from) {
		if weeks := int(from.Sub(t).Hours()/(24*7)) - 1; weeks > 0 {
			t = t.AddDate(0, 0, 7*weeks)
		}
	}
	var out []time.Time
	for t.Before(to) && len(out) < max {
		if !t.Before(from) {
			out = append(out, t)
		}
		t = t.AddDate(0, 0, 7) // wall-clock week in the anchor zone
	}
	return out
}

func clean(s string, min, max int) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < min || n > max {
		return "", ErrInvalid
	}
	return s, nil
}

type NewPlan struct {
	Title        string
	Local        string // "2006-01-02T15:04" in TimeZone
	TimeZone     string
	Kind         string // plan | call
	Repeat       string // none | weekly
	Place        string
	Notes        string
	PinID        *uuid.UUID
	AskToConfirm bool
	Remind       string // none | evening_before | hour_before
}

const JobRemind = "plan.remind"

var reminds = map[string]bool{"none": true, "evening_before": true, "hour_before": true}

// remindAt: "evening_before" is 8 pm the day before, in that person's own zone.
func remindAt(kind string, occ time.Time, tz string) time.Time {
	if kind == "hour_before" {
		return occ.Add(-time.Hour)
	}
	l := loc(tz)
	d := occ.In(l)
	return time.Date(d.Year(), d.Month(), d.Day()-1, 20, 0, 0, 0, l)
}

// ScheduleReminders replaces a plan's pending reminders with ones for its next
// occurrence after `after`, one per person, in their own time.
func ScheduleReminders(ctx context.Context, q *store.Queries, p store.Plan, after time.Time) error {
	prefix := JobRemind + ":" + p.ID.String() + ":"
	if err := jobs.Cancel(ctx, q, prefix); err != nil {
		return err
	}
	if p.Remind == "none" || (p.Status != "proposed" && p.Status != "confirmed") {
		return nil
	}
	occ := Occurrences(p, after, after.AddDate(1, 0, 0), 2)
	members, err := q.MembersOf(ctx, p.RelationshipID)
	if err != nil {
		return err
	}
	for _, o := range occ {
		scheduled := false
		for _, m := range members {
			at := remindAt(p.Remind, o, m.TimeZone)
			if !at.After(after) {
				continue
			}
			payload := map[string]string{"planId": p.ID.String(), "userId": m.ID.String(), "occurrence": o.UTC().Format(time.RFC3339)}
			if err := jobs.Enqueue(ctx, q, JobRemind, payload, at, prefix+m.ID.String()); err != nil {
				return err
			}
			scheduled = true
		}
		if scheduled {
			return nil // next occurrence covered; later ones are scheduled as each fires
		}
	}
	return nil
}

func (s *Service) Create(ctx context.Context, sc Scope, in NewPlan) (store.Plan, error) {
	title, err := clean(in.Title, 1, 120)
	if err != nil {
		return store.Plan{}, err
	}
	place, err := clean(in.Place, 0, 200)
	if err != nil {
		return store.Plan{}, err
	}
	notes, err := clean(in.Notes, 0, 1000)
	if err != nil {
		return store.Plan{}, err
	}
	if in.Kind == "" {
		in.Kind = "plan"
	}
	if in.Repeat == "" {
		in.Repeat = "none"
	}
	if in.Remind == "" {
		in.Remind = "none"
	}
	if (in.Kind != "plan" && in.Kind != "call") || (in.Repeat != "none" && in.Repeat != "weekly") || !reminds[in.Remind] {
		return store.Plan{}, ErrInvalid
	}
	starts, err := parseLocal(in.Local, in.TimeZone)
	if err != nil {
		return store.Plan{}, err
	}
	if starts.Before(s.Now().Add(-5 * time.Minute)) {
		return store.Plan{}, ErrInPast
	}
	status := "confirmed"
	if in.AskToConfirm {
		status = "proposed"
	}

	var p store.Plan
	err = s.inTx(ctx, func(q *store.Queries) error {
		if in.PinID != nil {
			if _, err := q.GetPin(ctx, store.GetPinParams{ID: *in.PinID, RelationshipID: sc.SpaceID}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
			if err := q.MarkPinPlanned(ctx, store.MarkPinPlannedParams{ID: *in.PinID, RelationshipID: sc.SpaceID}); err != nil {
				return err
			}
		}
		var err error
		p, err = q.CreatePlan(ctx, store.CreatePlanParams{
			RelationshipID: sc.SpaceID, CreatedBy: sc.UserID, PinID: in.PinID, Kind: in.Kind, Title: title,
			Place: place, Notes: notes, StartsAt: starts.UTC(), AnchorTz: in.TimeZone, Repeat: in.Repeat, Status: status,
		})
		if err != nil {
			return err
		}
		if err := q.SetPlanRemind(ctx, store.SetPlanRemindParams{ID: p.ID, RelationshipID: sc.SpaceID, Remind: in.Remind}); err != nil {
			return err
		}
		p.Remind = in.Remind
		return ScheduleReminders(ctx, q, p, s.Now())
	})
	return p, err
}

// List returns live plans with their occurrences in [from, to), soonest first.
func (s *Service) List(ctx context.Context, sc Scope, from, to time.Time) ([]View, error) {
	rows, err := store.New(s.pool).LivePlans(ctx, store.LivePlansParams{RelationshipID: sc.SpaceID, FromAt: from, ToAt: to})
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(rows))
	for _, p := range rows {
		occ := Occurrences(p, from, to, 60)
		if len(occ) > 0 {
			out = append(out, View{Plan: p, Occurrences: occ})
		}
	}
	return out, nil
}

// Get returns a plan with its next few occurrences (for DST notes on weekly plans).
func (s *Service) Get(ctx context.Context, sc Scope, id uuid.UUID) (View, error) {
	p, err := store.New(s.pool).GetPlan(ctx, store.GetPlanParams{ID: id, RelationshipID: sc.SpaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	now := s.Now()
	occ := Occurrences(p, now.Add(-2*time.Hour), now.AddDate(0, 3, 0), 12)
	if p.Repeat == "none" && len(occ) == 0 {
		occ = []time.Time{p.StartsAt.In(loc(p.AnchorTz))}
	}
	return View{Plan: p, Occurrences: occ}, nil
}

// Respond: accept, decline, suggest another time, or accept a suggestion.
// Whoever made the last move waits for the other person.
func (s *Service) Respond(ctx context.Context, sc Scope, id uuid.UUID, action, local, tz string) (store.Plan, error) {
	var out store.Plan
	err := s.inTx(ctx, func(q *store.Queries) error {
		var err error
		if out, err = s.respond(ctx, q, sc, id, action, local, tz); err != nil {
			return err
		}
		return ScheduleReminders(ctx, q, out, s.Now())
	})
	return out, err
}

// respond applies one answer and returns the updated plan.
func (s *Service) respond(ctx context.Context, q *store.Queries, sc Scope, id uuid.UUID, action, local, tz string) (store.Plan, error) {
	var out store.Plan
	err := func() error {
		p, err := q.GetPlanForUpdate(ctx, store.GetPlanForUpdateParams{ID: id, RelationshipID: sc.SpaceID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if p.Status != "proposed" {
			return ErrClosed
		}
		lastMover := p.CreatedBy
		if p.SuggestedBy != nil {
			lastMover = *p.SuggestedBy
		}
		if lastMover == sc.UserID {
			return ErrNotYourTurn
		}
		me := sc.UserID
		switch action {
		case "accept":
			if p.SuggestedStartsAt != nil {
				out, err = q.AcceptSuggestion(ctx, store.AcceptSuggestionParams{ID: id, RelationshipID: sc.SpaceID, RespondedBy: &me})
				return err
			}
			out, err = q.RespondToPlan(ctx, store.RespondToPlanParams{ID: id, RelationshipID: sc.SpaceID, Status: "confirmed", RespondedBy: &me})
			return err
		case "decline":
			out, err = q.RespondToPlan(ctx, store.RespondToPlanParams{ID: id, RelationshipID: sc.SpaceID, Status: "declined", RespondedBy: &me})
			return err
		case "suggest":
			t, err := parseLocal(local, tz)
			if err != nil {
				return err
			}
			if t.Before(s.Now()) {
				return ErrInPast
			}
			tu := t.UTC()
			out, err = q.RespondToPlan(ctx, store.RespondToPlanParams{
				ID: id, RelationshipID: sc.SpaceID, Status: "proposed", RespondedBy: &me, SuggestedStartsAt: &tu, SuggestedBy: &me,
			})
			return err
		}
		return ErrInvalid
	}()
	return out, err
}

type Edit struct {
	Title    string
	Place    string
	Notes    string
	Local    string
	TimeZone string
	Repeat   string
	Remind   string
}

// Update edits a plan. Moving the time always goes back to the other person:
// the creator's move re-proposes the plan; the partner's move becomes a suggestion.
func (s *Service) Update(ctx context.Context, sc Scope, id uuid.UUID, in Edit) (store.Plan, error) {
	title, err := clean(in.Title, 1, 120)
	if err != nil {
		return store.Plan{}, err
	}
	place, err := clean(in.Place, 0, 200)
	if err != nil {
		return store.Plan{}, err
	}
	notes, err := clean(in.Notes, 0, 1000)
	if err != nil {
		return store.Plan{}, err
	}
	if in.Repeat != "none" && in.Repeat != "weekly" {
		return store.Plan{}, ErrInvalid
	}
	if in.Remind != "" && !reminds[in.Remind] {
		return store.Plan{}, ErrInvalid
	}
	starts, err := parseLocal(in.Local, in.TimeZone)
	if err != nil {
		return store.Plan{}, err
	}
	var out store.Plan
	err = s.inTx(ctx, func(q *store.Queries) error {
		var err error
		if out, err = s.update(ctx, q, sc, id, in, title, place, notes, starts); err != nil {
			return err
		}
		if in.Remind != "" && in.Remind != out.Remind {
			if err := q.SetPlanRemind(ctx, store.SetPlanRemindParams{ID: id, RelationshipID: sc.SpaceID, Remind: in.Remind}); err != nil {
				return err
			}
			out.Remind = in.Remind
		}
		return ScheduleReminders(ctx, q, out, s.Now())
	})
	return out, err
}

// update applies an edit and returns the updated plan.
func (s *Service) update(ctx context.Context, q *store.Queries, sc Scope, id uuid.UUID, in Edit, title, place, notes string, starts time.Time) (store.Plan, error) {
	var out store.Plan
	err := func() error {
		p, err := q.GetPlanForUpdate(ctx, store.GetPlanForUpdateParams{ID: id, RelationshipID: sc.SpaceID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if p.Status != "proposed" && p.Status != "confirmed" {
			return ErrClosed
		}
		moved := !starts.Equal(p.StartsAt) || in.Repeat != p.Repeat
		if moved && starts.Before(s.Now().Add(-5*time.Minute)) {
			return ErrInPast
		}
		if moved && p.CreatedBy != sc.UserID {
			// Partner: keep the plan's time, record theirs as a suggestion.
			out, err = q.EditPlan(ctx, store.EditPlanParams{
				ID: id, RelationshipID: sc.SpaceID, Title: title, Place: place, Notes: notes,
				StartsAt: p.StartsAt, AnchorTz: p.AnchorTz, Repeat: p.Repeat, Status: "proposed",
			})
			if err != nil {
				return err
			}
			me, tu := sc.UserID, starts.UTC()
			out, err = q.RespondToPlan(ctx, store.RespondToPlanParams{
				ID: id, RelationshipID: sc.SpaceID, Status: "proposed", RespondedBy: &me, SuggestedStartsAt: &tu, SuggestedBy: &me,
			})
			return err
		}
		status := p.Status
		if moved {
			status = "proposed"
		}
		out, err = q.EditPlan(ctx, store.EditPlanParams{
			ID: id, RelationshipID: sc.SpaceID, Title: title, Place: place, Notes: notes,
			StartsAt: starts.UTC(), AnchorTz: in.TimeZone, Repeat: in.Repeat, Status: status,
		})
		return err
	}()
	return out, err
}

func (s *Service) Cancel(ctx context.Context, sc Scope, id uuid.UUID) error {
	return s.inTx(ctx, func(q *store.Queries) error {
		n, err := q.CancelPlan(ctx, store.CancelPlanParams{ID: id, RelationshipID: sc.SpaceID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return jobs.Cancel(ctx, q, JobRemind+":"+id.String()+":")
	})
}

func (s *Service) inTx(ctx context.Context, fn func(q *store.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(store.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
