import { db } from './db';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    return db.query('SELECT * FROM users WHERE email = $1', [email]);
  }

  async findById(id: string): Promise<User | null> {
    return db.query('SELECT * FROM users WHERE id = $1', [id]);
  }

  async create(email: string, passwordHash: string): Promise<User> {
    return db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
      [email, passwordHash],
    );
  }
}

export default UserRepository;
