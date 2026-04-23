import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Language, ParsedFile } from '../types.js';
import { parseTsContent } from './ts-parser.js';
import { parseJavaContent } from './extractors/java.js';
import { parseRubyContent } from './extractors/ruby.js';

const MAX_FILE_SIZE = 1_000_000; // 1 MB

export async function parseFile(
  filePath: string,
  language: Language,
  fileId = '',
): Promise<ParsedFile | null> {
  let content: string;
  try {
    const buf = await readFile(filePath);
    if (buf.length > MAX_FILE_SIZE) return null;
    content = buf.toString('utf-8');
  } catch {
    return null;
  }

  const hash = createHash('md5').update(content).digest('hex');
  const lineCount = content.split('\n').length;
  const tokenEstimate = Math.ceil(content.length / 4);

  // -------------------------------------------------------------------------
  // TS/JS: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'typescript' || language === 'javascript') {
    const isTsx = filePath.endsWith('.tsx');
    let tsResult;
    try {
      tsResult = parseTsContent(content, fileId || filePath, isTsx);
    } catch (err) {
      // Tree-sitter parse error — skip symbol extraction but continue with imports/exports
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      tsResult = { imports: [], exports: [], hasDefaultExport: false, symbols: [], reexportRatio: 0 };
    }

    return {
      imports: tsResult.imports,
      exports: tsResult.exports,
      hasDefaultExport: tsResult.hasDefaultExport,
      hash,
      lineCount,
      tokenEstimate,
      symbols: tsResult.symbols,
      reexportRatio: tsResult.reexportRatio,
    };
  }

  // -------------------------------------------------------------------------
  // Java: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'java') {
    let javaResult;
    try {
      javaResult = parseJavaContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      javaResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [], packageName: '' };
    }

    return {
      imports: javaResult.imports,
      exports: javaResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: javaResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Ruby: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'ruby') {
    let rubyResult;
    try {
      rubyResult = parseRubyContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      rubyResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: rubyResult.imports,
      exports: rubyResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: rubyResult.symbols,
    };
  }

  // Unsupported language
  throw new Error(`Unsupported language: ${language}. Currently only TS/JS, Java, and Ruby are supported.`);
}

export function buildFileId(relativePath: string): string {
  // Normalise to forward slashes for cross-platform stability
  return relativePath.replace(/\\/g, '/');
}
