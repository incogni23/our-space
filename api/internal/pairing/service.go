// Package pairing owns the "two people, one space" rules: creating a space,
// inviting exactly one partner, accepting, and leaving.
//
// Lock order in every transaction: users (by id) → invitation → relationship.
// The database enforces the invariants too; see db/migrations/00001_identity_pairing.sql.
package pairing

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
	"betweenus/api/internal/token"
)

const (
	DefaultInviteTTL   = 72 * time.Hour
	DefaultReadOnlyFor = 30 * 24 * time.Hour
	DefaultCooldown    = 7 * 24 * time.Hour
)

type Service struct {
	pool        *pgxpool.Pool
	Now         func() time.Time
	InviteTTL   time.Duration
	ReadOnlyFor time.Duration
	Cooldown    time.Duration
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{
		pool:        pool,
		Now:         time.Now,
		InviteTTL:   DefaultInviteTTL,
		ReadOnlyFor: DefaultReadOnlyFor,
		Cooldown:    DefaultCooldown,
	}
}

// Invitation is returned once, at creation. The plain token is never stored.
type Invitation struct {
	Token          string
	RelationshipID uuid.UUID
	InviteeName    string
	ExpiresAt      time.Time
}

// InvitePreview is what the invitee sees before accepting (A7).
type InvitePreview struct {
	InviterName string
	SpaceName   string
	ExpiresAt   time.Time
}

// InviteStatus is the inviter's view of their latest invitation. Declined and expired
// look the same ("not_accepted") and an invitee who is already paired never changes
// it, so the inviter can't learn about someone else's pairing.
type InviteStatus struct {
	State       string // "waiting" | "not_accepted"
	InviteeName string
	ExpiresAt   time.Time
}

type Member struct {
	ID          uuid.UUID
	DisplayName string
	PersonTint  string
	TimeZone    string
	JoinedAt    time.Time
}

type Space struct {
	Relationship store.Relationship
	Members      []Member
	Invite       *InviteStatus
}

