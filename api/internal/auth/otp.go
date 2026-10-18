package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"math/big"
)

// Provider sends phone codes. A provider that generates and checks codes itself
// (e.g. Twilio Verify) returns an empty code from Start and implements Check.
// A provider that only delivers returns the code it sent, and the service checks
// a keyed hash of it locally.
type Provider interface {
	Name() string
	Start(ctx context.Context, phone string) (ref, code string, err error)
	Check(ctx context.Context, ref, phone, code string) (bool, error)
}

// DevProvider logs codes instead of sending them. Never use in production.
type DevProvider struct {
	Log *slog.Logger
	// FixedCode, if set, is used instead of a random code (for end-to-end tests).
	FixedCode string
}

func (DevProvider) Name() string { return "dev" }

func (p DevProvider) Start(ctx context.Context, phone string) (string, string, error) {
	code := p.FixedCode
	if code == "" {
		n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
		if err != nil {
			return "", "", err
		}
		code = fmt.Sprintf("%06d", n.Int64())
	}
	if p.Log != nil {
		p.Log.Info("dev otp", "phone", phone, "code", code)
	}
	return "dev", code, nil
}

func (DevProvider) Check(context.Context, string, string, string) (bool, error) {
	return false, fmt.Errorf("dev provider codes are checked locally")
}
