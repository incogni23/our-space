# Between Us — build plan

A little world for two. Your story, your way.

Source of truth for design: the **Between Us · Product design** canvas
(https://claude.ai/artifact/VKp72GNYrUgFZMY3fLnn55). Screen IDs below (A1, E4, G2…) refer to its artboards.
Design tokens: `design/tokens.json`, `design/tokens.css` (v0.1, match canvas 4.1).

## Non-negotiables (from the product definition)

1. Exclusivity is enforced by the database and backend, never only the UI.
2. Forming a space needs both people's consent. Leaving needs only one.
3. A verified phone can belong to only one active relationship. A relationship has exactly two members.
4. Logging out, reinstalling or changing devices never frees a relationship slot.
5. A phone OTP proves control of a number, not consent, and never alone opens an existing space on a new device.
6. Private content never becomes public without an explicit sharing action.
7. Content featuring both partners needs both approvals before it is "approved by both". Either can withdraw before export.
8. Originals are never altered by edits; exports are new assets.
9. Revoking a link stops the link, not copies. Say so in the UI.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS mapped to `tokens.css` + accessible primitives (Radix) |
| Backend | Go + Chi |
| Database | PostgreSQL 16 |
| DB access | pgx v5 + sqlc |
| Migrations | goose (SQL files in `db/migrations`) |
| Real-time | Server-Sent Events + Postgres LISTEN/NOTIFY for space updates; Together sessions use SSE + POST (in-memory presence, single instance for now) |
| Jobs | Postgres-backed durable jobs (`jobs` table, `SKIP LOCKED`) — `api/internal/jobs` |
| Media | S3-compatible object storage (MinIO locally) |
| Calls | Managed WebRTC (later) |
| Deploy | Managed containers |
| CI/CD | GitHub Actions |

## Repo layout

```
api/            Go service (cmd/api, internal/…)
db/migrations/  goose SQL migrations
db/queries/     sqlc query files
web/            Next.js app
design/         tokens.json, tokens.css
todo.md
```

---

## Phase 0 · Foundations

- [x] Repo skeleton, README, `.gitignore`, `git init`
- [x] `design/` tokens checked in
- [x] Local Postgres for dev/tests (script that runs a throwaway cluster)
- [ ] Go module, Chi router, config from env, health check, structured logging
- [x] goose migrations + sqlc config wired to `db/`
- [x] Next.js app with Tailwind theme generated from `tokens.css` (light + evening)
- [x] Fonts: Newsreader, DM Sans, DM Mono
- [ ] GitHub Actions: go vet/test (with Postgres service), web lint/typecheck/build

## Phase 1 · Identity & exclusive pairing (weeks 1–2)

Schema
- [x] `users` (phone E.164 unique, phone_verified_at, display name, person tint, backup email)
- [x] `phone_verifications` (provider ref, purpose, status, attempts, expires_at; never raw OTP)
- [x] `relationships` (status pending|active|unlinked, name e.g. "Window Seat", unlinked_at, read_only_until)
- [x] `relationship_members` + partial unique index: one open membership per user
- [x] Trigger: max two open members per relationship
- [x] `relationship_invitations` (token hash, inviter, expires_at 3 days, single use, state)
- [x] Cooldown derived from last `left_at` of an active space (no extra table)
- [x] `sessions` / devices (device-bound refresh tokens)

Pairing service (one transaction, `SELECT … FOR UPDATE`)
- [x] Create space (A4) → pending relationship + inviter membership
- [x] Create invitation (A5) → token shown once, hash stored
- [x] Accept (A7): lock invitation + both users; verify phones; check neither is paired, no cooldown; insert member; activate
- [x] Concurrent accepts: only one wins; loser gets a clear error
- [x] Inviter never learns *why* an invite failed (decline vs already paired look identical, canvas 5.2)
- [x] Expired / reused link → friendly "this invite has run out"
- [x] Tests for every row of the situation table (second pairing blocked, accept-while-paired rejected, logout keeps pairing…)

Auth & verification
- [x] OTP provider interface + dev provider; rate limits per phone (30s resend, 5/h) & IP (20/h); 10 min expiry; 5 attempts
- [ ] Twilio Verify (or chosen provider) adapter
- [x] New device + existing account → second factor required (backup email code or recovery code) — G5
- [x] Recycled number path: "This number is new to me" → fresh account, old one stays locked — G5
- [x] Change number API (G4): approve current + new number, swap atomically
- [x] G4 screen · partner notice "updated their number"
- [x] Recovery codes (8, HMAC-hashed), G5 screen
- [ ] Backup email + email codes (G5 option 1) · manual review path ("I don't have either")
- [x] Rate-limit wrong recovery-code attempts (5, then session revoked)

Leaving (G1–G3)
- [x] Unilateral leave: confirm with OTP, close membership(s), relationship → unlinked, read_only_until = +30 days
- [x] Partner "space has closed" notice + neutral closed screen
- [ ] DECIDE: "tell them tomorrow" (G2) — partner's app changes immediately, so a delay hides nothing today. Option hidden in UI until decided
- [ ] Revoke all share links on leave
- [x] Cooldown 7 days before a new space
- [ ] Download-a-copy export job; "delete my copy now"
- [x] Neutral, identical "space has closed" screen for both people

Onboarding UI (A1–A8)
- [x] A1 Welcome · A2 Your number · A3 Code · A4 Name the space · A5 Invite · A6 Waiting · A7 Accept (partner) · A8 Make it yours
- [x] Settings (G1), Leave (G2), After leaving (G3), Day-one placeholder
- [ ] A8 → H1 paywall hand-off (needs Phase 1b)

## Phase 2 · The private space (weeks 3–4)  ✓ done

- [x] Our Space home (B1): greeting, both clocks, "New from <partner>", bottom nav
- [x] Time zone per person (detected on A4/A8)
- [x] Boards & pins (C1–C3): save link/place/song/idea, first board auto-created, new board inline, visual/list views, filters, pin detail, status Saved/Planned/Done/Remembered, notes between you, remove + undo
- [x] Link previews: server-side Open Graph fetch with SSRF guard (public IPs on 80/443 only, checked at connect time, redirects re-checked, size/time limits); preview image re-encoded and stored like a photo so viewers never load third-party URLs
- [ ] Awake hours (A8) + "both usually awake" overlap on B1
- [x] Plans (D1–D3): plan from a pin (pin → planned), meet-up or call, both clocks with day labels, weekly repeat on the anchor zone's wall clock, DST notes, invite to confirm → accept / suggest another time / decline, edit, cancel, .ics export, month view, "Next together" on B1
- [ ] Trips (partner's travel dates → "you're both in Bengaluru that day", countdown on B1)
- [x] Plan reminders (Phase 3)
- [x] Our Story timeline (E0): moments, trips, a change, where it started; year sections; filters; memory detail; add a memory with photos
- [ ] "A year ago this weekend" card on B1 · "Made" filter (Phase 4)
- [x] Photo upload: server re-encodes every photo (orientation applied, GPS and all metadata removed, display copy + thumbnail), served only to members via the API; local folder or any S3-compatible store (MinIO/S3/R2)
- [ ] Photo pins on boards · resumable uploads · video
- [x] Read-only access to a closed space until `read_only_until` (both former members); write actions hidden; "Download a copy" zip export (also in Settings)
- [x] Delete closed spaces' content after `read_only_until` (Phase 3 job runner)
- [x] Live updates: Server-Sent Events per space, fanned out through Postgres LISTEN/NOTIFY (multi-instance safe); boards, pins, notes, plans, memories, partner joined, space closed. Events carry what changed, never presence
- [ ] WebSockets for Together sessions (Phase 5)
- [ ] Offline outbox ("Waiting to send", never claims sent) → moved to Phase 5 with the PWA/service worker

## Phase 3 · Notes & rituals (week 5)  ✓ done

- [x] Durable job runner on Postgres (SKIP LOCKED, backoff, enqueued inside the caller's transaction, dedupe keys)
- [x] Scheduled notes (NoteLetter 4.3): draft · scheduled · waiting (sealed: who and when only) · delivered; body never sent to the recipient before delivery; author sees "Delivered", never "Opened"; keep; take back
- [x] "Tomorrow morning" = 7:00 their time; pick a time in their time or yours
- [x] Plan reminders: the evening before (8 pm in each person's own zone) or an hour before; rescheduled with every change; weekly plans roll forward; in-app notice
- [x] Closed spaces purged when the read-only window ends (content, photos, blobs)
- [x] Link previews moved onto the job runner
- [ ] Web Push for things with a time (notes opening, reminders) — needs the PWA/service worker (Phase 5)
- [ ] Email receipts/notifications (provider TBD)

## Phase 4 · Made by Us (week 6)  ✓ done (except F5)

Schema: `creations` (spec + rendered image as its own media row, version), `creation_approvals` (bound to version), `share_links`
- [x] F1 format picker from any memory with photos (Faceless · Soft launch · Photo dump · Collage; Reel shown as later)
- [x] E1 pick photos in order · E2 layout (clean grid, film strip, photo dump) and size (4:5, 9:16, 1:1) · E3 caption, caption style, background, spacing
- [x] F2 Soft launch on your own photo: faceless (tight crop around a point you tap) · hint (initials sticker + date stamp) · full reveal
- [x] One browser renderer for preview and export (WYSIWYG); export is a new image, originals untouched; server re-encodes, no metadata
- [x] E4 who sees it: keep it between us · ask partner then export · ask partner then share a link · export just for me (never "approved")
- [x] E5 approvals: approve · suggest a change (comment) · not this one · withdraw; any edit is a new version and asks again
- [x] F4 preview links: token hash, 24h/7d/30d, either can turn off, bound to the approved version, stop when the space closes; public page shows only the image, no-index, no-referrer, no tracking
- [x] Purge covers creations, approvals and links
- [ ] F5 Our public side (shared name, bio ideas, look, profile picture) — changes need partner OK
- [ ] F3 Reel Maker (server-side video rendering) — Later

## Product decisions made during the build

Kept in sync with the canvas (5.2 States, 5.4 Product calls, 4.3 Content, prototype stickies).

- 2026-10-18 · Read receipts: the note's writer sees when it was read (replaces the canvas's "never Opened"); the reader is told "<name> can see when you read this". Canvas updated (5.2 Notes, 5.4 #05, 4.3 NoteLetter).
- 2026-10-18 · Plan history: plans are never deleted; History tab shows past, declined and cancelled plans; each plan keeps a "What happened" timeline. Canvas updated (5.4 #07, sticky on prototype row B–D).

## Phase 5 · Polish & safety (week 7)  ← in progress

- [x] Security headers: CSP, frame-ancestors none, nosniff, referrer and permissions policy, HSTS in production; strict CSP on API responses
- [x] Per-session/IP rate limits on the whole API (reads 600/min, writes 120/min; OTP limits stay in Postgres)
- [x] Idempotency-Key replay for retried POSTs (no duplicate pins/notes after a dropped connection)
- [x] Installable PWA: manifest, icons (emblem), service worker; pages and your data readable offline from the last copy; cleared on sign-out
- [x] Offline outbox: pins, pin notes and notes saved offline wait ("N waiting to send") and send when back; never shown as sent early
- [x] Web Push for things with a time: note opening ("A note is here for you", lock-screen safe) and plan reminders; endpoints restricted to known push services; VAPID keys from env (dev keys kept in .devdb)
- [x] 5.2 states sweep: added "Dev said yes to coffee" plan-answer notice (in-app, no push); others covered
- [ ] Plans empty state: suggest a saved pin ("Little Ondu is still waiting for a date")
- [x] Evening theme audit: no hard-coded colours outside intentional photo overlays; envelope flap is now a token
- [x] Keyboard: soft-launch crop point moves with arrow keys
- [ ] Screen-reader pass on a real device (VoiceOver/TalkBack)
- [x] Authorization review of every route (all content scoped to the caller's space; fixed: DELETE requests were refused by the JSON guard)
- [x] Audit log of sensitive actions: sign-in, recovery code used, start fresh, number changed, recovery codes regenerated, space created/joined/left
- [x] Together v1 (5.4 #04): start a session (title + optional link), partner invited (notice + push), presence only inside the session and never stored, shared 3-2-1 start, pause/resume/±10s for both, auto-pause when a partner's connection drops (held 5 min, 5.2), messages not saved. SSE + POST instead of WebSockets (works through the proxy)
- [ ] Together: true sync with providers (later); multi-instance presence

## Phase 6b · Subscription (do last, before beta) (canvas row H, handoff 5.5)

Plans: 7 days $20 · 3 months $150 · 1 year $450 (USD). One subscription per space covers both; either can pay.
Paywall comes after pairing (A8 → H1), so nobody pays before their partner says yes.

Schema
- [ ] `subscriptions` (relationship_id, payer_user_id, plan, status trialing|active|past_due|canceled|lapsed, current_period_end, cancel_at_period_end, provider ids)
- [ ] `billing_events` (provider webhook log, idempotency key, raw payload hash)
- [ ] At most one live subscription per relationship (partial unique index)

Backend
- [ ] Provider: **Dodo Payments** (merchant of record, handles tax). Adapter behind an interface
- [ ] India: renewals debit ~48h after the renewal date (pre-debit window) — grant/extend access only on `payment.succeeded` / `subscription.renewed`, keep the space open meanwhile; $450/yr is above the ₹15,000 on-demand mandate so it uses a fixed-amount mandate (H2 copy must vary by plan)
- [ ] Checkout session (H2, `POST /checkouts`) — card form rendered by Dodo, never touches our servers; space_id + payer_id in metadata
- [ ] Webhooks: Standard Webhooks signature (`webhook-id/-timestamp/-signature`), dedupe on `webhook-id` in DB, events may arrive out of order → upsert by provider subscription id and re-fetch state
- [ ] Map Dodo statuses (active, past_due, on_hold, cancelled, expired, failed) to our states (active, canceling, past_due, lapsed)
- [ ] Entitlement check: active/past_due-grace → full access; lapsed/canceled-after-period → read-only, never deleted
- [ ] Cancel at period end (H5), turn renewal back on, change plan at next renewal (H4), upgrade now with proration
- [ ] "Who pays" handover to partner from next renewal
- [ ] Renewal reminder 7 days before (both partners), receipts to payer email
- [ ] Partner view (H6): "Covered by <name>" + end date only, never card or amount details
- [ ] Payer leaves the space → stop auto-renew immediately (decide refund policy)

UI
- [ ] H1 choose plan · "Ask <partner> to choose" · H2 review & pay · H3 you're both covered
- [ ] H4 Settings › Subscription · H5 cancel plainly · H6 partner's view
- [ ] Read-only banner + restart for lapsed spaces

## Phase 6 · Beta (week 8)

- [ ] Deploy (managed containers + managed Postgres + S3)
- [ ] Small couples beta, feedback loop

## Later

- [ ] F3 Reel Maker with server-side video rendering (MP4), licensed/user audio only
- [ ] Native share sheet to Instagram where supported
- [ ] Direct Instagram publishing (investigate Meta API first; don't promise)
- [ ] Calls via managed WebRTC

---

## Ideas (not on the canvas)

- Chat between the two of you, beyond notes and pin notes (maybe). Open questions: always-on thread vs. tied to plans/pins; read receipts consistent with notes; how it fits "no global presence" (5.4).

## Open questions

- OTP provider (Twilio Verify vs MessageBird vs Firebase) and target countries
- Web-first only, or PWA install from day one?
- Data retention after unlink: 30 days fixed, or configurable?
- Recovery review (G5 "I don't have either"): who staffs it?
