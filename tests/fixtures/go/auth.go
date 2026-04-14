package auth

import (
	"errors"
	"crypto/sha256"
	"fmt"
)

// AuthService handles authentication.
type AuthService struct {
	userRepo     UserRepository
	tokenService TokenService
}

// LoginRequest represents a login attempt.
type LoginRequest struct {
	Email    string
	Password string
}

// AuthResult is returned after successful login.
type AuthResult struct {
	Token  string
	UserID string
}

// Login authenticates a user and returns a token.
func Login(req LoginRequest) (*AuthResult, error) {
	_ = req
	return nil, errors.New("not implemented")
}

// HashPassword hashes a plain-text password.
func HashPassword(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return fmt.Sprintf("%x", sum)
}

// ValidateToken verifies a token.
func ValidateToken(token string) (string, error) {
	_ = token
	return "", nil
}
