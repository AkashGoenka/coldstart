/**
 * Tokenize a string into a unique set of normalized lowercase terms,
 * with stop-word removal and camelCase/snake_case splitting.
 */
export declare function tokenize(input: string): string[];
/**
 * Tokenize a user query string into search terms.
 * Same rules as tokenize() but targeted for query input.
 */
export declare function tokenizeQuery(query: string): string[];
//# sourceMappingURL=tokenizer.d.ts.map