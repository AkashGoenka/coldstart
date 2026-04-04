export const db = {
  async query<T>(sql: string, params?: unknown[]): Promise<T> {
    // Stub
    void sql; void params;
    return {} as T;
  },
};

export default db;
