import { hashPassword } from './auth';

// Calls hashPassword directly by name — used to test cross-file call resolution.
export async function changePassword(plain: string): Promise<string> {
  return hashPassword(plain);
}
