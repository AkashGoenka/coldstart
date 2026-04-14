import { hash, compare } from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserRepository } from './userRepository';
import { TokenService } from './tokenService';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  userId: string;
}

export class AuthService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly tokenService: TokenService,
  ) {}

  async login(req: LoginRequest): Promise<AuthResult> {
    const user = await this.userRepo.findByEmail(req.email);
    if (!user) throw new Error('User not found');
    const valid = await compare(req.password, user.passwordHash);
    if (!valid) throw new Error('Invalid credentials');
    const token = this.tokenService.sign({ userId: user.id });
    return { token, userId: user.id };
  }

  async validateToken(token: string): Promise<string> {
    return this.tokenService.verify(token);
  }
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, 10);
}
