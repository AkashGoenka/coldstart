export class TokenService {
  constructor(private readonly secret: string) {}

  sign(payload: Record<string, unknown>): string {
    // Simplified — real implementation uses jsonwebtoken
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  verify(token: string): string {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    return payload.userId as string;
  }
}

export const defaultTokenService = new TokenService(process.env['JWT_SECRET'] ?? 'dev');
