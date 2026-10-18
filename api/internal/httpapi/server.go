// Package httpapi exposes the JSON API under /api/v1.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/auth"
	"betweenus/api/internal/boards"
	"betweenus/api/internal/jobs"
	"betweenus/api/internal/live"
	"betweenus/api/internal/media"
	"betweenus/api/internal/notes"
	"betweenus/api/internal/pairing"
	"betweenus/api/internal/plans"
	"betweenus/api/internal/store"
	"betweenus/api/internal/story"
	"betweenus/api/internal/token"
	"betweenus/api/internal/unfurl"
)

const (
	sessionCookie = "bu_session"
	deviceCookie  = "bu_device"
)

type Config struct {
	// Blobs stores photo bytes (local folder in development, S3-compatible otherwise).
	Blobs media.Blobs
	// AppOrigin is where the web app lives, used to build invite links.
	AppOrigin    string
	CookieSecure bool
	// TrustProxy: read the client IP from X-Forwarded-For (only behind a known proxy).
	TrustProxy bool
}

type Server struct {
	cfg     Config
	log     *slog.Logger
	pool    *pgxpool.Pool
	auth    *auth.Service
	pairing *pairing.Service
	boards  *boards.Service
	plans   *plans.Service
	media   *media.Service
	story   *story.Service
	live    *live.Hub

	unfurl *unfurl.Client
	notes  *notes.Service
	jobs   *jobs.Runner
}

func New(cfg Config, log *slog.Logger, pool *pgxpool.Pool, a *auth.Service, p *pairing.Service) *Server {
	return &Server{cfg: cfg, log: log, pool: pool, auth: a, pairing: p, boards: boards.NewService(pool), plans: plans.NewService(pool),
		media: media.NewService(pool, cfg.Blobs), story: story.NewService(pool), live: live.NewHub(pool, log),
		unfurl: unfurl.New(), notes: notes.NewService(pool), jobs: jobs.NewRunner(pool, log)}
}

// Start runs background work (live-event listener, job runner) until ctx ends.
func (s *Server) Start(ctx context.Context) {
	s.registerJobs()
	go s.live.Run(ctx)
	go s.jobs.Run(ctx)
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(s.requireJSON)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.pool.Ping(r.Context()); err != nil {
			http.Error(w, "db unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/start", s.handleStartSignIn)
		r.Post("/auth/verify", s.handleVerifySignIn)
		r.Post("/auth/sign-out", s.handleSignOut)
		r.Get("/invitations/{token}", s.handlePreviewInvitation)

		// Sessions waiting for a second factor may only use these.
		r.Group(func(r chi.Router) {
			r.Use(s.withSession(true))
			r.Post("/auth/recovery", s.handleRecovery)
			r.Post("/auth/start-fresh", s.handleStartFresh)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.withSession(false))
			r.Get("/me", s.handleMe)
			r.Get("/live", s.handleLive)
			r.Patch("/me", s.handleUpdateProfile)
			r.Post("/me/recovery-codes", s.handleRecoveryCodes)
			r.Post("/me/phone/start", s.handlePhoneStart)
			r.Post("/me/phone/approve", s.handlePhoneApprove)
			r.Post("/me/phone", s.handleChangeNumber)
			r.Post("/notices/{id}/seen", s.handleNoticeSeen)

			r.Get("/space", s.handleGetSpace)
			r.Post("/space", s.handleCreateSpace)
			r.Post("/space/invitations", s.handleCreateInvitation)
			r.Post("/space/leave/start", s.handleLeaveStart)
			r.Post("/space/leave", s.handleLeave)
			r.Post("/invitations/{token}/accept", s.handleAccept)
			r.Post("/invitations/{token}/decline", s.handleDecline)

			// Content inside an active space (canvas B–C).
			r.Get("/space/home", s.handleHome)
			r.Get("/boards", s.handleListBoards)
			r.Post("/boards", s.handleCreateBoard)
			r.Get("/boards/{id}", s.handleGetBoard)
			r.Post("/pins", s.handleCreatePin)
			r.Get("/pins/{id}", s.handleGetPin)
			r.Patch("/pins/{id}", s.handleUpdatePin)
			r.Delete("/pins/{id}", s.handleDeletePin)
			r.Post("/pins/{id}/restore", s.handleRestorePin)
			r.Post("/pins/{id}/notes", s.handleAddPinNote)
			r.Get("/plans", s.handleListPlans)
			r.Post("/plans", s.handleCreatePlan)
			r.Get("/plans/{id}", s.handleGetPlan)
			r.Patch("/plans/{id}", s.handleUpdatePlan)
			r.Post("/plans/{id}/respond", s.handleRespondPlan)
			r.Post("/plans/{id}/cancel", s.handleCancelPlan)
			r.Post("/media", s.handleUploadMedia)
			r.Get("/media/{id}/{variant}", s.handleGetMedia)
			r.Get("/memories", s.handleListMemories)
			r.Post("/memories", s.handleCreateMemory)
			r.Get("/memories/{id}", s.handleGetMemory)
			r.Delete("/memories/{id}", s.handleDeleteMemory)
			r.Get("/export", s.handleExport)
			r.Get("/notes", s.handleListNotes)
			r.Post("/notes", s.handleCreateNote)
			r.Get("/notes/{id}", s.handleGetNote)
			r.Patch("/notes/{id}", s.handleUpdateNote)
			r.Delete("/notes/{id}", s.handleDeleteNote)
			r.Post("/notes/{id}/keep", s.handleKeepNote)
		})
	})
	return r
}

