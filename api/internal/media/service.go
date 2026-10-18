package media

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
)

var ErrNotFound = errors.New("media: not found")

type Service struct {
	pool  *pgxpool.Pool
	blobs Blobs
}

func NewService(pool *pgxpool.Pool, blobs Blobs) *Service {
	return &Service{pool: pool, blobs: blobs}
}

func keys(spaceID, id uuid.UUID) (full, thumb string) {
	base := fmt.Sprintf("spaces/%s/media/%s", spaceID, id)
	return base + "/full.jpg", base + "/thumb.jpg"
}

// Upload processes and stores a photo for the space.
func (s *Service) Upload(ctx context.Context, spaceID, userID uuid.UUID, r io.Reader) (store.Medium, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxUploadBytes+1))
	if err != nil {
		return store.Medium{}, err
	}
	if len(raw) > MaxUploadBytes {
		return store.Medium{}, ErrTooLarge
	}
	p, err := Process(raw)
	if err != nil {
		return store.Medium{}, err
	}
	id := uuid.New()
	kf, kt := keys(spaceID, id)
	if err := s.blobs.Put(ctx, kf, p.Full, "image/jpeg"); err != nil {
		return store.Medium{}, err
	}
	if err := s.blobs.Put(ctx, kt, p.Thumb, "image/jpeg"); err != nil {
		_ = s.blobs.Delete(ctx, kf)
		return store.Medium{}, err
	}
	m, err := store.New(s.pool).CreateMedia(ctx, store.CreateMediaParams{
		ID: id, RelationshipID: spaceID, UploadedBy: userID, Width: int32(p.Width), Height: int32(p.Height),
		Bytes: int64(len(p.Full)), KeyFull: kf, KeyThumb: kt, TakenAt: p.TakenAt,
	})
	if err != nil {
		_ = s.blobs.Delete(ctx, kf)
		_ = s.blobs.Delete(ctx, kt)
		return store.Medium{}, err
	}
	return m, nil
}

// Open streams a variant ("full" or "thumb") of a photo in the space.
func (s *Service) Open(ctx context.Context, spaceID, id uuid.UUID, variant string) (io.ReadCloser, error) {
	m, err := store.New(s.pool).GetMedia(ctx, store.GetMediaParams{ID: id, RelationshipID: spaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	key := m.KeyThumb
	if variant == "full" {
		key = m.KeyFull
	}
	rc, err := s.blobs.Get(ctx, key)
	if errors.Is(err, ErrBlobNotFound) {
		return nil, ErrNotFound
	}
	return rc, err
}
