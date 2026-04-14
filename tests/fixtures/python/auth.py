"""Authentication module."""
from hashlib import sha256
from typing import Optional
from .user_repository import UserRepository
from .token_service import TokenService

__all__ = ['AuthService', 'hash_password', 'verify_password']


class AuthService:
    def __init__(self, user_repo: UserRepository, token_service: TokenService):
        self.user_repo = user_repo
        self.token_service = token_service

    def login(self, email: str, password: str) -> dict:
        user = self.user_repo.find_by_email(email)
        if not user:
            raise ValueError("User not found")
        if not verify_password(password, user['password_hash']):
            raise ValueError("Invalid credentials")
        token = self.token_service.sign({'user_id': user['id']})
        return {'token': token, 'user_id': user['id']}

    def validate_token(self, token: str) -> Optional[str]:
        return self.token_service.verify(token)


def hash_password(plain: str) -> str:
    return sha256(plain.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    return hash_password(plain) == hashed


def _internal_helper():
    pass
