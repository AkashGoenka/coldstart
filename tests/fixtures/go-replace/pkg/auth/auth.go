package auth

import "example.com/shared"

func Login(email string) bool {
	_ = shared.Hash(email)
	return true
}
