package pairing_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/pairing"
	"betweenus/api/internal/store"
	"betweenus/api/internal/testdb"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

type fixture struct {
	pool  *pgxpool.Pool
	svc   *pairing.Service
	clock *clock
	n     int
}

func setup(t *testing.T) *fixture {
	pool := testdb.New(t)
	c := &clock{t: time.Date(2026, 3, 9, 6, 0, 0, 0, time.UTC)}
	svc := pairing.NewService(pool)
	svc.Now = c.now
	return &fixture{pool: pool, svc: svc, clock: c}
}

func (f *fixture) user(t *testing.T, name string) uuid.UUID {
	t.Helper()
	f.n++
	phone := fmt.Sprintf("+9198000%05d", f.n)
	now := f.clock.now()
	u, err := store.New(f.pool).CreateUser(context.Background(), store.CreateUserParams{
		PhoneE164: &phone, PhoneVerifiedAt: &now, DisplayName: name,
	})
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

// pair creates a space for a, invites, and has b accept.
func (f *fixture) pair(t *testing.T, a, b uuid.UUID) store.Relationship {
	t.Helper()
	ctx := context.Background()
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatalf("create space: %v", err)
	}
	inv, err := f.svc.CreateInvitation(ctx, a, "Dev")
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	rel, err := f.svc.Accept(ctx, b, inv.Token)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	return rel
}

func wantErr(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("got error %v, want %v", err, want)
	}
}