// requireJSON: mutating requests must be application/json. With SameSite=Lax
// cookies this stops cross-site form posts (a cross-origin JSON post needs CORS).
func (s *Server) requireJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if r.URL.Path == "/api/v1/media" && mt == "multipart/form-data" {
				// Photo uploads: a custom header a cross-site form can't send.
				if r.Header.Get("X-BU-Upload") != "1" {
					writeError(w, http.StatusForbidden, "bad_upload", "Upload from the app.")
					return
				}
				break
			}
			if mt != "application/json" {
				writeError(w, http.StatusUnsupportedMediaType, "json_required", "Send JSON.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type ctxKey int

const sessionKey ctxKey = 1

type reqSession struct {
	store.Session
	token string
}

func (s *Server) withSession(allowSecondFactor bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(sessionCookie)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthenticated", "Please sign in.")
				return
			}
			sess, err := s.auth.Authenticate(r.Context(), c.Value)
			switch {
			case err == nil:
			case errors.Is(err, auth.ErrNeedsSecondFactor) && allowSecondFactor:
			case errors.Is(err, auth.ErrNeedsSecondFactor):
				writeError(w, http.StatusForbidden, "needs_second_factor", "One more check.")
				return
			case errors.Is(err, auth.ErrUnauthenticated):
				s.clearSession(w)
				writeError(w, http.StatusUnauthorized, "unauthenticated", "Please sign in.")
				return
			default:
				s.serverError(w, r, err)
				return
			}
			ctx := context.WithValue(r.Context(), sessionKey, reqSession{Session: sess, token: c.Value})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func session(r *http.Request) reqSession {
	return r.Context().Value(sessionKey).(reqSession)
}

func (s *Server) setSession(w http.ResponseWriter, tok string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: tok, Path: "/", Expires: expires,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// device returns the long-lived device id, minting one if absent.
func (s *Server) device(w http.ResponseWriter, r *http.Request) auth.Device {
	id := ""
	if c, err := r.Cookie(deviceCookie); err == nil && len(c.Value) >= 32 {
		id = c.Value
	} else {
		id, _ = token.New()
		http.SetCookie(w, &http.Cookie{
			Name: deviceCookie, Value: id, Path: "/", MaxAge: 5 * 365 * 24 * 3600,
			HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
		})
	}
	return auth.Device{ID: id, Label: r.UserAgent()}
}

func (s *Server) clientIP(r *http.Request) *netip.Addr {
	raw := r.RemoteAddr
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			raw = strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	addr, err := netip.ParseAddr(raw)
	if err != nil {
		return nil
	}
	return &addr
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "That request didn’t make sense.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type apiError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	RetryAfter int    `json:"retryAfterSeconds,omitempty"`
	Available  string `json:"availableAt,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: msg}})
}

func (s *Server) serverError(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Error("request failed", "err", err, "path", r.URL.Path, "request_id", middleware.GetReqID(r.Context()))
	writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
}

// domainError maps service errors to responses. Copy follows canvas 5.2.
func (s *Server) domainError(w http.ResponseWriter, r *http.Request, err error) {
	var rl *auth.RateLimitError
	var cd *pairing.CooldownError
	switch {
	case errors.As(err, &rl):
		writeJSON(w, http.StatusTooManyRequests, map[string]apiError{"error": {
			Code: "rate_limited", Message: "Too many codes. Try again in a little while.", RetryAfter: int(rl.RetryAfter.Seconds()) + 1,
		}})
	case errors.As(err, &cd):
		writeJSON(w, http.StatusConflict, map[string]apiError{"error": {
			Code: "cooldown", Message: "You can start a new space a little later.", Available: cd.AvailableAt.UTC().Format(time.RFC3339),
		}})
	case errors.Is(err, auth.ErrInvalidPhone):
		writeError(w, http.StatusBadRequest, "invalid_phone", "That number doesn’t look right. Include your country code.")
	case errors.Is(err, auth.ErrWrongCode):
		writeError(w, http.StatusBadRequest, "wrong_code", "That code isn’t right. Check it and try again.")
	case errors.Is(err, auth.ErrTooManyAttempts), errors.Is(err, auth.ErrVerificationGone):
		writeError(w, http.StatusGone, "code_expired", "That code has run out. We can send a new one.")
	case errors.Is(err, auth.ErrWrongRecoveryCode):
		writeError(w, http.StatusBadRequest, "wrong_recovery_code", "That recovery code isn’t recognised.")
	case errors.Is(err, auth.ErrApprovalMissing):
		writeError(w, http.StatusForbidden, "confirm_phone", "Confirm it’s you with a code first.")
	case errors.Is(err, auth.ErrPhoneInUse):
		writeError(w, http.StatusConflict, "phone_in_use", "That number belongs to another account.")
	case errors.Is(err, auth.ErrSamePhone):
		writeError(w, http.StatusBadRequest, "same_phone", "That’s already your number.")
	case errors.Is(err, auth.ErrInvalidProfile), errors.Is(err, pairing.ErrInvalidName):
		writeError(w, http.StatusBadRequest, "invalid_input", "Check the name and try again.")
	case errors.Is(err, auth.ErrNoSecondFactor):
		writeError(w, http.StatusConflict, "no_second_factor", "You’re already signed in.")
	case errors.Is(err, pairing.ErrAlreadyInSpace):
		writeError(w, http.StatusConflict, "already_in_space", "You’re already in a space. To join a different one, you’d leave that space first.")
	case errors.Is(err, pairing.ErrNotInSpace):
		writeError(w, http.StatusNotFound, "not_in_space", "You’re not in a space yet.")
	case errors.Is(err, pairing.ErrSpaceNotPending):
		writeError(w, http.StatusConflict, "space_not_pending", "Your space already has two people.")
	case errors.Is(err, pairing.ErrPhoneNotVerified):
		writeError(w, http.StatusForbidden, "phone_not_verified", "Verify your number first.")
	case errors.Is(err, pairing.ErrInviteNotFound):
		writeError(w, http.StatusNotFound, "invite_not_found", "We couldn’t find that invite.")
	case errors.Is(err, pairing.ErrInviteExpired):
		writeError(w, http.StatusGone, "invite_expired", "This invite has run out. Invites last 3 days so old links can’t be reused.")
	case errors.Is(err, pairing.ErrInviteUnavailable):
		writeError(w, http.StatusGone, "invite_unavailable", "This invite can’t be used any more.")
	case errors.Is(err, boards.ErrNoActiveSpace):
		writeError(w, http.StatusForbidden, "no_active_space", "This opens once you’re both in the space.")
	case errors.Is(err, boards.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "That isn’t here any more.")
	case errors.Is(err, boards.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_input", "Check what you typed and try again.")
	case errors.Is(err, boards.ErrBoardRequired):
		writeError(w, http.StatusBadRequest, "board_required", "Choose a board, or make a new one.")
	case errors.Is(err, notes.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "That note isn’t here any more.")
	case errors.Is(err, notes.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_input", "Check the note and when it opens.")
	case errors.Is(err, notes.ErrInPast):
		writeError(w, http.StatusBadRequest, "in_past", "That time has already passed.")
	case errors.Is(err, notes.ErrNoPartner):
		writeError(w, http.StatusConflict, "no_partner", "There’s nobody to write to yet.")
	case errors.Is(err, notes.ErrDelivered):
		writeError(w, http.StatusConflict, "already_delivered", "It’s already been delivered.")
	case errors.Is(err, notes.ErrNotAuthor), errors.Is(err, notes.ErrNotForThem):
		writeError(w, http.StatusForbidden, "not_allowed", "That isn’t yours to change.")
	case errors.Is(err, story.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "That memory isn’t here any more.")
	case errors.Is(err, story.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_input", "Check the title, date and photos.")
	case errors.Is(err, plans.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "That plan isn’t here any more.")
	case errors.Is(err, plans.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_input", "Check the name, date and time.")
	case errors.Is(err, plans.ErrInPast):
		writeError(w, http.StatusBadRequest, "in_past", "That time has already passed.")
	case errors.Is(err, plans.ErrNotYourTurn):
		writeError(w, http.StatusConflict, "not_your_turn", "Waiting on the other person to answer.")
	case errors.Is(err, plans.ErrClosed):
		writeError(w, http.StatusConflict, "plan_closed", "This plan was already answered or cancelled.")
	case errors.Is(err, pairing.ErrOwnInvite):
		writeError(w, http.StatusBadRequest, "own_invite", "This is your own invite. Send it to your person.")
	default:
		s.serverError(w, r, err)
	}
}

func parseUUID(w http.ResponseWriter, s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "That request didn’t make sense.")
		return uuid.Nil, false
	}
	return id, true
}
