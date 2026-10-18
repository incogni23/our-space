// Package story owns Our Story (canvas E0): moments, trips, changes and the start.
package story

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
)

var (
	ErrNotFound = errors.New("story: not found")
	ErrInvalid  = errors.New("story: invalid input")
)

const MaxPhotos = 30

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type NewMemory struct {
	Kind       string
	Title      string
	Caption    string
	Place      string
	HappenedOn string // YYYY-MM-DD
	EndsOn     string // optional, trips
	MediaIDs   []uuid.UUID
}

func clean(s string, min, max int) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < min || n > max {
		return "", ErrInvalid
	}
	return s, nil
}

func day(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(s))
	if err != nil || t.Year() < 1900 || t.After(time.Now().AddDate(1, 0, 0)) {
		return time.Time{}, ErrInvalid
	}
	return t, nil
}

var kinds = map[string]bool{"moment": true, "trip": true, "change": true, "start": true}

func (s *Service) Create(ctx context.Context, spaceID, userID uuid.UUID, in NewMemory) (store.Memory, error) {
	if !kinds[in.Kind] {
		return store.Memory{}, ErrInvalid
	}
	title, err := clean(in.Title, 1, 120)
	if err != nil {
		return store.Memory{}, err
	}
	caption, err := clean(in.Caption, 0, 500)
	if err != nil {
		return store.Memory{}, err
	}
	place, err := clean(in.Place, 0, 120)
	if err != nil {
		return store.Memory{}, err
	}
	from, err := day(in.HappenedOn)
	if err != nil {
		return store.Memory{}, err
	}
	var to *time.Time
	if strings.TrimSpace(in.EndsOn) != "" {
		t, err := day(in.EndsOn)
		if err != nil || t.Before(from) {
			return store.Memory{}, ErrInvalid
		}
		to = &t
	}
	ids := dedupe(in.MediaIDs)
	if len(ids) > MaxPhotos {
		return store.Memory{}, ErrInvalid
	}

	var m store.Memory
	err = s.inTx(ctx, func(q *store.Queries) error {
		if len(ids) > 0 {
			n, err := q.CountOwnMedia(ctx, store.CountOwnMediaParams{RelationshipID: spaceID, Ids: ids})
			if err != nil {
				return err
			}
			if int(n) != len(ids) {
				return ErrInvalid
			}
		}
		var err error
		m, err = q.CreateMemory(ctx, store.CreateMemoryParams{
			RelationshipID: spaceID, CreatedBy: userID, Kind: in.Kind, Title: title, Caption: caption,
			Place: place, HappenedOn: from, EndsOn: to,
		})
		if err != nil {
			return err
		}
		for i, id := range ids {
			if err := q.AttachMedia(ctx, store.AttachMediaParams{MemoryID: m.ID, MediaID: id, Position: int32(i)}); err != nil {
				return err
			}
		}
		return nil
	})
	return m, err
}

func dedupe(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func (s *Service) List(ctx context.Context, spaceID uuid.UUID) ([]store.ListMemoriesRow, error) {
	return store.New(s.pool).ListMemories(ctx, spaceID)
}

type Detail struct {
	Memory store.Memory
	Photos []store.MemoryMediaRow
}

func (s *Service) Get(ctx context.Context, spaceID, id uuid.UUID) (Detail, error) {
	q := store.New(s.pool)
	m, err := q.GetMemory(ctx, store.GetMemoryParams{ID: id, RelationshipID: spaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	photos, err := q.MemoryMedia(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	return Detail{Memory: m, Photos: photos}, nil
}

func (s *Service) Delete(ctx context.Context, spaceID, id uuid.UUID) error {
	n, err := store.New(s.pool).DeleteMemory(ctx, store.DeleteMemoryParams{ID: id, RelationshipID: spaceID})
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
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
