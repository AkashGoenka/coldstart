import type { Language, LanguageConfig } from './types.js';
export declare const EXTENSION_TO_LANGUAGE: Record<string, Language>;
export declare const LANGUAGE_CONFIGS: Record<Language, LanguageConfig>;
export declare const DOMAIN_KEYWORDS: Record<string, string[]>;
export declare const STOP_WORDS: Set<string>;
export declare const DEFAULT_EXCLUDES: Set<string>;
export declare const ENTRY_POINT_NAMES: Set<string>;
export declare const ARCH_ROLE_PATTERNS: Array<{
    pattern: RegExp;
    role: string;
}>;
export declare const CACHE_VERSION = "2.0.0";
//# sourceMappingURL=constants.d.ts.map