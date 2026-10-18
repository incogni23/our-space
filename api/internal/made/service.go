// Package made owns Made by Us (canvas E1–E5, F1–F4): designs made from your
// photos, who may see them, both partners' approval, and preview links.
//
// Rules enforced here:
//   - originals are never altered: a render is a new media row
//   - every render is a new version; approvals bind to a version, so any edit
//     needs both people again
//   - "approved by both" only when each person's latest decision on the current
//     version is "approved"; either can withdraw, which also turns off links
//   - "export just for me" is never labelled approved and can't make links
package made

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/media"
	"betweenus/api/internal/store"
	"betweenus/api/internal/token"
)

var (
	ErrNotFound     = errors.New("made: not found")
	ErrInvalid      = errors.New("made: invalid input")
	ErrNotCreator   = errors.New("made: only the person who made it can do this")
	ErrNotYourTurn  = errors.New("made: waiting on the other person")
	ErrNotApproved  = errors.New("made: needs both of you to approve first")
	ErrNotRendered  = errors.New("made: preview it first")
	ErrNotForExport = errors.New("made: choose who sees it first")
)

type Scope struct{ SpaceID, UserID uuid.UUID }

type Service struct {
	pool  *pgxpool.Pool
	media *media.Service
	Now   func() time.Time
}

func NewService(pool *pgxpool.Pool, m *media.Service) *Service {
	return &Service{pool: pool, media: m, Now: time.Now}
}

type Decision struct {
	UserID   uuid.UUID
	Decision string
	Comment  string
	At       time.Time
}

// View is a creation with its computed state.
type View struct {
	Creation  store.Creation
	Status    string // draft | private | solo | awaiting | change_requested | declined | approved
	Decisions []Decision
	Links     []store.ShareLink
}

func (s *Service) partnerOf(ctx context.Context, q *store.Queries, spaceID, user uuid.UUID) (uuid.UUID, error) {
	others, err := q.OtherMembers(ctx, store.OtherMembersParams{RelationshipID: spaceID, UserID: user})
	if err != nil {
		return uuid.Nil, err
	}
	if len(others) == 0 {
		return uuid.Nil, ErrInvalid
	}
	return others[0], nil
}

func status(c store.Creation, decisions []Decision, partner uuid.UUID) string {
	if c.Version == 0 {
		return "draft"
	}
	switch c.Audience {
	case "private":
		return "private"
	case "solo":
		return "solo"
	}
	latest := map[uuid.UUID]string{}
	for _, d := range decisions {
		latest[d.UserID] = d.Decision
	}
	if latest[c.CreatedBy] != "approved" {
		return "draft" // not sent yet, re-rendered, or the maker withdrew
	}
	switch latest[partner] {
	case "approved":
		return "approved"
	case "change":
		return "change_requested"
	case "declined":
		return "declined"
	}
	return "awaiting"
}

func (s *Service) view(ctx context.Context, q *store.Queries, c store.Creation, withLinks bool) (View, error) {
	v := View{Creation: c}
	partner, err := s.partnerOf(ctx, q, c.RelationshipID, c.CreatedBy)
	if err != nil {
		return View{}, err
	}
	if c.Version > 0 {
		rows, err := q.LatestDecisions(ctx, store.LatestDecisionsParams{CreationID: c.ID, Version: c.Version})
		if err != nil {
			return View{}, err
		}
		for _, r := range rows {
			v.Decisions = append(v.Decisions, Decision{UserID: r.UserID, Decision: r.Decision, Comment: r.Comment, At: r.CreatedAt})
		}
	}
	v.Status = status(c, v.Decisions, partner)
	if withLinks {
		if v.Links, err = q.LinksForCreation(ctx, c.ID); err != nil {
			return View{}, err
		}
	}
	return v, nil
}

type specShape struct {
	Photos []string `json:"photos"`
}

