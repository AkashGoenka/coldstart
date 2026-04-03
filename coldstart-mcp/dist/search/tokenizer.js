import { STOP_WORDS } from '../constants.js';
/**
 * Split a camelCase or PascalCase identifier into lowercase words.
 * "getUserById" → ["get", "user", "by", "id"]
 * "HTTPSRequest"  → ["https", "request"]
 */
function splitCamelCase(s) {
    // Insert space before uppercase letters that follow lowercase, or before
    // the start of a new CamelCase word within an ALL_CAPS run.
    return s
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .map(w => w.toLowerCase())
        .filter(w => w.length > 0);
}
/**
 * Split a snake_case or kebab-case identifier into words.
 */
function splitSnakeOrKebab(s) {
    return s.split(/[_\-]/).filter(w => w.length > 0).map(w => w.toLowerCase());
}
/**
 * Tokenize a string into a unique set of normalized lowercase terms,
 * with stop-word removal and camelCase/snake_case splitting.
 */
export function tokenize(input) {
    // First split on whitespace and common punctuation
    const rawParts = input.split(/[\s/.,;:!?'"()\[\]{}<>|@#$%^&*+=~`\\]+/);
    const tokens = new Set();
    for (const part of rawParts) {
        if (!part || part.length < 2)
            continue;
        // Try camelCase split
        const camel = splitCamelCase(part);
        const snake = splitSnakeOrKebab(part);
        const all = [part.toLowerCase(), ...camel, ...snake];
        for (const tok of all) {
            const clean = tok.replace(/[^a-z0-9]/g, '');
            if (clean.length >= 2 && !STOP_WORDS.has(clean)) {
                tokens.add(clean);
            }
        }
    }
    return [...tokens];
}
/**
 * Tokenize a user query string into search terms.
 * Same rules as tokenize() but targeted for query input.
 */
export function tokenizeQuery(query) {
    return tokenize(query);
}
//# sourceMappingURL=tokenizer.js.map