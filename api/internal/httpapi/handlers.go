package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"

	"betweenus/api/internal/auth"
	"betweenus/api/internal/pairing"
	"betweenus/api/internal/store"
)

type userJSON struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	PersonTint  string `json:"personTint"`
	TimeZone    string `json:"timeZone"`
	PhoneMasked string `json:"phoneMasked,omitempty"`
}

func toUser(u store.User) userJSON {
	out := userJSON{ID: u.ID.String(), DisplayName: u.DisplayName, PersonTint: u.PersonTint, TimeZone: u.TimeZone}
	if u.PhoneE164 != nil {
		out.PhoneMasked = maskPhone(*u.PhoneE164)
	}
	return out
}

// maskPhone keeps the country prefix and the last three digits: +91 98••• ••210.
func maskPhone(p string) string {
	if len(p) < 8 {
		return p
	}
	r := []rune(p)
	for i := 4; i < len(r)-3; i++ {
		r[i] = '•'
	}
	return string(r)
}

type memberJSON struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	PersonTint  string    `json:"personTint"`
	TimeZone    string    `json:"timeZone"`
	JoinedAt    time.Time `json:"joinedAt"`
}

type spaceJSON struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Status      string           `json:"status"`
	ActivatedAt *time.Time       `json:"activatedAt,omitempty"`
	Members     []memberJSON     `json:"members"`
	Invite      *inviteStateJSON `json:"invite,omitempty"`
}