// checkSpec: a JSON object whose photos all belong to this space.
func checkSpec(ctx context.Context, q *store.Queries, spaceID uuid.UUID, spec json.RawMessage) error {
	if len(spec) == 0 || len(spec) > 16000 || spec[0] != '{' {
		return ErrInvalid
	}
	var sh specShape
	if err := json.Unmarshal(spec, &sh); err != nil || len(sh.Photos) > 30 {
		return ErrInvalid
	}
	ids := make([]uuid.UUID, 0, len(sh.Photos))
	seen := map[uuid.UUID]bool{}
	for _, p := range sh.Photos {
		id, err := uuid.Parse(p)
		if err != nil {
			return ErrInvalid
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	n, err := q.CountOwnMedia(ctx, store.CountOwnMediaParams{RelationshipID: spaceID, Ids: ids})
	if err != nil {
		return err
	}
	if int(n) != len(ids) {
		return ErrInvalid
	}
	return nil
}

func (s *Service) Create(ctx context.Context, sc Scope, format string, memoryID *uuid.UUID, spec json.RawMessage) (View, error) {
	if format != "collage" && format != "softlaunch" {
		return View{}, ErrInvalid
	}
	q := store.New(s.pool)
	if err := checkSpec(ctx, q, sc.SpaceID, spec); err != nil {
		return View{}, err
	}
	if memoryID != nil {
		if _, err := q.GetMemory(ctx, store.GetMemoryParams{ID: *memoryID, RelationshipID: sc.SpaceID}); err != nil {
			return View{}, ErrInvalid
		}
	}
	c, err := q.CreateCreation(ctx, store.CreateCreationParams{RelationshipID: sc.SpaceID, CreatedBy: sc.UserID, MemoryID: memoryID, Format: format, Spec: spec})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, q, c, false)
}

func (s *Service) load(ctx context.Context, q *store.Queries, sc Scope, id uuid.UUID, lock bool) (store.Creation, error) {
	var (
		c   store.Creation
		err error
	)
	if lock {
		c, err = q.GetCreationForUpdate(ctx, store.GetCreationForUpdateParams{ID: id, RelationshipID: sc.SpaceID})
	} else {
		c, err = q.GetCreation(ctx, store.GetCreationParams{ID: id, RelationshipID: sc.SpaceID})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (s *Service) Get(ctx context.Context, sc Scope, id uuid.UUID) (View, error) {
	q := store.New(s.pool)
	c, err := s.load(ctx, q, sc, id, false)
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, q, c, true)
}

func (s *Service) List(ctx context.Context, sc Scope) ([]View, error) {
	q := store.New(s.pool)
	rows, err := q.ListCreations(ctx, sc.SpaceID)
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(rows))
	for _, c := range rows {
		v, err := s.view(ctx, q, c, false)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// UpdateSpec edits the design (maker only). It doesn't change the version;
// the next render does.
func (s *Service) UpdateSpec(ctx context.Context, sc Scope, id uuid.UUID, spec json.RawMessage) (View, error) {
	q := store.New(s.pool)
	c, err := s.load(ctx, q, sc, id, false)
	if err != nil {
		return View{}, err
	}
	if c.CreatedBy != sc.UserID {
		return View{}, ErrNotCreator
	}
	if err := checkSpec(ctx, q, sc.SpaceID, spec); err != nil {
		return View{}, err
	}
	c, err = q.UpdateCreationSpec(ctx, store.UpdateCreationSpecParams{ID: id, RelationshipID: sc.SpaceID, Spec: spec})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, q, c, false)
}

// Render stores the image the maker previewed as a new version. Old links stop
// working automatically (they are bound to the version they were made for).
func (s *Service) Render(ctx context.Context, sc Scope, id uuid.UUID, r io.Reader) (View, error) {
	q := store.New(s.pool)
	c, err := s.load(ctx, q, sc, id, false)
	if err != nil {
		return View{}, err
	}
	if c.CreatedBy != sc.UserID {
		return View{}, ErrNotCreator
	}
	raw, err := io.ReadAll(io.LimitReader(r, media.MaxUploadBytes+1))
	if err != nil {
		return View{}, err
	}
	m, err := s.media.Upload(ctx, sc.SpaceID, sc.UserID, bytes.NewReader(raw))
	if err != nil {
		return View{}, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	c, err = q.SetCreationRender(ctx, store.SetCreationRenderParams{ID: id, RelationshipID: sc.SpaceID, RenderMediaID: &m.ID, RenderHash: &hash})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, q, c, true)
}

// SetAudience is the maker's "Who sees it?" (E4). Asking the partner counts as
// the maker's own approval of the current version.
func (s *Service) SetAudience(ctx context.Context, sc Scope, id uuid.UUID, audience string) (View, error) {
	switch audience {
	case "private", "solo", "ask_export", "ask_link":
	default:
		return View{}, ErrInvalid
	}
	var out View
	err := s.inTx(ctx, func(q *store.Queries) error {
		c, err := s.load(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if c.CreatedBy != sc.UserID {
			return ErrNotCreator
		}
		if c.Version == 0 {
			return ErrNotRendered
		}
		if c, err = q.SetCreationAudience(ctx, store.SetCreationAudienceParams{ID: id, RelationshipID: sc.SpaceID, Audience: audience}); err != nil {
			return err
		}
		if audience == "ask_export" || audience == "ask_link" {
			if err := q.AddApproval(ctx, store.AddApprovalParams{CreationID: id, UserID: sc.UserID, Version: c.Version, Decision: "approved"}); err != nil {
				return err
			}
		} else {
			me := sc.UserID
			if err := q.RevokeLinksForCreation(ctx, store.RevokeLinksForCreationParams{CreationID: id, RevokedBy: &me}); err != nil {
				return err
			}
		}
		out, err = s.view(ctx, q, c, true)
		return err
	})
	return out, err
}

// Respond is the partner's answer (E5): approved, change (with a comment), or declined.
func (s *Service) Respond(ctx context.Context, sc Scope, id uuid.UUID, decision, comment string) (View, error) {
	if decision != "approved" && decision != "change" && decision != "declined" {
		return View{}, ErrInvalid
	}
	comment = strings.TrimSpace(comment)
	if utf8.RuneCountInString(comment) > 500 {
		return View{}, ErrInvalid
	}
	var out View
	err := s.inTx(ctx, func(q *store.Queries) error {
		c, err := s.load(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if c.CreatedBy == sc.UserID {
			return ErrNotYourTurn
		}
		v, err := s.view(ctx, q, c, false)
		if err != nil {
			return err
		}
		if v.Status != "awaiting" && v.Status != "approved" && v.Status != "change_requested" && v.Status != "declined" {
			return ErrNotYourTurn
		}
		if err := q.AddApproval(ctx, store.AddApprovalParams{CreationID: id, UserID: sc.UserID, Version: c.Version, Decision: decision, Comment: comment}); err != nil {
			return err
		}
		if decision != "approved" {
			me := sc.UserID
			if err := q.RevokeLinksForCreation(ctx, store.RevokeLinksForCreationParams{CreationID: id, RevokedBy: &me}); err != nil {
				return err
			}
		}
		out, err = s.view(ctx, q, c, true)
		return err
	})
	return out, err
}

// Withdraw takes back one's own approval of the current version and turns off links.
func (s *Service) Withdraw(ctx context.Context, sc Scope, id uuid.UUID) (View, error) {
	var out View
	err := s.inTx(ctx, func(q *store.Queries) error {
		c, err := s.load(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if c.Version == 0 {
			return ErrNotRendered
		}
		if err := q.AddApproval(ctx, store.AddApprovalParams{CreationID: id, UserID: sc.UserID, Version: c.Version, Decision: "withdrawn"}); err != nil {
			return err
		}
		me := sc.UserID
		if err := q.RevokeLinksForCreation(ctx, store.RevokeLinksForCreationParams{CreationID: id, RevokedBy: &me}); err != nil {
			return err
		}
		out, err = s.view(ctx, q, c, true)
		return err
	})
	return out, err
}

// CanDownload: "export just for me" (maker only), or approved by both (either person).
func CanDownload(v View, user uuid.UUID) error {
	switch {
	case v.Creation.Version == 0:
		return ErrNotRendered
	case v.Status == "solo" && v.Creation.CreatedBy == user:
		return nil
	case v.Status == "approved":
		return nil
	case v.Status == "private" || v.Status == "draft":
		return ErrNotForExport
	}
	return ErrNotApproved
}

// CreateLink makes a preview link for an approved creation set to "share a link".
// Returns the plain token once.
func (s *Service) CreateLink(ctx context.Context, sc Scope, id uuid.UUID, ttl time.Duration) (string, store.ShareLink, error) {
	if ttl != 24*time.Hour && ttl != 7*24*time.Hour && ttl != 30*24*time.Hour {
		return "", store.ShareLink{}, ErrInvalid
	}
	q := store.New(s.pool)
	v, err := s.Get(ctx, sc, id)
	if err != nil {
		return "", store.ShareLink{}, err
	}
	if v.Creation.Audience != "ask_link" || v.Status != "approved" {
		return "", store.ShareLink{}, ErrNotApproved
	}
	plain, hash := token.New()
	l, err := q.CreateShareLink(ctx, store.CreateShareLinkParams{
		CreationID: id, RelationshipID: sc.SpaceID, Version: v.Creation.Version, TokenHash: hash,
		CreatedBy: sc.UserID, ExpiresAt: s.Now().Add(ttl),
	})
	return plain, l, err
}

func (s *Service) RevokeLink(ctx context.Context, sc Scope, linkID uuid.UUID) error {
	me := sc.UserID
	n, err := store.New(s.pool).RevokeLink(ctx, store.RevokeLinkParams{ID: linkID, RelationshipID: sc.SpaceID, RevokedBy: &me})
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Service) Delete(ctx context.Context, sc Scope, id uuid.UUID) error {
	return s.inTx(ctx, func(q *store.Queries) error {
		c, err := s.load(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if c.CreatedBy != sc.UserID {
			return ErrNotCreator
		}
		me := sc.UserID
		if err := q.RevokeLinksForCreation(ctx, store.RevokeLinksForCreationParams{CreationID: id, RevokedBy: &me}); err != nil {
			return err
		}
		_, err = q.DeleteCreation(ctx, store.DeleteCreationParams{ID: id, RelationshipID: sc.SpaceID})
		return err
	})
}

// PublicImage resolves a preview link to its image key, or ErrNotFound.
func (s *Service) PublicImage(ctx context.Context, plain string) (key string, expires time.Time, err error) {
	q := store.New(s.pool)
	l, err := q.PublicLink(ctx, token.Hash(plain))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && l.RenderMediaID == nil) {
		return "", time.Time{}, ErrNotFound
	}
	if err != nil {
		return "", time.Time{}, err
	}
	m, err := q.GetMediaAny(ctx, *l.RenderMediaID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, ErrNotFound
	}
	if err != nil {
		return "", time.Time{}, err
	}
	return m.KeyFull, l.ExpiresAt, nil
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
