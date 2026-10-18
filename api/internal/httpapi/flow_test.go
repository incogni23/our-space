package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"betweenus/api/internal/auth"
	"betweenus/api/internal/httpapi"
	"betweenus/api/internal/pairing"
	"betweenus/api/internal/testdb"
)

const otp = "246810"

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: base, http: &http.Client{Jar: jar}}
}

func (c *client) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (c *client) must(method, path string, body any, want int) map[string]any {
	c.t.Helper()
	status, out := c.do(method, path, body)
	if status != want {
		c.t.Fatalf("%s %s: status %d, want %d: %v", method, path, status, want, out)
	}
	return out
}

func errCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

func (c *client) signIn(phone, name string) {
	c.t.Helper()
	v := c.must("POST", "/api/v1/auth/start", map[string]string{"phone": phone}, 200)
	c.must("POST", "/api/v1/auth/verify", map[string]string{"verificationId": v["verificationId"].(string), "code": otp}, 200)
	c.must("PATCH", "/api/v1/me", map[string]string{"displayName": name, "personTint": "terracotta"}, 200)
}

func TestOnboardingAndLeavingOverHTTP(t *testing.T) {
	pool := testdb.New(t)
	a := auth.NewService(pool, auth.DevProvider{FixedCode: otp}, []byte("pepper"))
	a.ResendAfter = 0 // covered by auth tests
	srv := httpapi.New(httpapi.Config{AppOrigin: "http://app.test"}, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, a, pairing.NewService(pool))
	ts := httptest.NewServer(srv.Routes())
	defer ts.Close()

	aarohi, dev, chris := newClient(t, ts.URL), newClient(t, ts.URL), newClient(t, ts.URL)

	// Not signed in.
	if status, out := aarohi.do("GET", "/api/v1/me", nil); status != 401 || errCode(out) != "unauthenticated" {
		t.Fatalf("want 401, got %d %v", status, out)
	}
	// Non-JSON posts are refused (CSRF guard).
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/auth/start", strings.NewReader("phone=%2B919800000001"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("form post status %d", res.StatusCode)
	}

	aarohi.signIn("+91 98000 00001", "Aarohi")
	dev.signIn("+1 646 555 0142", "Dev")
	chris.signIn("+44 7700 900123", "Chris")

	// A4–A6: name the space, invite.
	out := aarohi.must("POST", "/api/v1/space", map[string]string{"name": "Window Seat"}, 201)
	if sp := out["space"].(map[string]any); sp["status"] != "pending" {
		t.Fatalf("space: %v", sp)
	}
	inv := aarohi.must("POST", "/api/v1/space/invitations", map[string]string{"inviteeName": "Dev"}, 201)
	tok := inv["token"].(string)
	if !strings.HasPrefix(inv["url"].(string), "http://app.test/join/") {
		t.Fatalf("invite url: %v", inv["url"])
	}

	// A7: preview without signing in, then accept.
	anon := newClient(t, ts.URL)
	prev := anon.must("GET", "/api/v1/invitations/"+tok, nil, 200)
	if prev["inviterName"] != "Aarohi" || prev["spaceName"] != "Window Seat" {
		t.Fatalf("preview: %v", prev)
	}
	if _, out := aarohi.do("POST", "/api/v1/invitations/"+tok+"/accept", map[string]any{}); errCode(out) != "own_invite" {
		t.Fatalf("own invite: %v", out)
	}
	out = dev.must("POST", "/api/v1/invitations/"+tok+"/accept", map[string]any{}, 200)
	sp := out["space"].(map[string]any)
	if sp["status"] != "active" || len(sp["members"].([]any)) != 2 {
		t.Fatalf("after accept: %v", sp)
	}
	// Link is single use.
	if status, out := chris.do("POST", "/api/v1/invitations/"+tok+"/accept", map[string]any{}); status != 410 || errCode(out) != "invite_unavailable" {
		t.Fatalf("reuse: %d %v", status, out)
	}
	// Dev can't start a second space.
	if _, out := dev.do("POST", "/api/v1/space", map[string]string{"name": "Another"}); errCode(out) != "already_in_space" {
		t.Fatalf("second space: %v", out)
	}

	me := aarohi.must("GET", "/api/v1/me", nil, 200)
	if me["user"].(map[string]any)["phoneMasked"] != "+919••••••001" {
		t.Fatalf("masked phone: %v", me["user"])
	}

	// G2: Dev leaves alone, confirming with a code to his own number.
	if _, out := dev.do("POST", "/api/v1/space/leave", map[string]string{"verificationId": "00000000-0000-0000-0000-000000000000", "code": otp}); errCode(out) != "code_expired" {
		t.Fatalf("leave without code: %v", out)
	}
	v := dev.must("POST", "/api/v1/space/leave/start", map[string]any{}, 200)
	if _, out := dev.do("POST", "/api/v1/space/leave", map[string]string{"verificationId": v["verificationId"].(string), "code": "000000"}); errCode(out) != "wrong_code" {
		t.Fatalf("wrong code: %v", out)
	}
	left := dev.must("POST", "/api/v1/space/leave", map[string]any{"verificationId": v["verificationId"], "code": otp}, 200)
	if left["status"] != "unlinked" || left["readOnlyUntil"] == nil || left["newSpaceAvailableAt"] == nil {
		t.Fatalf("leave: %v", left)
	}

	me = aarohi.must("GET", "/api/v1/me", nil, 200)
	if me["space"] != nil || me["newSpaceAvailableAt"] == nil {
		t.Fatalf("aarohi after leave: %v", me)
	}
	if _, out := aarohi.do("POST", "/api/v1/space", map[string]string{"name": "Next"}); errCode(out) != "cooldown" {
		t.Fatalf("cooldown: %v", out)
	}

	// Sign out ends the session.
	aarohi.must("POST", "/api/v1/auth/sign-out", map[string]any{}, 204)
	if status, _ := aarohi.do("GET", "/api/v1/me", nil); status != 401 {
		t.Fatalf("after sign out: %d", status)
	}
}

