package auth_test

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"

	"betweenus/api/internal/auth"
	"betweenus/api/internal/pairing"
	"betweenus/api/internal/testdb"
)

const code = "123456"

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

type fixture struct {
	svc   *auth.Service
	pair  *pairing.Service
	clock *clock
}

func setup(t *testing.T) *fixture {
	pool := testdb.New(t)
	c := &clock{t: time.Date(2026, 3, 9, 6, 0, 0, 0, time.UTC)}
	svc := auth.NewService(pool, auth.DevProvider{FixedCode: code}, []byte("test-pepper"))
	svc.Now = c.now
	p := pairing.NewService(pool)
	p.Now = c.now
	return &fixture{svc: svc, pair: p, clock: c}
}

func (f *fixture) start(t *testing.T, phone, purpose string, user *uuid.UUID) uuid.UUID {
	t.Helper()
	f.clock.advance(time.Minute) // stay clear of the resend throttle
	id, err := f.svc.StartVerification(context.Background(), auth.StartInput{Phone: phone, Purpose: purpose, UserID: user})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	return id
}

func (f *fixture) signIn(t *testing.T, phone, device string) auth.SignIn {
	t.Helper()
	id := f.start(t, phone, auth.PurposeSignIn, nil)
	si, err := f.svc.VerifySignIn(context.Background(), id, code, auth.Device{ID: device, Label: "test"})
	if err != nil {
		t.Fatalf("sign in: %v", err)
	}
	return si
}

func wantErr(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want %v", err, want)
	}
}

