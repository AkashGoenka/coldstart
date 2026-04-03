import type { CodebaseIndex } from '../types.js';
export declare function getCacheDir(rootDir: string, baseCacheDir?: string): string;
export declare function loadCachedIndex(rootDir: string, baseCacheDir?: string): Promise<CodebaseIndex | null>;
export declare function saveCachedIndex(index: CodebaseIndex, baseCacheDir?: string): Promise<void>;
export declare function isCacheStale(index: CodebaseIndex, currentGitHead: string, baseCacheDir?: string): Promise<boolean>;
//# sourceMappingURL=disk-cache.d.ts.map