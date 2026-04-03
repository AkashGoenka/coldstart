import type { WalkedFile } from '../types.js';
export interface WalkOptions {
    rootDir: string;
    excludes?: string[];
    includes?: string[];
    maxFileSizeBytes?: number;
}
export declare function walkDirectory(options: WalkOptions): Promise<WalkedFile[]>;
//# sourceMappingURL=walker.d.ts.map