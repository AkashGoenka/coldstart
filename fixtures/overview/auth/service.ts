import * as bcrypt from 'bcrypt';

export interface AuthResult {
  token: string;
  userId: string;
}

export class AuthService {
  async validate(token: string): Promise<boolean> {
    return token.length > 0;
  }
}

export async function loginUser(username: string, password: string): Promise<AuthResult> {
  const hash = await bcrypt.hash(password, 10);
  return { token: hash, userId: username };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
