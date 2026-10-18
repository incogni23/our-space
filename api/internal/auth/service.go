// Package auth handles phone verification, sessions and second factors.
//
// A phone code proves control of a number. It is never, on its own, enough to open
// an existing space on a device the account hasn't used: that session starts as
// "needs_second_factor" until a recovery code (later: backup email) is used.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
	"betweenus/api/internal/token"
)

var (
	ErrInvalidPhone      = errors.New("auth: invalid phone number")
	ErrInvalidPurpose    = errors.New("auth: invalid verification purpose")
	ErrVerificationGone  = errors.New("auth: verification expired or already used")
	ErrWrongCode         = errors.New("auth: wrong code")
	ErrTooManyAttempts   = errors.New("auth: too many attempts")
	ErrUnauthenticated   = errors.New("auth: not signed in")
	ErrNeedsSecondFactor = errors.New("auth: second factor required")
	ErrNoSecondFactor    = errors.New("auth: session does not need a second factor")
	ErrWrongRecoveryCode = errors.New("auth: recovery code not recognised")
	ErrApprovalMissing   = errors.New("auth: recent phone confirmation required")
	ErrPhoneInUse        = errors.New("auth: number belongs to another account")
	ErrSamePhone         = errors.New("auth: that is already your number")
	ErrInvalidProfile    = errors.New("auth: invalid profile")
)

// RateLimitError says when another code may be requested.
type RateLimitError struct{ RetryAfter time.Duration }

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("auth: too many codes, retry after %s", e.RetryAfter.Round(time.Second))
}

const (
	PurposeSignIn       = "sign_in"
	PurposeChangeNumber = "change_number"
	PurposeLeave        = "leave"

	SessionActive            = "active"
	SessionNeedsSecondFactor = "needs_second_factor"
	SessionRevoked           = "revoked"
)

type Service struct {
	pool     *pgxpool.Pool
	provider Provider
	pepper   []byte

	Now           func() time.Time
	CodeTTL       time.Duration
	MaxAttempts   int32
	ResendAfter   time.Duration
	PerPhoneHour  int64
	PerIPHour     int64
	SessionTTL    time.Duration
	ApprovalValid time.Duration
}

// NewService: pepper is a server secret mixed into stored code hashes, so a
// database leak alone can't be used to brute-force short codes.
func NewService(pool *pgxpool.Pool, provider Provider, pepper []byte) *Service {
	return &Service{
		pool:          pool,
		provider:      provider,
		pepper:        pepper,
		Now:           time.Now,
		CodeTTL:       10 * time.Minute,
		MaxAttempts:   5,
		ResendAfter:   30 * time.Second,
		PerPhoneHour:  5,
		PerIPHour:     20,
		SessionTTL:    180 * 24 * time.Hour,
		ApprovalValid: 10 * time.Minute,
	}
}

var e164 = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)

// NormalizePhone strips spacing and punctuation and requires E.164.
func NormalizePhone(s string) (string, error) {
	r := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "")
	s = r.Replace(strings.TrimSpace(s))
	if strings.HasPrefix(s, "00") {
		s = "+" + s[2:]
	}
	if !e164.MatchString(s) {
		return "", ErrInvalidPhone
	}
	return s, nil
}