func TestPairingHappyPath(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b := f.user(t, "Aarohi"), f.user(t, "Dev")

	rel := f.pair(t, a, b)
	if rel.Status != "active" || rel.ActivatedAt == nil {
		t.Fatalf("relationship not active: %+v", rel)
	}
	for _, id := range []uuid.UUID{a, b} {
		sp, err := f.svc.CurrentSpace(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if sp.Relationship.ID != rel.ID || len(sp.Members) != 2 || sp.Invite != nil {
			t.Fatalf("unexpected space for %s: %+v", id, sp)
		}
	}
}

func TestPairedUserCannotCreateSecondSpace(t *testing.T) {
	f := setup(t)
	a, b := f.user(t, "Aarohi"), f.user(t, "Dev")
	f.pair(t, a, b)

	_, err := f.svc.CreateSpace(context.Background(), a, "Another")
	wantErr(t, err, pairing.ErrAlreadyInSpace)
	_, err = f.svc.CreateSpace(context.Background(), b, "Another")
	wantErr(t, err, pairing.ErrAlreadyInSpace)
}

func TestPairedUserCannotAcceptAnotherInvitation(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b, c := f.user(t, "Aarohi"), f.user(t, "Dev"), f.user(t, "Chris")
	f.pair(t, a, b)

	if _, err := f.svc.CreateSpace(ctx, c, "Elsewhere"); err != nil {
		t.Fatal(err)
	}
	inv, err := f.svc.CreateInvitation(ctx, c, "Dev")
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.Accept(ctx, b, inv.Token)
	wantErr(t, err, pairing.ErrAlreadyInSpace)

	// Chris only ever sees "waiting", then "not accepted" once it runs out:
	// nothing reveals that Dev is paired.
	sp, err := f.svc.CurrentSpace(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if sp.Invite == nil || sp.Invite.State != "waiting" {
		t.Fatalf("inviter view leaked something: %+v", sp.Invite)
	}
	f.clock.advance(pairing.DefaultInviteTTL)
	sp, _ = f.svc.CurrentSpace(ctx, c)
	if sp.Invite == nil || sp.Invite.State != "not_accepted" {
		t.Fatalf("want not_accepted, got %+v", sp.Invite)
	}
}

func TestInviterCannotAcceptOwnInvitation(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a := f.user(t, "Aarohi")
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	_, err := f.svc.Accept(ctx, a, inv.Token)
	wantErr(t, err, pairing.ErrOwnInvite)
}

func TestExpiredInvitation(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b := f.user(t, "Aarohi"), f.user(t, "Dev")
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	f.clock.advance(pairing.DefaultInviteTTL + time.Second)

	_, err := f.svc.PreviewInvitation(ctx, inv.Token)
	wantErr(t, err, pairing.ErrInviteExpired)
	_, err = f.svc.Accept(ctx, b, inv.Token)
	wantErr(t, err, pairing.ErrInviteExpired)
}

func TestInvitationIsSingleUse(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b, c := f.user(t, "Aarohi"), f.user(t, "Dev"), f.user(t, "Chris")
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	if _, err := f.svc.Accept(ctx, b, inv.Token); err != nil {
		t.Fatal(err)
	}
	_, err := f.svc.Accept(ctx, c, inv.Token)
	wantErr(t, err, pairing.ErrInviteUnavailable)
}

func TestNewInvitationReplacesOld(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b := f.user(t, "Aarohi"), f.user(t, "Dev")
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	old, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	fresh, err := f.svc.CreateInvitation(ctx, a, "Dev")
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.Accept(ctx, b, old.Token)
	wantErr(t, err, pairing.ErrInviteUnavailable)
	if _, err := f.svc.Accept(ctx, b, fresh.Token); err != nil {
		t.Fatal(err)
	}
}

func TestDeclineShowsNotAccepted(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b := f.user(t, "Aarohi"), f.user(t, "Dev")
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	if err := f.svc.Decline(ctx, b, inv.Token); err != nil {
		t.Fatal(err)
	}
	sp, _ := f.svc.CurrentSpace(ctx, a)
	if sp.Invite == nil || sp.Invite.State != "not_accepted" {
		t.Fatalf("want not_accepted, got %+v", sp.Invite)
	}
}

func TestUnverifiedPhoneCannotPair(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a := f.user(t, "Aarohi")
	phone := "+919811111111"
	u, err := store.New(f.pool).CreateUser(ctx, store.CreateUserParams{PhoneE164: &phone, DisplayName: "Dev"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.CreateSpace(ctx, u.ID, "Mine")
	wantErr(t, err, pairing.ErrPhoneNotVerified)

	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	_, err = f.svc.Accept(ctx, u.ID, inv.Token)
	wantErr(t, err, pairing.ErrPhoneNotVerified)
}

// Two different invitations accepted by the same person at once: exactly one wins.
func TestConcurrentAcceptsOnlyOneWins(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	for round := 0; round < 10; round++ {
		b := f.user(t, "Dev")
		var tokens []string
		for i := 0; i < 4; i++ {
			inviter := f.user(t, fmt.Sprintf("Inviter %d", i))
			if _, err := f.svc.CreateSpace(ctx, inviter, "Space"); err != nil {
				t.Fatal(err)
			}
			inv, err := f.svc.CreateInvitation(ctx, inviter, "Dev")
			if err != nil {
				t.Fatal(err)
			}
			tokens = append(tokens, inv.Token)
		}
		var wins, paired atomic.Int32
		var wg sync.WaitGroup
		for _, tok := range tokens {
			wg.Add(1)
			go func(tok string) {
				defer wg.Done()
				_, err := f.svc.Accept(ctx, b, tok)
				switch {
				case err == nil:
					wins.Add(1)
				case errors.Is(err, pairing.ErrAlreadyInSpace):
					paired.Add(1)
				default:
					t.Errorf("unexpected error: %v", err)
				}
			}(tok)
		}
		wg.Wait()
		if wins.Load() != 1 || paired.Load() != 3 {
			t.Fatalf("round %d: wins=%d alreadyPaired=%d", round, wins.Load(), paired.Load())
		}
	}
}

// Two people racing for the same link: exactly one wins.
func TestConcurrentAcceptSameLink(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	for round := 0; round < 10; round++ {
		a := f.user(t, "Aarohi")
		if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
			t.Fatal(err)
		}
		inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
		var wins atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 4; i++ {
			b := f.user(t, "Racer")
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := f.svc.Accept(ctx, b, inv.Token)
				if err == nil {
					wins.Add(1)
				} else if !errors.Is(err, pairing.ErrInviteUnavailable) {
					t.Errorf("unexpected error: %v", err)
				}
			}()
		}
		wg.Wait()
		if wins.Load() != 1 {
			t.Fatalf("round %d: wins=%d", round, wins.Load())
		}
	}
}

func TestEitherPartnerCanLeaveAlone(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b := f.user(t, "Aarohi"), f.user(t, "Dev")
	f.pair(t, a, b)

	rel, err := f.svc.Leave(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	if rel.Status != "unlinked" || rel.UnlinkedBy == nil || *rel.UnlinkedBy != b {
		t.Fatalf("not unlinked by leaver: %+v", rel)
	}
	want := f.clock.now().Add(pairing.DefaultReadOnlyFor)
	if rel.ReadOnlyUntil == nil || !rel.ReadOnlyUntil.Equal(want) {
		t.Fatalf("read_only_until = %v, want %v", rel.ReadOnlyUntil, want)
	}
	for _, id := range []uuid.UUID{a, b} {
		_, err := f.svc.CurrentSpace(ctx, id)
		wantErr(t, err, pairing.ErrNotInSpace)
	}
	_, err = f.svc.Leave(ctx, a)
	wantErr(t, err, pairing.ErrNotInSpace)
}

func TestCooldownAfterLeavingActiveSpace(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b, c := f.user(t, "Aarohi"), f.user(t, "Dev"), f.user(t, "Chris")
	f.pair(t, a, b)
	if _, err := f.svc.Leave(ctx, a); err != nil {
		t.Fatal(err)
	}

	_, err := f.svc.CreateSpace(ctx, a, "New")
	var cd *pairing.CooldownError
	if !errors.As(err, &cd) {
		t.Fatalf("want cooldown, got %v", err)
	}
	if want := f.clock.now().Add(pairing.DefaultCooldown); !cd.AvailableAt.Equal(want) {
		t.Fatalf("available at %v, want %v", cd.AvailableAt, want)
	}

	// Accepting someone else's invite is blocked by the same cooldown.
	if _, err := f.svc.CreateSpace(ctx, c, "Elsewhere"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, c, "")
	_, err = f.svc.Accept(ctx, a, inv.Token)
	if !errors.As(err, &cd) {
		t.Fatalf("want cooldown on accept, got %v", err)
	}

	f.clock.advance(pairing.DefaultCooldown)
	if _, err := f.svc.CreateSpace(ctx, a, "New"); err != nil {
		t.Fatalf("after cooldown: %v", err)
	}
}

func TestClosingPendingSpaceHasNoCooldown(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a := f.user(t, "Aarohi")
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat"); err != nil {
		t.Fatal(err)
	}
	inv, _ := f.svc.CreateInvitation(ctx, a, "Dev")
	rel, err := f.svc.Leave(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if rel.ReadOnlyUntil != nil {
		t.Fatalf("pending space should not get a read-only window")
	}
	if _, err := f.svc.Accept(ctx, f.user(t, "Dev"), inv.Token); !errors.Is(err, pairing.ErrInviteUnavailable) {
		t.Fatalf("old invite should be dead, got %v", err)
	}
	if _, err := f.svc.CreateSpace(ctx, a, "Window Seat again"); err != nil {
		t.Fatalf("no cooldown expected: %v", err)
	}
}

// The database rejects broken states even if the service is bypassed.
func TestDatabaseBackstops(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	a, b, c := f.user(t, "Aarohi"), f.user(t, "Dev"), f.user(t, "Chris")
	rel := f.pair(t, a, b)

	t.Run("third member", func(t *testing.T) {
		_, err := f.pool.Exec(ctx, `INSERT INTO relationship_members (relationship_id, user_id) VALUES ($1, $2)`, rel.ID, c)
		if err == nil {
			t.Fatal("inserted a third member")
		}
	})
	t.Run("second open membership", func(t *testing.T) {
		tx, _ := f.pool.Begin(ctx)
		defer tx.Rollback(ctx)
		var other uuid.UUID
		if err := tx.QueryRow(ctx, `INSERT INTO relationships (name, created_by) VALUES ('x', $1) RETURNING id`, c).Scan(&other); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO relationship_members (relationship_id, user_id) VALUES ($1, $2)`, other, a); err == nil {
			t.Fatal("user got a second open membership")
		}
	})
	t.Run("active with one member", func(t *testing.T) {
		tx, _ := f.pool.Begin(ctx)
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `UPDATE relationship_members SET left_at = now() WHERE relationship_id = $1 AND user_id = $2`, rel.ID, b); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err == nil {
			t.Fatal("committed an active relationship with one open member")
		}
	})
	t.Run("rejoin after leaving", func(t *testing.T) {
		if _, err := f.svc.Leave(ctx, a); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx, `UPDATE relationship_members SET left_at = NULL WHERE relationship_id = $1`, rel.ID); err == nil {
			t.Fatal("cleared left_at")
		}
	})
}