func TestNormalizePhone(t *testing.T) {
	for in, want := range map[string]string{
		"+91 98765 43210":   "+919876543210",
		"0091-98765-43210":  "+919876543210",
		"+1 (646) 555-0142": "+16465550142",
	} {
		got, err := auth.NormalizePhone(in)
		if err != nil || got != want {
			t.Errorf("%q → %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"98765 43210", "+0123456789", "+12", "hello"} {
		if _, err := auth.NormalizePhone(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestNewNumberSignsUpAndIsActive(t *testing.T) {
	f := setup(t)
	si := f.signIn(t, "+919800000001", "phone-a")
	if !si.NewUser || si.Session.Status != auth.SessionActive {
		t.Fatalf("unexpected sign in: %+v", si)
	}
	sess, err := f.svc.Authenticate(context.Background(), si.Token)
	if err != nil || sess.UserID != si.User.ID {
		t.Fatalf("authenticate: %v", err)
	}
}

func TestWrongCodesLockTheVerification(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	id := f.start(t, "+919800000001", auth.PurposeSignIn, nil)
	for i := 0; i < 4; i++ {
		_, err := f.svc.VerifySignIn(ctx, id, "000000", auth.Device{})
		wantErr(t, err, auth.ErrWrongCode)
	}
	_, err := f.svc.VerifySignIn(ctx, id, "000000", auth.Device{})
	wantErr(t, err, auth.ErrTooManyAttempts)
	_, err = f.svc.VerifySignIn(ctx, id, code, auth.Device{})
	wantErr(t, err, auth.ErrVerificationGone)
}

func TestCodeExpiresAndIsSingleUse(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	id := f.start(t, "+919800000001", auth.PurposeSignIn, nil)
	f.clock.advance(11 * time.Minute)
	_, err := f.svc.VerifySignIn(ctx, id, code, auth.Device{})
	wantErr(t, err, auth.ErrVerificationGone)

	id = f.start(t, "+919800000001", auth.PurposeSignIn, nil)
	if _, err := f.svc.VerifySignIn(ctx, id, code, auth.Device{}); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.VerifySignIn(ctx, id, code, auth.Device{})
	wantErr(t, err, auth.ErrVerificationGone)
}

func TestRateLimits(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	phone := "+919800000001"
	if _, err := f.svc.StartVerification(ctx, auth.StartInput{Phone: phone, Purpose: auth.PurposeSignIn}); err != nil {
		t.Fatal(err)
	}
	_, err := f.svc.StartVerification(ctx, auth.StartInput{Phone: phone, Purpose: auth.PurposeSignIn})
	var rl *auth.RateLimitError
	if !errors.As(err, &rl) {
		t.Fatalf("want resend throttle, got %v", err)
	}
	for i := 0; i < 4; i++ {
		f.start(t, phone, auth.PurposeSignIn, nil)
	}
	f.clock.advance(time.Minute)
	_, err = f.svc.StartVerification(ctx, auth.StartInput{Phone: phone, Purpose: auth.PurposeSignIn})
	if !errors.As(err, &rl) {
		t.Fatalf("want hourly limit, got %v", err)
	}

	ip := netip.MustParseAddr("203.0.113.9")
	for i := 0; i < 20; i++ {
		f.clock.advance(time.Second)
		if _, err := f.svc.StartVerification(ctx, auth.StartInput{Phone: fmt.Sprintf("+9198100%05d", i), Purpose: auth.PurposeSignIn, IP: &ip}); err != nil {
			t.Fatal(err)
		}
	}
	_, err = f.svc.StartVerification(ctx, auth.StartInput{Phone: "+919899999999", Purpose: auth.PurposeSignIn, IP: &ip})
	if !errors.As(err, &rl) {
		t.Fatalf("want ip limit, got %v", err)
	}
}

// A phone code alone never opens an existing space on a new device.
func TestNewDeviceNeedsSecondFactorOnceInASpace(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	phone := "+919800000001"
	first := f.signIn(t, phone, "phone-a")
	if _, err := f.pair.CreateSpace(ctx, first.User.ID, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	codes, err := f.svc.GenerateRecoveryCodes(ctx, first.User.ID)
	if err != nil || len(codes) != 8 {
		t.Fatalf("recovery codes: %v %v", codes, err)
	}

	// Same device again (after sign-out): trusted.
	if err := f.svc.SignOut(ctx, first.Token); err != nil {
		t.Fatal(err)
	}
	if again := f.signIn(t, phone, "phone-a"); again.Session.Status != auth.SessionActive {
		t.Fatalf("known device should be trusted, got %s", again.Session.Status)
	}

	// New device: needs a second factor.
	other := f.signIn(t, phone, "phone-b")
	if other.Session.Status != auth.SessionNeedsSecondFactor {
		t.Fatalf("want needs_second_factor, got %s", other.Session.Status)
	}
	_, err = f.svc.Authenticate(ctx, other.Token)
	wantErr(t, err, auth.ErrNeedsSecondFactor)

	_, err = f.svc.CompleteWithRecoveryCode(ctx, other.Token, "aaaaa-aaaaa")
	wantErr(t, err, auth.ErrWrongRecoveryCode)
	if _, err := f.svc.CompleteWithRecoveryCode(ctx, other.Token, " "+codes[3]+" "); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Authenticate(ctx, other.Token); err != nil {
		t.Fatalf("should be active now: %v", err)
	}

	// Each recovery code works once.
	third := f.signIn(t, phone, "phone-c")
	_, err = f.svc.CompleteWithRecoveryCode(ctx, third.Token, codes[3])
	wantErr(t, err, auth.ErrWrongRecoveryCode)
}

func TestNewDeviceWithoutHistoryIsActive(t *testing.T) {
	f := setup(t)
	f.signIn(t, "+919800000001", "phone-a")
	if si := f.signIn(t, "+919800000001", "phone-b"); si.Session.Status != auth.SessionActive {
		t.Fatalf("nothing to protect yet, got %s", si.Session.Status)
	}
}

// "This number is new to me": the recycled number starts a fresh account and the
// old owner's data and sessions are untouched.
func TestStartFreshOnRecycledNumber(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	phone := "+919800000001"
	owner := f.signIn(t, phone, "owner-phone")
	if _, err := f.pair.CreateSpace(ctx, owner.User.ID, "Window Seat"); err != nil {
		t.Fatal(err)
	}

	stranger := f.signIn(t, phone, "stranger-phone")
	if stranger.Session.Status != auth.SessionNeedsSecondFactor {
		t.Fatalf("want needs_second_factor, got %s", stranger.Session.Status)
	}
	fresh, err := f.svc.StartFresh(ctx, stranger.Token, auth.Device{ID: "stranger-phone"})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.User.ID == owner.User.ID || !fresh.NewUser {
		t.Fatal("stranger got the owner's account")
	}
	if _, err := f.pair.CurrentSpace(ctx, fresh.User.ID); !errors.Is(err, pairing.ErrNotInSpace) {
		t.Fatalf("fresh account sees a space: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, owner.Token); err != nil {
		t.Fatalf("owner's session should still work: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, stranger.Token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("pending session should be revoked, got %v", err)
	}
	old, _ := f.svc.User(ctx, owner.User.ID)
	if old.PhoneE164 != nil {
		t.Fatal("old account kept the number")
	}
	if _, err := f.pair.CurrentSpace(ctx, owner.User.ID); err != nil {
		t.Fatalf("owner lost their space: %v", err)
	}
}

func TestChangeNumber(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	oldPhone, newPhone := "+919800000001", "+16465550142"
	si := f.signIn(t, oldPhone, "phone-a")
	uid := si.User.ID

	cur := f.start(t, oldPhone, auth.PurposeChangeNumber, &uid)
	if err := f.svc.ApproveForUser(ctx, uid, cur, auth.PurposeChangeNumber, code); err != nil {
		t.Fatal(err)
	}
	nw := f.start(t, newPhone, auth.PurposeChangeNumber, &uid)
	if err := f.svc.ApproveForUser(ctx, uid, nw, auth.PurposeChangeNumber, code); err != nil {
		t.Fatal(err)
	}

	// The new-number approval can't stand in for the current one.
	_, err := f.svc.ChangeNumber(ctx, uid, nw, nw, newPhone)
	wantErr(t, err, auth.ErrApprovalMissing)

	u, err := f.svc.ChangeNumber(ctx, uid, cur, nw, newPhone)
	if err != nil {
		t.Fatal(err)
	}
	if *u.PhoneE164 != newPhone {
		t.Fatalf("phone = %s", *u.PhoneE164)
	}
	// Approvals are spent.
	_, err = f.svc.ChangeNumber(ctx, uid, cur, nw, "+16465550199")
	wantErr(t, err, auth.ErrApprovalMissing)
}

func TestChangeNumberToTakenNumber(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a := f.signIn(t, "+919800000001", "a")
	f.signIn(t, "+919800000002", "b")
	uid := a.User.ID
	cur := f.start(t, "+919800000001", auth.PurposeChangeNumber, &uid)
	_ = f.svc.ApproveForUser(ctx, uid, cur, auth.PurposeChangeNumber, code)
	nw := f.start(t, "+919800000002", auth.PurposeChangeNumber, &uid)
	_ = f.svc.ApproveForUser(ctx, uid, nw, auth.PurposeChangeNumber, code)
	_, err := f.svc.ChangeNumber(ctx, uid, cur, nw, "+919800000002")
	wantErr(t, err, auth.ErrPhoneInUse)
}

func TestApprovalIsBoundToUserAndPurpose(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a := f.signIn(t, "+919800000001", "a")
	b := f.signIn(t, "+919800000002", "b")
	aid, bid := a.User.ID, b.User.ID
	v := f.start(t, "+919800000001", auth.PurposeLeave, &aid)

	wantErr(t, f.svc.ApproveForUser(ctx, bid, v, auth.PurposeLeave, code), auth.ErrVerificationGone)
	wantErr(t, f.svc.ApproveForUser(ctx, aid, v, auth.PurposeChangeNumber, code), auth.ErrVerificationGone)
	if err := f.svc.ApproveForUser(ctx, aid, v, auth.PurposeLeave, code); err != nil {
		t.Fatal(err)
	}
	wantErr(t, f.svc.ConsumeApproval(ctx, nil, aid, v, auth.PurposeChangeNumber, "+919800000001"), auth.ErrApprovalMissing)
	f.clock.advance(11 * time.Minute)
	wantErr(t, f.svc.ConsumeApproval(ctx, nil, aid, v, auth.PurposeLeave, "+919800000001"), auth.ErrApprovalMissing)
}