func (s *Service) keyed(kind, v string) []byte {
	m := hmac.New(sha256.New, s.pepper)
	m.Write([]byte(kind))
	m.Write([]byte{0})
	m.Write([]byte(v))
	return m.Sum(nil)
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

type StartInput struct {
	Phone   string
	Purpose string
	UserID  *uuid.UUID // required for change_number and leave
	IP      *netip.Addr
}

// StartVerification sends a code and returns the verification id.
func (s *Service) StartVerification(ctx context.Context, in StartInput) (uuid.UUID, error) {
	phone, err := NormalizePhone(in.Phone)
	if err != nil {
		return uuid.Nil, err
	}
	switch in.Purpose {
	case PurposeSignIn:
	case PurposeChangeNumber, PurposeLeave:
		if in.UserID == nil {
			return uuid.Nil, ErrUnauthenticated
		}
	default:
		return uuid.Nil, ErrInvalidPurpose
	}
	q := store.New(s.pool)
	now := s.Now()

	if last, err := q.LatestVerificationAt(ctx, phone); err == nil {
		if wait := last.Add(s.ResendAfter).Sub(now); wait > 0 {
			return uuid.Nil, &RateLimitError{RetryAfter: wait}
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	hourAgo := now.Add(-time.Hour)
	if n, err := q.CountVerificationsByPhoneSince(ctx, store.CountVerificationsByPhoneSinceParams{PhoneE164: phone, CreatedAt: hourAgo}); err != nil {
		return uuid.Nil, err
	} else if n >= s.PerPhoneHour {
		return uuid.Nil, &RateLimitError{RetryAfter: time.Hour}
	}
	if in.IP != nil {
		if n, err := q.CountVerificationsByIPSince(ctx, store.CountVerificationsByIPSinceParams{RequestIp: in.IP, CreatedAt: hourAgo}); err != nil {
			return uuid.Nil, err
		} else if n >= s.PerIPHour {
			return uuid.Nil, &RateLimitError{RetryAfter: time.Hour}
		}
	}

	ref, code, err := s.provider.Start(ctx, phone)
	if err != nil {
		return uuid.Nil, fmt.Errorf("auth: send code: %w", err)
	}
	var codeHash []byte
	if code != "" {
		codeHash = s.keyed("otp:"+phone, code)
	}
	v, err := q.CreateVerification(ctx, store.CreateVerificationParams{
		PhoneE164: phone, Purpose: in.Purpose, UserID: in.UserID,
		Provider: s.provider.Name(), ProviderRef: ref, CodeHash: codeHash,
		RequestIp: in.IP, CreatedAt: now, ExpiresAt: now.Add(s.CodeTTL),
	})
	if err != nil {
		return uuid.Nil, err
	}
	return v.ID, nil
}

// checkCode approves a pending verification if the code is right. Wrong attempts
// are committed even though an error is returned.
func (s *Service) checkCode(ctx context.Context, id uuid.UUID, code string, purpose string, userID *uuid.UUID) (store.PhoneVerification, error) {
	var (
		v      store.PhoneVerification
		result error
	)
	code = strings.TrimSpace(code)
	err := s.inTx(ctx, func(q *store.Queries) error {
		var err error
		v, err = q.GetVerificationForUpdate(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			result = ErrVerificationGone
			return nil
		}
		if err != nil {
			return err
		}
		if v.Purpose != purpose || (userID != nil && (v.UserID == nil || *v.UserID != *userID)) {
			result = ErrVerificationGone
			return nil
		}
		now := s.Now()
		if v.Status != "pending" {
			result = ErrVerificationGone
			return nil
		}
		if !now.Before(v.ExpiresAt) {
			result = ErrVerificationGone
			return q.UpdateVerification(ctx, store.UpdateVerificationParams{ID: v.ID, Status: "expired", Attempts: v.Attempts, CompletedAt: &now})
		}
		attempts := v.Attempts + 1
		ok, err := s.codeMatches(ctx, v, code)
		if err != nil {
			return err
		}
		switch {
		case ok:
			v.Status, v.CompletedAt = "approved", &now
		case attempts >= s.MaxAttempts:
			v.Status, v.CompletedAt = "failed", &now
			result = ErrTooManyAttempts
		default:
			result = ErrWrongCode
		}
		v.Attempts = attempts
		return q.UpdateVerification(ctx, store.UpdateVerificationParams{ID: v.ID, Status: v.Status, Attempts: attempts, CompletedAt: v.CompletedAt})
	})
	if err != nil {
		return v, err
	}
	return v, result
}

func (s *Service) codeMatches(ctx context.Context, v store.PhoneVerification, code string) (bool, error) {
	if v.CodeHash != nil {
		return hmac.Equal(v.CodeHash, s.keyed("otp:"+v.PhoneE164, code)), nil
	}
	return s.provider.Check(ctx, v.ProviderRef, v.PhoneE164, code)
}

// Device identifies the browser or phone signing in. ID is a long-lived random
// value the client keeps (cookie / secure storage); only its hash is stored.
type Device struct {
	ID    string
	Label string
}

type SignIn struct {
	Token   string
	Session store.Session
	User    store.User
	NewUser bool
}

// VerifySignIn checks the code and signs in, creating the account if the number is new.
func (s *Service) VerifySignIn(ctx context.Context, verificationID uuid.UUID, code string, dev Device) (SignIn, error) {
	v, err := s.checkCode(ctx, verificationID, code, PurposeSignIn, nil)
	if err != nil {
		return SignIn{}, err
	}
	var out SignIn
	err = s.inTx(ctx, func(q *store.Queries) error {
		now := s.Now()
		phone := v.PhoneE164
		u, err := q.GetUserByPhoneForUpdate(ctx, &phone)
		status := SessionActive
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			u, err = q.CreateUser(ctx, store.CreateUserParams{PhoneE164: &phone, PhoneVerifiedAt: &now})
			if err != nil {
				return err
			}
			out.NewUser = true
		case err != nil:
			return err
		default:
			if err := q.SetUserPhone(ctx, store.SetUserPhoneParams{ID: u.ID, PhoneE164: &phone, PhoneVerifiedAt: &now}); err != nil {
				return err
			}
			trusted, err := q.DeviceTrusted(ctx, store.DeviceTrustedParams{UserID: u.ID, DeviceHash: deviceHash(dev)})
			if err != nil {
				return err
			}
			history, err := q.UserHasHistory(ctx, u.ID)
			if err != nil {
				return err
			}
			if history && !trusted {
				status = SessionNeedsSecondFactor
			}
		}
		out.User = u
		out.Token, out.Session, err = s.newSession(ctx, q, u.ID, dev, status)
		return err
	})
	return out, err
}

func deviceHash(dev Device) []byte {
	if dev.ID == "" {
		return []byte{}
	}
	return token.Hash("device:" + dev.ID)
}

func (s *Service) newSession(ctx context.Context, q *store.Queries, userID uuid.UUID, dev Device, status string) (string, store.Session, error) {
	plain, hash := token.New()
	now := s.Now()
	sess, err := q.CreateSession(ctx, store.CreateSessionParams{
		UserID: userID, TokenHash: hash, DeviceHash: deviceHash(dev), DeviceLabel: truncate(dev.Label, 80),
		Status: status, CreatedAt: now, ExpiresAt: now.Add(s.SessionTTL),
	})
	return plain, sess, err
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// Authenticate resolves a session token. Sessions waiting for a second factor are
// returned with ErrNeedsSecondFactor so callers can allow only the recovery routes.
func (s *Service) Authenticate(ctx context.Context, plain string) (store.Session, error) {
	if plain == "" {
		return store.Session{}, ErrUnauthenticated
	}
	q := store.New(s.pool)
	sess, err := q.GetSessionByToken(ctx, token.Hash(plain))
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Session{}, ErrUnauthenticated
	}
	if err != nil {
		return store.Session{}, err
	}
	now := s.Now()
	if sess.Status == SessionRevoked || !now.Before(sess.ExpiresAt) {
		return store.Session{}, ErrUnauthenticated
	}
	if now.Sub(sess.LastSeenAt) > 5*time.Minute {
		_ = q.TouchSession(ctx, store.TouchSessionParams{ID: sess.ID, LastSeenAt: now})
	}
	if sess.Status == SessionNeedsSecondFactor {
		return sess, ErrNeedsSecondFactor
	}
	return sess, nil
}

func (s *Service) SignOut(ctx context.Context, plain string) error {
	sess, err := store.New(s.pool).GetSessionByToken(ctx, token.Hash(plain))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return store.New(s.pool).SetSessionStatus(ctx, store.SetSessionStatusParams{ID: sess.ID, Status: SessionRevoked})
}

const recoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

func normalizeRecovery(code string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' {
			return -1
		}
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return r
	}, code)
}