func (s *Service) inTx(ctx context.Context, fn func(q *store.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(store.New(tx)); err != nil {
		return mapDBError(err)
	}
	return mapDBError(tx.Commit(ctx))
}

func cleanName(name string, min, max int) (string, error) {
	name = strings.TrimSpace(name)
	n := utf8.RuneCountInString(name)
	if n < min || n > max {
		return "", ErrInvalidName
	}
	return name, nil
}

// lockUsers locks the given users in id order and returns them keyed by id.
func lockUsers(ctx context.Context, q *store.Queries, ids ...uuid.UUID) (map[uuid.UUID]store.LockUsersRow, error) {
	rows, err := q.LockUsers(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]store.LockUsersRow, len(rows))
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

func (s *Service) requireFree(ctx context.Context, q *store.Queries, userID uuid.UUID) error {
	if _, err := q.OpenMembership(ctx, userID); err == nil {
		return ErrAlreadyInSpace
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	left, err := q.LastLeftActiveRelationship(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if avail := left.Add(s.Cooldown); s.Now().Before(avail) {
		return &CooldownError{AvailableAt: avail}
	}
	return nil
}

// CreateSpace starts a pending space with the user as its only member (A4).
func (s *Service) CreateSpace(ctx context.Context, userID uuid.UUID, name string) (store.Relationship, error) {
	name, err := cleanName(name, 1, 60)
	if err != nil {
		return store.Relationship{}, err
	}
	var rel store.Relationship
	err = s.inTx(ctx, func(q *store.Queries) error {
		users, err := lockUsers(ctx, q, userID)
		if err != nil {
			return err
		}
		u, ok := users[userID]
		if !ok || u.PhoneVerifiedAt == nil {
			return ErrPhoneNotVerified
		}
		if err := s.requireFree(ctx, q, userID); err != nil {
			return err
		}
		rel, err = q.CreateRelationship(ctx, store.CreateRelationshipParams{Name: name, CreatedBy: userID})
		if err != nil {
			return err
		}
		return q.AddMember(ctx, store.AddMemberParams{RelationshipID: rel.ID, UserID: userID, JoinedAt: s.Now()})
	})
	return rel, err
}

// CreateInvitation makes a single-use link for the one partner (A5). A new link
// replaces any earlier one, so at most one invitation is ever open.
func (s *Service) CreateInvitation(ctx context.Context, userID uuid.UUID, inviteeName string) (Invitation, error) {
	inviteeName, err := cleanName(inviteeName, 0, 40)
	if err != nil {
		return Invitation{}, err
	}
	var inv Invitation
	err = s.inTx(ctx, func(q *store.Queries) error {
		if _, err := lockUsers(ctx, q, userID); err != nil {
			return err
		}
		m, err := q.OpenMembership(ctx, userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotInSpace
		}
		if err != nil {
			return err
		}
		if m.Status != "pending" {
			return ErrSpaceNotPending
		}
		now := s.Now()
		if err := q.RevokeOpenInvitations(ctx, store.RevokeOpenInvitationsParams{RelationshipID: m.ID, RespondedAt: &now}); err != nil {
			return err
		}
		plain, hash := token.New()
		row, err := q.CreateInvitation(ctx, store.CreateInvitationParams{
			RelationshipID: m.ID,
			InviterID:      userID,
			TokenHash:      hash,
			InviteeName:    inviteeName,
			CreatedAt:      now,
			ExpiresAt:      now.Add(s.InviteTTL),
		})
		if err != nil {
			return err
		}
		inv = Invitation{Token: plain, RelationshipID: m.ID, InviteeName: row.InviteeName, ExpiresAt: row.ExpiresAt}
		return nil
	})
	return inv, err
}

// PreviewInvitation shows who is inviting and to what, without accepting.
func (s *Service) PreviewInvitation(ctx context.Context, plain string) (InvitePreview, error) {
	row, err := store.New(s.pool).GetInvitationPreview(ctx, token.Hash(plain))
	if errors.Is(err, pgx.ErrNoRows) {
		return InvitePreview{}, ErrInviteNotFound
	}
	if err != nil {
		return InvitePreview{}, err
	}
	if err := s.checkUsable(row.State, row.ExpiresAt, row.SpaceStatus); err != nil {
		return InvitePreview{}, err
	}
	return InvitePreview{InviterName: row.InviterName, SpaceName: row.SpaceName, ExpiresAt: row.ExpiresAt}, nil
}

func (s *Service) checkUsable(state string, expiresAt time.Time, spaceStatus string) error {
	switch {
	case state == "expired" || (state == "open" && !s.Now().Before(expiresAt)):
		return ErrInviteExpired
	case state != "open" || spaceStatus != "pending":
		return ErrInviteUnavailable
	}
	return nil
}

// Accept pairs the invitee with the inviter (A7). Both phones must be verified and
// neither person may already be in a space. Of two racing accepts, one wins.
func (s *Service) Accept(ctx context.Context, userID uuid.UUID, plain string) (store.Relationship, error) {
	hash := token.Hash(plain)
	// Unlocked read to learn who is involved, so users can be locked first.
	peek, err := store.New(s.pool).GetInvitationByToken(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Relationship{}, ErrInviteNotFound
	}
	if err != nil {
		return store.Relationship{}, err
	}
	if peek.InviterID == userID {
		return store.Relationship{}, ErrOwnInvite
	}

	var rel store.Relationship
	err = s.inTx(ctx, func(q *store.Queries) error {
		users, err := lockUsers(ctx, q, userID, peek.InviterID)
		if err != nil {
			return err
		}
		if u, ok := users[userID]; !ok || u.PhoneVerifiedAt == nil {
			return ErrPhoneNotVerified
		}
		inv, err := q.GetInvitationByTokenForUpdate(ctx, hash)
		if err != nil {
			return err
		}
		rel, err = q.GetRelationshipForUpdate(ctx, inv.RelationshipID)
		if err != nil {
			return err
		}
		if err := s.checkUsable(inv.State, inv.ExpiresAt, rel.Status); err != nil {
			return err
		}
		if err := s.requireFree(ctx, q, userID); err != nil {
			return err
		}
		now := s.Now()
		if err := q.AddMember(ctx, store.AddMemberParams{RelationshipID: rel.ID, UserID: userID, JoinedAt: now}); err != nil {
			return err
		}
		n, err := q.ActivateRelationship(ctx, store.ActivateRelationshipParams{ID: rel.ID, ActivatedAt: &now})
		if err != nil {
			return err
		}
		if n != 1 {
			return ErrInviteUnavailable
		}
		if err := q.SetInvitationState(ctx, store.SetInvitationStateParams{
			ID: inv.ID, State: "accepted", RespondedAt: &now, AcceptedBy: &userID,
		}); err != nil {
			return err
		}
		rel, err = q.GetRelationshipForUpdate(ctx, rel.ID)
		return err
	})
	return rel, err
}

// Decline turns an invitation down. The inviter only ever sees "not accepted".
func (s *Service) Decline(ctx context.Context, userID uuid.UUID, plain string) error {
	return s.inTx(ctx, func(q *store.Queries) error {
		inv, err := q.GetInvitationByTokenForUpdate(ctx, token.Hash(plain))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInviteNotFound
		}
		if err != nil {
			return err
		}
		if inv.InviterID == userID {
			return ErrOwnInvite
		}
		if inv.State != "open" {
			return ErrInviteUnavailable
		}
		now := s.Now()
		return q.SetInvitationState(ctx, store.SetInvitationStateParams{ID: inv.ID, State: "declined", RespondedAt: &now})
	})
}

// Leave closes the user's space. It never needs the partner's approval. An active
// space becomes read-only for both people for ReadOnlyFor, then is deleted.
// Closing a pending space nobody joined has no cooldown.
func (s *Service) Leave(ctx context.Context, userID uuid.UUID) (store.Relationship, error) {
	var rel store.Relationship
	err := s.inTx(ctx, func(q *store.Queries) error {
		if _, err := lockUsers(ctx, q, userID); err != nil {
			return err
		}
		m, err := q.OpenMembership(ctx, userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotInSpace
		}
		if err != nil {
			return err
		}
		rel, err = q.GetRelationshipForUpdate(ctx, m.ID)
		if err != nil {
			return err
		}
		now := s.Now()
		if _, err := q.CloseOpenMemberships(ctx, store.CloseOpenMembershipsParams{RelationshipID: rel.ID, LeftAt: &now}); err != nil {
			return err
		}
		if err := q.RevokeOpenInvitations(ctx, store.RevokeOpenInvitationsParams{RelationshipID: rel.ID, RespondedAt: &now}); err != nil {
			return err
		}
		var readOnlyUntil *time.Time
		if rel.Status == "active" {
			t := now.Add(s.ReadOnlyFor)
			readOnlyUntil = &t
		}
		if err := q.UnlinkRelationship(ctx, store.UnlinkRelationshipParams{
			ID: rel.ID, UnlinkedAt: &now, UnlinkedBy: &userID, ReadOnlyUntil: readOnlyUntil,
		}); err != nil {
			return err
		}
		if rel.Status == "active" {
			if err := s.noticeSpaceClosed(ctx, q, rel, userID, now, *readOnlyUntil); err != nil {
				return err
			}
		}
		rel, err = q.GetRelationshipForUpdate(ctx, rel.ID)
		return err
	})
	return rel, err
}

// noticeSpaceClosed tells the other person, in neutral words (canvas 5.2, "Unlinked").
func (s *Service) noticeSpaceClosed(ctx context.Context, q *store.Queries, rel store.Relationship, leaver uuid.UUID, now, readOnlyUntil time.Time) error {
	u, err := q.GetUser(ctx, leaver)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{
		"spaceName": rel.Name, "leftByName": u.DisplayName, "leftAt": now, "readOnlyUntil": readOnlyUntil,
	})
	if err != nil {
		return err
	}
	others, err := q.OtherMembers(ctx, store.OtherMembersParams{RelationshipID: rel.ID, UserID: leaver})
	if err != nil {
		return err
	}
	for _, id := range others {
		if err := q.CreateNotice(ctx, store.CreateNoticeParams{UserID: id, Kind: "space_closed", Payload: payload, CreatedAt: now}); err != nil {
			return err
		}
	}
	return nil
}

// CurrentSpace returns the user's open space, its members and, while pending,
// the inviter-safe status of the latest invitation.
func (s *Service) CurrentSpace(ctx context.Context, userID uuid.UUID) (Space, error) {
	q := store.New(s.pool)
	m, err := q.OpenMembership(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Space{}, ErrNotInSpace
	}
	if err != nil {
		return Space{}, err
	}
	sp := Space{Relationship: store.Relationship{
		ID: m.ID, Name: m.Name, Status: m.Status, CreatedBy: m.CreatedBy, ActivatedAt: m.ActivatedAt,
	}}
	members, err := q.OpenMembers(ctx, m.ID)
	if err != nil {
		return Space{}, err
	}
	for _, mm := range members {
		sp.Members = append(sp.Members, Member(mm))
	}
	if m.Status == "pending" {
		inv, err := q.GetLatestInvitation(ctx, m.ID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return Space{}, err
		case inv.State == "open" && s.Now().Before(inv.ExpiresAt):
			sp.Invite = &InviteStatus{State: "waiting", InviteeName: inv.InviteeName, ExpiresAt: inv.ExpiresAt}
		case inv.State == "open" || inv.State == "declined" || inv.State == "expired":
			sp.Invite = &InviteStatus{State: "not_accepted", InviteeName: inv.InviteeName, ExpiresAt: inv.ExpiresAt}
		}
	}
	return sp, nil
}

// NewSpaceAvailableAt reports when the user may start or join a space. Zero means now.
func (s *Service) NewSpaceAvailableAt(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	left, err := store.New(s.pool).LastLeftActiveRelationship(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	if avail := left.Add(s.Cooldown); s.Now().Before(avail) {
		return avail, nil
	}
	return time.Time{}, nil
}
