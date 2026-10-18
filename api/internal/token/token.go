// Package token makes opaque bearer tokens. Only the SHA-256 hash is ever stored.
package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// New returns a URL-safe random token and its hash.
func New() (plain string, hash []byte) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("token: crypto/rand failed: " + err.Error())
	}
	plain = base64.RawURLEncoding.EncodeToString(b)
	return plain, Hash(plain)
}

// Hash is the stored form of a token.
func Hash(plain string) []byte {
	h := sha256.Sum256([]byte(plain))
	return h[:]
}