func TestNewDeviceGetsOnlyRecoveryRoutes(t *testing.T) {
	pool := testdb.New(t)
	a := auth.NewService(pool, auth.DevProvider{FixedCode: otp}, []byte("pepper"))
	srv := httpapi.New(httpapi.Config{AppOrigin: "http://app.test"}, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, a, pairing.NewService(pool))
	ts := httptest.NewServer(srv.Routes())
	defer ts.Close()

	phone := "+919800000001"
	first := newClient(t, ts.URL)
	first.signIn(phone, "Aarohi")
	first.must("POST", "/api/v1/space", map[string]string{"name": "Window Seat"}, 201)
	codes := first.must("POST", "/api/v1/me/recovery-codes", map[string]any{}, 200)["codes"].([]any)

	second := newClient(t, ts.URL)
	v := second.must("POST", "/api/v1/auth/start", map[string]string{"phone": phone}, 429) // resend throttle
	_ = v
	a.ResendAfter = 0
	v = second.must("POST", "/api/v1/auth/start", map[string]string{"phone": phone}, 200)
	out := second.must("POST", "/api/v1/auth/verify", map[string]string{"verificationId": v["verificationId"].(string), "code": otp}, 200)
	if out["sessionStatus"] != auth.SessionNeedsSecondFactor {
		t.Fatalf("want needs_second_factor: %v", out)
	}
	if status, out := second.do("GET", "/api/v1/me", nil); status != 403 || errCode(out) != "needs_second_factor" {
		t.Fatalf("me before recovery: %d %v", status, out)
	}
	second.must("POST", "/api/v1/auth/recovery", map[string]string{"code": codes[0].(string)}, 200)
	me := second.must("GET", "/api/v1/me", nil, 200)
	if me["space"] == nil {
		t.Fatal("space missing after recovery")
	}
}