// GenerateRecoveryCodes replaces the user's unused codes with 8 new ones, shown once.
func (s *Service) GenerateRecoveryCodes(ctx context.Context, userID uuid.UUID) ([]string, error) {
	codes := make([]string, 8)
	for i := range codes {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		for j := range b {
			b[j] = recoveryAlphabet[int(b[j])%len(recoveryAlphabet)]
		}
		codes[i] = string(b[:5]) + "-" + string(b[5:])
	}
	err := s.inTx(ctx, func(q *store.Queries) error {
		if err := q.DeleteUnusedRecoveryCodes(ctx, userID); err != nil {
			return err
		}
		now := s.Now()
		for _, c := range codes {
			if err := q.InsertRecoveryCode(ctx, store.InsertRecoveryCodeParams{
				UserID: userID, CodeHash: s.keyed("recovery:"+userID.String(), normalizeRecovery(c)), CreatedAt: now,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	return codes, err
}

// MaxSecondFactorAttempts wrong recovery codes revoke the pending session.
const MaxSecondFactorAttempts = 5

// CompleteWithRecoveryCode upgrades a needs_second_factor session to active (G5).
// Wrong codes are counted (and committed); too many revoke the session.
func (s *Service) CompleteWithRecoveryCode(ctx context.Context, sessionToken, code string) (store.Session, error) {
	var (
		sess   store.Session
		result error
	)
	err := s.inTx(ctx, func(q *store.Queries) error {
		var err error
		sess, err = q.GetSessionByTokenForUpdate(ctx, token.Hash(sessionToken))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUnauthenticated
		}
		if err != nil {
			return err
		}
		if sess.Status != SessionNeedsSecondFactor {
			return ErrNoSecondFactor
		}
		now := s.Now()
		n, err := q.UseRecoveryCode(ctx, store.UseRecoveryCodeParams{
			UserID: sess.UserID, CodeHash: s.keyed("recovery:"+sess.UserID.String(), normalizeRecovery(code)), UsedAt: &now,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			attempts, err := q.BumpSecondFactorAttempts(ctx, sess.ID)
			if err != nil {
				return err
			}
			if attempts >= MaxSecondFactorAttempts {
				result = ErrTooManyAttempts
				return q.SetSessionStatus(ctx, store.SetSessionStatusParams{ID: sess.ID, Status: SessionRevoked})
			}
			result = ErrWrongRecoveryCode
			return nil
		}
		sess.Status = SessionActive
		return q.SetSessionStatus(ctx, store.SetSessionStatusParams{ID: sess.ID, Status: SessionActive})
	})
	if err != nil {
		return sess, err
	}
	return sess, result
}

// StartFresh is "This number is new to me" (G5): the number moves to a brand-new
// account. The previous account keeps its data and its existing sessions, loses
// the number, and stays locked to its owner's other recovery methods.
func (s *Service) StartFresh(ctx context.Context, sessionToken string, dev Device) (SignIn, error) {
	var out SignIn
	err := s.inTx(ctx, func(q *store.Queries) error {
		sess, err := q.GetSessionByTokenForUpdate(ctx, token.Hash(sessionToken))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUnauthenticated
		}
		if err != nil {
			return err
		}
		if sess.Status != SessionNeedsSecondFactor {
			return ErrNoSecondFactor
		}
		old, err := q.GetUserForUpdate(ctx, sess.UserID)
		if err != nil {
			return err
		}
		if old.PhoneE164 == nil {
			return ErrUnauthenticated
		}
		phone := *old.PhoneE164
		now := s.Now()
		if err := q.ReleaseUserPhone(ctx, store.ReleaseUserPhoneParams{ID: old.ID, UpdatedAt: now}); err != nil {
			return err
		}
		if err := q.SetSessionStatus(ctx, store.SetSessionStatusParams{ID: sess.ID, Status: SessionRevoked}); err != nil {
			return err
		}
		out.User, err = q.CreateUser(ctx, store.CreateUserParams{PhoneE164: &phone, PhoneVerifiedAt: &now})
		if err != nil {
			return err
		}
		out.NewUser = true
		out.Token, out.Session, err = s.newSession(ctx, q, out.User.ID, dev, SessionActive)
		return err
	})
	return out, err
}

// ApproveForUser checks a code for a verification started by a signed-in user
// (purposes change_number and leave). The approval is spent later with ConsumeApproval.
func (s *Service) ApproveForUser(ctx context.Context, userID, verificationID uuid.UUID, purpose, code string) error {
	_, err := s.checkCode(ctx, verificationID, code, purpose, &userID)
	return err
}

// ConsumeApproval spends a recent approval of the given phone for the given purpose.
func (s *Service) ConsumeApproval(ctx context.Context, q *store.Queries, userID, verificationID uuid.UUID, purpose, phone string) error {
	if q == nil {
		q = store.New(s.pool)
	}
	now := s.Now()
	since := now.Add(-s.ApprovalValid)
	n, err := q.ConsumeVerification(ctx, store.ConsumeVerificationParams{
		ID: verificationID, UserID: &userID, Purpose: purpose, CompletedAt: &since, ConsumedAt: &now, PhoneE164: phone,
	})
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrApprovalMissing
	}
	return nil
}

// ChangeNumber moves the account to a new number (G4). It needs a fresh approval
// of the current number and of the new one.
func (s *Service) ChangeNumber(ctx context.Context, userID, currentApproval, newApproval uuid.UUID, newPhone string) (store.User, error) {
	newPhone, err := NormalizePhone(newPhone)
	if err != nil {
		return store.User{}, err
	}
	var u store.User
	err = s.inTx(ctx, func(q *store.Queries) error {
		var err error
		u, err = q.GetUserForUpdate(ctx, userID)
		if err != nil {
			return err
		}
		if u.PhoneE164 == nil {
			return ErrApprovalMissing
		}
		if *u.PhoneE164 == newPhone {
			return ErrSamePhone
		}
		if err := s.ConsumeApproval(ctx, q, userID, currentApproval, PurposeChangeNumber, *u.PhoneE164); err != nil {
			return err
		}
		if err := s.ConsumeApproval(ctx, q, userID, newApproval, PurposeChangeNumber, newPhone); err != nil {
			return err
		}
		now := s.Now()
		if err := q.SetUserPhone(ctx, store.SetUserPhoneParams{ID: userID, PhoneE164: &newPhone, PhoneVerifiedAt: &now}); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrPhoneInUse
			}
			return err
		}
		u.PhoneE164, u.PhoneVerifiedAt = &newPhone, &now
		// The partner learns that the number changed, never what it is.
		partners, err := q.PartnerIDs(ctx, userID)
		if err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"name": u.DisplayName})
		for _, p := range partners {
			if err := q.CreateNotice(ctx, store.CreateNoticeParams{UserID: p, Kind: "partner_number_updated", Payload: payload, CreatedAt: now}); err != nil {
				return err
			}
		}
		return nil
	})
	return u, err
}

var tints = map[string]bool{"terracotta": true, "sage": true, "mauve": true}

// UpdateProfile sets the name partners see and the person's tint.
func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, name, tint string) (store.User, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 40 || !tints[tint] {
		return store.User{}, ErrInvalidProfile
	}
	return store.New(s.pool).UpdateProfile(ctx, store.UpdateProfileParams{ID: userID, DisplayName: name, PersonTint: tint, UpdatedAt: s.Now()})
}

func (s *Service) User(ctx context.Context, userID uuid.UUID) (store.User, error) {
	return store.New(s.pool).GetUser(ctx, userID)
}
