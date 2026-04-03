"""Token service."""
import base64
import json
from typing import Optional


class TokenService:
    def __init__(self, secret: str):
        self.secret = secret

    def sign(self, payload: dict) -> str:
        return base64.b64encode(json.dumps(payload).encode()).decode()

    def verify(self, token: str) -> Optional[str]:
        try:
            payload = json.loads(base64.b64decode(token).decode())
            return payload.get('user_id')
        except Exception:
            return None
