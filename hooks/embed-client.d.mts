export function embedderDisabled(): boolean;
export function request(msg: Record<string, unknown>, opts?: { connectMs?: number; budgetMs?: number }): Promise<any | null>;
export function embedTexts(texts: string[], role: string, opts?: { connectMs?: number; budgetMs?: number }): Promise<Float32Array[] | null>;
export function registerRepo(root: string, cacheDir: string): void;
export function ensureEmbedder(opts?: { connectMs?: number }): Promise<'disabled' | 'running' | 'spawning' | 'spawned' | 'error'>;
export function notifyEmbedder(op: string, root: string, cacheDir: string, extra?: Record<string, unknown>): Promise<void>;
export function encodeVec(v: Float32Array): string;
export function decodeVec(s: string): Float32Array;
