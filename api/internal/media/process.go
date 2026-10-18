package media

import (
	"bytes"
	"errors"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"time"

	"github.com/disintegration/imaging"
	"github.com/rwcarlsen/goexif/exif"
	_ "golang.org/x/image/webp"
)

var (
	ErrUnsupported = errors.New("media: unsupported image")
	ErrTooLarge    = errors.New("media: image too large")
)

const (
	MaxUploadBytes = 25 << 20
	maxPixels      = 60_000_000 // decompression-bomb guard
	fullEdge       = 2560
	thumbEdge      = 640
)

type Processed struct {
	Full, Thumb   []byte
	Width, Height int
	TakenAt       *time.Time
}

// Process turns an upload into what we keep: orientation applied, every bit of
// metadata (GPS included) dropped by re-encoding, a display copy and a thumbnail.
func Process(raw []byte) (Processed, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return Processed{}, ErrUnsupported
	}
	switch format {
	case "jpeg", "png", "webp", "gif":
	default:
		return Processed{}, ErrUnsupported
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxPixels {
		return Processed{}, ErrTooLarge
	}

	var takenAt *time.Time
	if format == "jpeg" {
		if x, err := exif.Decode(bytes.NewReader(raw)); err == nil {
			if t, err := x.DateTime(); err == nil && t.Year() > 1990 && t.Before(time.Now().Add(48*time.Hour)) {
				takenAt = &t
			}
		}
	}

	img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
	if err != nil {
		return Processed{}, ErrUnsupported
	}
	full := fit(img, fullEdge)
	thumb := fit(img, thumbEdge)

	var fb, tb bytes.Buffer
	if err := jpeg.Encode(&fb, full, &jpeg.Options{Quality: 88}); err != nil {
		return Processed{}, err
	}
	if err := jpeg.Encode(&tb, thumb, &jpeg.Options{Quality: 80}); err != nil {
		return Processed{}, err
	}
	b := full.Bounds()
	return Processed{Full: fb.Bytes(), Thumb: tb.Bytes(), Width: b.Dx(), Height: b.Dy(), TakenAt: takenAt}, nil
}

func fit(img image.Image, edge int) image.Image {
	b := img.Bounds()
	if b.Dx() <= edge && b.Dy() <= edge {
		return imaging.Clone(img) // flatten to NRGBA (drops palette/alpha quirks)
	}
	return imaging.Fit(img, edge, edge, imaging.Lanczos)
}
