export const STORE_VERSION: number;
export function vectorKey(k: { recipeVersion: string; modelId: string; dtype: string; role: string; text: string }): string;
export function openReader(dir: string, opts: { recipe: string; dim?: number }): {
  get(keys: string[]): Map<string, Float32Array>;
  [k: string]: unknown;
};
export function openWriter(dir: string, opts: { recipe: string; dim?: number }): any;
