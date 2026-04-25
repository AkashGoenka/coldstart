import { AuthService } from '../auth';

export class RoleAccessHelper {
  private auth = new AuthService();

  async canAccess(token: string): Promise<boolean> {
    return this.auth.validate(token);
  }
}
