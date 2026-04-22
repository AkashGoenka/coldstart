import { AuthService } from '../auth';

export class AdminDashboard {
  private auth = new AuthService();

  async render(): Promise<string> {
    return 'dashboard';
  }
}
