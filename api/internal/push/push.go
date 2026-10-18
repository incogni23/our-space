// Package push sends Web Push notifications, only for things with a time.
//
// Privacy: payloads say as little as possible, because they can show on a lock
// screen ("A note is here for you", never who from or what it says).
// Safety: subscriptions may only point at known browser push services, so a
// forged endpoint can't turn the server into a request proxy.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"betweenus/api/internal/store"
)

var ErrBadEndpoint = errors.New("push: endpoint not allowed")

// Known push services (Chrome/Edge via FCM, Firefox, Safari/Apple, Windows).
var allowedHosts = []string{
	"fcm.googleapis.com",
	".push.services.mozilla.com",
	"web.push.apple.com",
	".push.apple.com",
	".notify.windows.com",
}

func endpointAllowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	h := strings.ToLower(u.Hostname())
	for _, a := range allowedHosts {
		if h == a || (strings.HasPrefix(a, ".") && strings.HasSuffix(h, a)) {
			return true
		}
	}
	return false
}

type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag,omitempty"`
}

type Service struct {
	pool       *pgxpool.Pool
	log        *slog.Logger
	PublicKey  string
	privateKey string
	subject    string
}

func NewService(pool *pgxpool.Pool, log *slog.Logger, publicKey, privateKey, subject string) *Service {
	return &Service{pool: pool, log: log, PublicKey: publicKey, privateKey: privateKey, subject: subject}
}

// GenerateKeys makes a VAPID key pair (development, or first deploy).
func GenerateKeys() (public, private string, err error) {
	private, public, err = webpush.GenerateVAPIDKeys()
	return public, private, err
}

func (s *Service) Enabled() bool { return s != nil && s.PublicKey != "" && s.privateKey != "" }

func (s *Service) Subscribe(ctx context.Context, user uuid.UUID, endpoint, p256dh, auth string) error {
	if !endpointAllowed(endpoint) || p256dh == "" || auth == "" || len(p256dh) > 200 || len(auth) > 100 {
		return ErrBadEndpoint
	}
	return store.New(s.pool).UpsertPushSubscription(ctx, store.UpsertPushSubscriptionParams{UserID: user, Endpoint: endpoint, P256dh: p256dh, Auth: auth})
}

func (s *Service) Unsubscribe(ctx context.Context, user uuid.UUID, endpoint string) error {
	return store.New(s.pool).DeletePushSubscription(ctx, store.DeletePushSubscriptionParams{Endpoint: endpoint, UserID: user})
}

// Send delivers to every device the user has subscribed. Gone subscriptions are
// removed. Best-effort: errors are logged, never surfaced to the caller's flow.
func (s *Service) Send(ctx context.Context, user uuid.UUID, m Message) {
	if !s.Enabled() {
		return
	}
	q := store.New(s.pool)
	subs, err := q.PushSubscriptionsFor(ctx, user)
	if err != nil || len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(m)
	for _, sub := range subs {
		if !endpointAllowed(sub.Endpoint) {
			_ = q.DeletePushEndpoint(ctx, sub.Endpoint)
			continue
		}
		res, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
		}, &webpush.Options{
			Subscriber:      s.subject,
			VAPIDPublicKey:  s.PublicKey,
			VAPIDPrivateKey: s.privateKey,
			TTL:             6 * 3600,
			Urgency:         webpush.UrgencyNormal,
			Topic:           topic(m.Tag),
		})
		if err != nil {
			s.log.Info("push send failed", "err", err)
			continue
		}
		res.Body.Close()
		switch {
		case res.StatusCode == http.StatusGone || res.StatusCode == http.StatusNotFound:
			_ = q.DeletePushEndpoint(ctx, sub.Endpoint)
		case res.StatusCode >= 200 && res.StatusCode < 300:
			_ = q.TouchPushSubscription(ctx, sub.ID)
		default:
			s.log.Info("push rejected", "status", res.StatusCode)
		}
	}
}

// topic collapses repeats of the same thing (max 32 URL-safe chars).
func topic(tag string) string {
	t := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return -1
	}, tag)
	if len(t) > 32 {
		t = t[:32]
	}
	return t
}
