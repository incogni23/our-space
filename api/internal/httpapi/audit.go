package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"betweenus/api/internal/store"
)

// audit records a sensitive account action. Best-effort: never blocks the request.
// Only who, what, when and from where; never content.
func (s *Server) audit(r *http.Request, user uuid.UUID, space *uuid.UUID, action string, detail map[string]any) {
	b, _ := json.Marshal(detail)
	if detail == nil {
		b = []byte("{}")
	}
	var u *uuid.UUID
	if user != uuid.Nil {
		u = &user
	}
	if err := store.New(s.pool).AddAuditEvent(r.Context(), store.AddAuditEventParams{
		UserID: u, RelationshipID: space, Action: action, Ip: s.clientIP(r), Detail: b,
	}); err != nil {
		s.log.Warn("audit write failed", "action", action, "err", err)
	}
}
