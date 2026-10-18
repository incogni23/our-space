// Package jobs is a small durable job queue on Postgres. Jobs are claimed with
// FOR UPDATE SKIP LOCKED (safe across API instances), retried with backoff,
// and enqueued inside the caller's transaction so they exist only if it commits.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
)

type Handler func(ctx context.Context, payload []byte) error

// permanent marks an error that retrying won't fix.
type permanent struct{ err error }

func (p permanent) Error() string { return p.err.Error() }
func (p permanent) Unwrap() error { return p.err }

// Permanent wraps err so the job is finished instead of retried.
func Permanent(err error) error { return permanent{err} }

// Enqueue adds a job using q (pass a transaction's Queries to make it atomic).
// A non-empty dedupe key replaces any pending job with the same key.
func Enqueue(ctx context.Context, q *store.Queries, kind string, payload any, runAt time.Time, dedupe string) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var key *string
	if dedupe != "" {
		key = &dedupe
	}
	return q.EnqueueJob(ctx, store.EnqueueJobParams{Kind: kind, Payload: b, RunAt: runAt, MaxAttempts: 8, DedupeKey: key})
}

// Cancel removes pending jobs whose dedupe key starts with prefix.
func Cancel(ctx context.Context, q *store.Queries, prefix string) error {
	return q.CancelJobsByPrefix(ctx, prefix)
}

type Runner struct {
	pool     *pgxpool.Pool
	log      *slog.Logger
	handlers map[string]Handler
	Every    time.Duration
}

func NewRunner(pool *pgxpool.Pool, log *slog.Logger) *Runner {
	return &Runner{pool: pool, log: log, handlers: map[string]Handler{}, Every: 2 * time.Second}
}

func (r *Runner) Handle(kind string, h Handler) { r.handlers[kind] = h }

// Run processes due jobs until ctx ends.
func (r *Runner) Run(ctx context.Context) {
	t := time.NewTicker(r.Every)
	defer t.Stop()
	for {
		for r.batch(ctx) > 0 && ctx.Err() == nil {
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func backoff(attempt int32) time.Duration {
	d := time.Duration(math.Pow(2, float64(attempt))) * 15 * time.Second
	if d > time.Hour {
		d = time.Hour
	}
	return d
}

func (r *Runner) batch(ctx context.Context) int {
	q := store.New(r.pool)
	claimed, err := q.ClaimJobs(ctx, 10)
	if err != nil {
		if ctx.Err() == nil {
			r.log.Warn("claiming jobs failed", "err", err)
		}
		return 0
	}
	for _, j := range claimed {
		r.run(ctx, q, j)
	}
	return len(claimed)
}

func (r *Runner) run(ctx context.Context, q *store.Queries, j store.ClaimJobsRow) {
	h, ok := r.handlers[j.Kind]
	if !ok {
		r.fail(ctx, q, j, Permanent(fmt.Errorf("no handler for %q", j.Kind)))
		return
	}
	jctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	err := func() (err error) {
		defer func() {
			if p := recover(); p != nil {
				err = fmt.Errorf("panic: %v", p)
			}
		}()
		return h(jctx, j.Payload)
	}()
	if err == nil {
		if err := q.CompleteJob(ctx, j.ID); err != nil {
			r.log.Warn("completing job failed", "job", j.ID, "err", err)
		}
		return
	}
	r.fail(ctx, q, j, err)
}

func (r *Runner) fail(ctx context.Context, q *store.Queries, j store.ClaimJobsRow, err error) {
	msg := err.Error()
	var p permanent
	if errors.As(err, &p) {
		r.log.Warn("job failed permanently", "job", j.ID, "kind", j.Kind, "err", msg)
		_ = q.CompleteJob(ctx, j.ID)
		return
	}
	r.log.Warn("job failed", "job", j.ID, "kind", j.Kind, "attempt", j.Attempts, "err", msg)
	if err := q.FailJob(ctx, store.FailJobParams{ID: j.ID, LastError: &msg, RunAt: time.Now().Add(backoff(j.Attempts))}); err != nil {
		r.log.Warn("recording job failure failed", "job", j.ID, "err", err)
	}
}
