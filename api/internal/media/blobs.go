// Package media stores and serves photos. Bytes live in a Blobs store (a local
// folder in development, any S3-compatible service otherwise); metadata in Postgres.
package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Blobs is the minimum the app needs from object storage.
type Blobs interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

var ErrBlobNotFound = errors.New("media: blob not found")

// FSBlobs keeps objects under a folder. For development only.
type FSBlobs struct{ Root string }

func (f FSBlobs) path(key string) (string, error) {
	clean := filepath.Clean("/" + key)
	if strings.Contains(clean, "..") {
		return "", fmt.Errorf("media: bad key")
	}
	return filepath.Join(f.Root, clean), nil
}

func (f FSBlobs) Put(_ context.Context, key string, data []byte, _ string) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (f FSBlobs) Get(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := f.path(key)
	if err != nil {
		return nil, err
	}
	fh, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrBlobNotFound
	}
	return fh, err
}

func (f FSBlobs) Delete(_ context.Context, key string) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// S3Blobs works with MinIO, AWS S3, Cloudflare R2 and other S3-compatible stores.
type S3Blobs struct {
	client *minio.Client
	bucket string
}

type S3Config struct {
	Endpoint  string // host[:port], no scheme
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	UseSSL    bool
}

func NewS3Blobs(cfg S3Config) (*S3Blobs, error) {
	c, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, err
	}
	return &S3Blobs{client: c, bucket: cfg.Bucket}, nil
}

func (s *S3Blobs) Put(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (s *S3Blobs) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrBlobNotFound
		}
		return nil, err
	}
	return obj, nil
}

func (s *S3Blobs) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}
