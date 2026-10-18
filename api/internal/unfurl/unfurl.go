// Package unfurl fetches link previews (title, site, description, image) safely.
//
// SSRF protection: only http/https on ports 80/443, and the dialer checks the
// resolved IP of every connection (redirects included, so DNS rebinding can't
// slip past) against private, loopback, link-local, CGNAT and other
// non-public ranges. Responses are size- and time-limited.
package unfurl

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/html"
)

var ErrBlocked = errors.New("unfurl: address not allowed")

const (
	maxHTML  = 512 << 10
	maxImage = 8 << 20
)

type Preview struct {
	Title       string
	Site        string
	Description string
	ImageURL    string
}

type Client struct{ http *http.Client }

var blocked = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

func allowedAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || !addr.IsGlobalUnicast() {
		return false
	}
	for _, p := range blocked {
		if p.Contains(addr) {
			return false
		}
	}
	return true
}

// control runs after DNS resolution, right before connect: the IP checked here
// is the one actually dialed.
func control(_, address string, _ syscall.RawConn) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return ErrBlocked
	}
	if port != "80" && port != "443" {
		return ErrBlocked
	}
	addr, err := netip.ParseAddr(host)
	if err != nil || !allowedAddr(addr) {
		return ErrBlocked
	}
	return nil
}

func New() *Client {
	dialer := &net.Dialer{Timeout: 4 * time.Second, Control: control}
	tr := &http.Transport{
		Proxy:                  nil, // never via an environment proxy
		DialContext:            dialer.DialContext,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  5 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		MaxIdleConns:           10,
		IdleConnTimeout:        30 * time.Second,
	}
	return &Client{http: &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return errors.New("unfurl: too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return ErrBlocked
			}
			return nil
		},
	}}
}

func checkURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return nil, ErrBlocked
	}
	if p := u.Port(); p != "" && p != "80" && p != "443" {
		return nil, ErrBlocked
	}
	return u, nil
}

func (c *Client) get(ctx context.Context, raw, accept string) (*http.Response, error) {
	u, err := checkURL(raw)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; BetweenUsPreview/1.0)")
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", "en")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		res.Body.Close()
		return nil, fmt.Errorf("unfurl: status %d", res.StatusCode)
	}
	return res, nil
}

// Page reads Open Graph / Twitter / <title> metadata from an HTML page.
func (c *Client) Page(ctx context.Context, raw string) (Preview, error) {
	res, err := c.get(ctx, raw, "text/html,application/xhtml+xml")
	if err != nil {
		return Preview{}, err
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "html") {
		return Preview{}, fmt.Errorf("unfurl: not html (%s)", ct)
	}
	p := parse(io.LimitReader(res.Body, maxHTML))
	if p.ImageURL != "" {
		if iu, err := res.Request.URL.Parse(p.ImageURL); err == nil {
			p.ImageURL = iu.String()
		} else {
			p.ImageURL = ""
		}
	}
	if p.Site == "" {
		p.Site = strings.TrimPrefix(res.Request.URL.Hostname(), "www.")
	}
	return p, nil
}

// Image downloads a preview image (size-limited); the caller re-encodes it.
func (c *Client) Image(ctx context.Context, raw string) ([]byte, error) {
	res, err := c.get(ctx, raw, "image/*")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "image/") {
		return nil, errors.New("unfurl: not an image")
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, maxImage+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxImage {
		return nil, errors.New("unfurl: image too large")
	}
	return b, nil
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(html.UnescapeString(s)), " ")
	if r := []rune(s); len(r) > n {
		return strings.TrimSpace(string(r[:n-1])) + "…"
	}
	return s
}

func parse(r io.Reader) Preview {
	var p Preview
	var title string
	z := html.NewTokenizer(r)
	inTitle := false
	for {
		switch z.Next() {
		case html.ErrorToken:
			return finish(p, title)
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			tag := string(name)
			if tag == "body" {
				return finish(p, title)
			}
			if tag == "title" {
				inTitle = true
				continue
			}
			if tag != "meta" || !hasAttr {
				continue
			}
			var key, content string
			for {
				k, v, more := z.TagAttr()
				switch string(k) {
				case "property", "name":
					key = strings.ToLower(string(v))
				case "content":
					content = string(v)
				}
				if !more {
					break
				}
			}
			switch key {
			case "og:title":
				p.Title = clip(content, 200)
			case "og:site_name":
				p.Site = clip(content, 120)
			case "og:description":
				p.Description = clip(content, 300)
			case "description":
				if p.Description == "" {
					p.Description = clip(content, 300)
				}
			case "og:image", "og:image:secure_url", "twitter:image":
				if p.ImageURL == "" {
					p.ImageURL = strings.TrimSpace(content)
				}
			case "twitter:title":
				if p.Title == "" {
					p.Title = clip(content, 200)
				}
			}
		case html.TextToken:
			if inTitle && title == "" {
				title = clip(string(z.Text()), 200)
			}
		case html.EndTagToken:
			if name, _ := z.TagName(); string(name) == "title" {
				inTitle = false
			}
		}
	}
}

func finish(p Preview, title string) Preview {
	if p.Title == "" {
		p.Title = title
	}
	return p
}
