import { AuthService } from '../auth';

export class NodePolicyHelper {
  private auth = new AuthService();

  async canAccess(token: string): Promise<boolean> {
    return this.auth.validate(token);
  }
}
