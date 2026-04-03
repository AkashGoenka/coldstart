import type { Language, ParsedFile } from '../types.js';
export declare function parseFile(filePath: string, language: Language): Promise<ParsedFile | null>;
export declare function buildFileId(relativePath: string): string;
//# sourceMappingURL=parser.d.ts.map