package pairing

import (
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrAlreadyInSpace: the user already has an open membership (pending or active).
	ErrAlreadyInSpace = errors.New("pairing: already in a space")
	// ErrNotInSpace: the user has no open membership.
	ErrNotInSpace = errors.New("pairing: not in a space")
	// ErrPhoneNotVerified: pairing needs a verified phone.
	ErrPhoneNotVerified = errors.New("pairing: phone not verified")
	// ErrInviteNotFound: no invitation matches the token.
	ErrInviteNotFound = errors.New("pairing: invitation not found")
	// ErrInviteExpired: the invitation ran out. Shown as "This invite has run out."
	ErrInviteExpired = errors.New("pairing: invitation expired")
	// ErrInviteUnavailable: already used, declined, replaced, or the space closed.
	ErrInviteUnavailable = errors.New("pairing: invitation no longer available")
	// ErrOwnInvite: the inviter tried to accept their own link.
	ErrOwnInvite = errors.New("pairing: cannot accept your own invitation")
	// ErrSpaceNotPending: invitations can only be made while waiting for a partner.
	ErrSpaceNotPending = errors.New("pairing: space is not waiting for a partner")
	// ErrInvalidName: space or invitee name out of bounds.
	ErrInvalidName = errors.New("pairing: invalid name")
)

// CooldownError: the user left an active space recently and must wait before a new one.
type CooldownError struct {
	AvailableAt time.Time
}

func (e *CooldownError) Error() string {
	return fmt.Sprintf("pairing: new space available from %s", e.AvailableAt.Format(time.RFC3339))
}

// mapDBError turns invariant violations raised by the database into domain errors.
// These are the backstop for races the service-level checks can't see.
func mapDBError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.ConstraintName {
	case "one_open_membership_per_user":
		return ErrAlreadyInSpace
	case "relationship_two_members", "relationship_not_pending", "one_open_invitation_per_relationship":
		return ErrInviteUnavailable
	}
	return err
}
