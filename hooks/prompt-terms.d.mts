/** Types for prompt-terms.mjs — the prompt reducer (user-typed prompt → find terms). */
export interface ReducedPrompt {
  /** ids first, then nouns — the list `find` is queried with. */
  terms: string[];
  /** identifiers (exact spelling) + quoted UI labels as CamelCase, deduped case-insensitively. */
  ids: string[];
  /** NOUN/PROPN words (len ≥ 3) outside identifier spans, deduped vs ids. */
  nouns: string[];
  /** true when fewer than 2 terms survive: no find, no injection. */
  skip: boolean;
}
export declare function reducePrompt(text: string): ReducedPrompt;
/** Load the POS model now; returns load ms (cached after the first load). */
export declare function loadPromptModel(): number;
/** Model-load ms, or null before the first load. */
export declare function promptModelLoadMs(): number | null;
export declare const isProseCompound: (w: string) => boolean;
export declare const isAbbrev: (w: string) => boolean;
export declare const isId: (w: string) => boolean;
