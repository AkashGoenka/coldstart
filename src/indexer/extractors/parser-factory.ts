/**
 * Lazily-constructed, memoised tree-sitter parser, shared by the language
 * extractors. Every extractor previously hand-rolled the same singleton:
 *
 *   const ParserCtor = require('tree-sitter') as { new(): any };
 *   let xParser: any = null;
 *   function getParser() { if (!xParser) { xParser = new ParserCtor(); xParser.setLanguage(g); } return xParser; }
 *
 * The only thing that varied was the grammar. Each extractor still resolves its
 * own grammar (the package export shape differs per grammar), then calls
 * `makeParser(grammar)` once at module scope and gets back a `getParser()` that
 * builds the parser on first use and caches it for the process lifetime.
 */
import ParserModule from 'tree-sitter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = ParserModule as { new(): any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParser = any;

export function makeParser(grammar: unknown): () => AnyParser {
  let parser: AnyParser = null;
  return () => {
    if (!parser) {
      parser = new ParserCtor();
      parser.setLanguage(grammar);
    }
    return parser;
  };
}
