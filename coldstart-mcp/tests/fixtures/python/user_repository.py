"""User repository."""
import sqlite3
from typing import Optional


class UserRepository:
    def __init__(self, db_path: str):
        self.conn = sqlite3.connect(db_path)

    def find_by_email(self, email: str) -> Optional[dict]:
        cursor = self.conn.execute('SELECT * FROM users WHERE email = ?', (email,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def create(self, email: str, password_hash: str) -> dict:
        cursor = self.conn.execute(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            (email, password_hash),
        )
        self.conn.commit()
        return {'id': cursor.lastrowid, 'email': email}