type inviteStateJSON struct {
	State       string    `json:"state"`
	InviteeName string    `json:"inviteeName"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

func toSpace(sp pairing.Space) spaceJSON {
	out := spaceJSON{
		ID: sp.Relationship.ID.String(), Name: sp.Relationship.Name, Status: sp.Relationship.Status,
		ActivatedAt: sp.Relationship.ActivatedAt, Members: []memberJSON{},
	}
	for _, m := range sp.Members {
		out.Members = append(out.Members, memberJSON{ID: m.ID.String(), DisplayName: m.DisplayName, PersonTint: m.PersonTint, TimeZone: m.TimeZone, JoinedAt: m.JoinedAt})
	}
	if sp.Invite != nil {
		out.Invite = &inviteStateJSON{State: sp.Invite.State, InviteeName: sp.Invite.InviteeName, ExpiresAt: sp.Invite.ExpiresAt}
	}
	return out
}

// --- auth ---

func (s *Server) handleStartSignIn(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone string `json:"phone"`
	}
	if !decode(w, r, &in) {
		return
	}
	id, err := s.auth.StartVerification(r.Context(), auth.StartInput{Phone: in.Phone, Purpose: auth.PurposeSignIn, IP: s.clientIP(r)})
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"verificationId": id.String()})
}

func (s *Server) handleVerifySignIn(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VerificationID string `json:"verificationId"`
		Code           string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	id, ok := parseUUID(w, in.VerificationID)
	if !ok {
		return
	}
	si, err := s.auth.VerifySignIn(r.Context(), id, in.Code, s.device(w, r))
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.setSession(w, si.Token, si.Session.ExpiresAt)
	writeJSON(w, http.StatusOK, map[string]any{
		"user": toUser(si.User), "sessionStatus": si.Session.Status, "newUser": si.NewUser,
	})
}

func (s *Server) handleSignOut(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if err := s.auth.SignOut(r.Context(), c.Value); err != nil {
			s.serverError(w, r, err)
			return
		}
	}
	s.clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRecovery(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	if _, err := s.auth.CompleteWithRecoveryCode(r.Context(), session(r).token, in.Code); err != nil {
		if errors.Is(err, auth.ErrTooManyAttempts) {
			s.clearSession(w)
			writeError(w, http.StatusUnauthorized, "too_many_attempts", "Too many tries. Sign in again to start over.")
			return
		}
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"sessionStatus": auth.SessionActive})
}

func (s *Server) handleStartFresh(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	si, err := s.auth.StartFresh(r.Context(), session(r).token, s.device(w, r))
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	s.setSession(w, si.Token, si.Session.ExpiresAt)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUser(si.User), "sessionStatus": si.Session.Status, "newUser": true})
}

// --- me ---

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	uid := session(r).UserID
	u, err := s.auth.User(r.Context(), uid)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	out := map[string]any{"user": toUser(u)}
	notices, err := store.New(s.pool).UnseenNotices(r.Context(), uid)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	list := make([]noticeJSON, 0, len(notices))
	for _, n := range notices {
		list = append(list, noticeJSON{ID: n.ID.String(), Kind: n.Kind, Payload: json.RawMessage(n.Payload), CreatedAt: n.CreatedAt})
	}
	out["notices"] = list
	sp, err := s.pairing.CurrentSpace(r.Context(), uid)
	switch {
	case err == nil:
		out["space"] = toSpace(sp)
	case errors.Is(err, pairing.ErrNotInSpace):
		out["space"] = nil
		avail, err := s.pairing.NewSpaceAvailableAt(r.Context(), uid)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		if !avail.IsZero() {
			out["newSpaceAvailableAt"] = avail
		}
	default:
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName string `json:"displayName"`
		PersonTint  string `json:"personTint"`
		TimeZone    string `json:"timeZone"`
	}
	if !decode(w, r, &in) {
		return
	}
	uid := session(r).UserID
	if in.TimeZone != "" {
		if _, err := time.LoadLocation(in.TimeZone); err != nil || len(in.TimeZone) > 64 {
			writeError(w, http.StatusBadRequest, "invalid_input", "That time zone isn’t recognised.")
			return
		}
		if err := store.New(s.pool).SetTimeZone(r.Context(), store.SetTimeZoneParams{ID: uid, TimeZone: in.TimeZone}); err != nil {
			s.serverError(w, r, err)
			return
		}
	}
	u, err := s.auth.UpdateProfile(r.Context(), uid, in.DisplayName, in.PersonTint)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toUser(u)})
}

func (s *Server) handleRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	codes, err := s.auth.GenerateRecoveryCodes(r.Context(), session(r).UserID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"codes": codes})
}

// handlePhoneStart sends a change-number code to the current number ("current")
// or to the new one ("new", with phone).
func (s *Server) handlePhoneStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Which string `json:"which"`
		Phone string `json:"phone"`
	}
	if !decode(w, r, &in) {
		return
	}
	uid := session(r).UserID
	phone := in.Phone
	switch in.Which {
	case "current":
		u, err := s.auth.User(r.Context(), uid)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		if u.PhoneE164 == nil {
			writeError(w, http.StatusConflict, "no_phone", "This account has no number yet.")
			return
		}
		phone = *u.PhoneE164
	case "new":
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "That request didn’t make sense.")
		return
	}
	id, err := s.auth.StartVerification(r.Context(), auth.StartInput{Phone: phone, Purpose: auth.PurposeChangeNumber, UserID: &uid, IP: s.clientIP(r)})
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"verificationId": id.String()})
}

func (s *Server) handlePhoneApprove(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VerificationID string `json:"verificationId"`
		Code           string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	id, ok := parseUUID(w, in.VerificationID)
	if !ok {
		return
	}
	if err := s.auth.ApproveForUser(r.Context(), session(r).UserID, id, auth.PurposeChangeNumber, in.Code); err != nil {
		s.domainError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleChangeNumber(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentVerificationID string `json:"currentVerificationId"`
		NewVerificationID     string `json:"newVerificationId"`
		Phone                 string `json:"phone"`
	}
	if !decode(w, r, &in) {
		return
	}
	cur, ok := parseUUID(w, in.CurrentVerificationID)
	if !ok {
		return
	}
	nw, ok := parseUUID(w, in.NewVerificationID)
	if !ok {
		return
	}
	u, err := s.auth.ChangeNumber(r.Context(), session(r).UserID, cur, nw, in.Phone)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toUser(u)})
}

type noticeJSON struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
}

func (s *Server) handleNoticeSeen(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	id, ok := parseUUID(w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	now := time.Now()
	if _, err := store.New(s.pool).MarkNoticeSeen(r.Context(), store.MarkNoticeSeenParams{ID: id, UserID: session(r).UserID, SeenAt: &now}); err != nil {
		s.serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- space ---

func (s *Server) handleGetSpace(w http.ResponseWriter, r *http.Request) {
	sp, err := s.pairing.CurrentSpace(r.Context(), session(r).UserID)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"space": toSpace(sp)})
}

func (s *Server) handleCreateSpace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	uid := session(r).UserID
	if _, err := s.pairing.CreateSpace(r.Context(), uid, in.Name); err != nil {
		s.domainError(w, r, err)
		return
	}
	sp, err := s.pairing.CurrentSpace(r.Context(), uid)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"space": toSpace(sp)})
}

func (s *Server) handleCreateInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		InviteeName string `json:"inviteeName"`
	}
	if !decode(w, r, &in) {
		return
	}
	inv, err := s.pairing.CreateInvitation(r.Context(), session(r).UserID, in.InviteeName)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token":     inv.Token,
		"url":       s.cfg.AppOrigin + "/join/" + url.PathEscape(inv.Token),
		"expiresAt": inv.ExpiresAt,
	})
}

func (s *Server) handlePreviewInvitation(w http.ResponseWriter, r *http.Request) {
	p, err := s.pairing.PreviewInvitation(r.Context(), chi.URLParam(r, "token"))
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"inviterName": p.InviterName, "spaceName": p.SpaceName, "expiresAt": p.ExpiresAt})
}

func (s *Server) handleAccept(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	uid := session(r).UserID
	if _, err := s.pairing.Accept(r.Context(), uid, chi.URLParam(r, "token")); err != nil {
		s.domainError(w, r, err)
		return
	}
	sp, err := s.pairing.CurrentSpace(r.Context(), uid)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"space": toSpace(sp)})
}

func (s *Server) handleDecline(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	if err := s.pairing.Decline(r.Context(), session(r).UserID, chi.URLParam(r, "token")); err != nil {
		s.domainError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLeaveStart texts a code to the user's own number to confirm it's them (G2).
func (s *Server) handleLeaveStart(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	uid := session(r).UserID
	u, err := s.auth.User(r.Context(), uid)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if u.PhoneE164 == nil {
		writeError(w, http.StatusConflict, "no_phone", "This account has no number yet.")
		return
	}
	id, err := s.auth.StartVerification(r.Context(), auth.StartInput{Phone: *u.PhoneE164, Purpose: auth.PurposeLeave, UserID: &uid, IP: s.clientIP(r)})
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"verificationId": id.String()})
}

// handleLeave confirms the code and leaves. Never needs the partner's approval.
func (s *Server) handleLeave(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VerificationID string `json:"verificationId"`
		Code           string `json:"code"`
		NotifyTomorrow bool   `json:"notifyTomorrow"`
	}
	if !decode(w, r, &in) {
		return
	}
	id, ok := parseUUID(w, in.VerificationID)
	if !ok {
		return
	}
	uid := session(r).UserID
	u, err := s.auth.User(r.Context(), uid)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if u.PhoneE164 == nil {
		writeError(w, http.StatusConflict, "no_phone", "This account has no number yet.")
		return
	}
	if err := s.auth.ApproveForUser(r.Context(), uid, id, auth.PurposeLeave, in.Code); err != nil {
		s.domainError(w, r, err)
		return
	}
	if err := s.auth.ConsumeApproval(r.Context(), nil, uid, id, auth.PurposeLeave, *u.PhoneE164); err != nil {
		s.domainError(w, r, err)
		return
	}
	// TODO(phase1): queue the partner's "space has closed" notice now or in 24h (in.NotifyTomorrow).
	rel, err := s.pairing.Leave(r.Context(), uid)
	if err != nil {
		s.domainError(w, r, err)
		return
	}
	out := map[string]any{"status": rel.Status, "readOnlyUntil": rel.ReadOnlyUntil}
	if avail, err := s.pairing.NewSpaceAvailableAt(r.Context(), uid); err == nil && !avail.IsZero() {
		out["newSpaceAvailableAt"] = avail
	}
	writeJSON(w, http.StatusOK, out)
}
