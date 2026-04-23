import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Language, ParsedFile } from '../types.js';
import { parseTsContent } from './ts-parser.js';
import { parseJavaContent } from './extractors/java.js';
import { parseRubyContent } from './extractors/ruby.js';
import { parsePythonContent } from './extractors/python.js';
import { parseGoContent } from './extractors/go.js';
import { parseRustContent } from './extractors/rust.js';
import { parseCSharpContent } from './extractors/csharp.js';
import { parsePhpContent } from './extractors/php.js';
import { parseKotlinContent } from './extractors/kotlin.js';

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

  // -------------------------------------------------------------------------
  // Python: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'python') {
    let pythonResult;
    try {
      pythonResult = parsePythonContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      pythonResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: pythonResult.imports,
      exports: pythonResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: pythonResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Go: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'go') {
    let goResult;
    try {
      goResult = parseGoContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      goResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: goResult.imports,
      exports: goResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: goResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Rust: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'rust') {
    let rustResult;
    try {
      rustResult = parseRustContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      rustResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: rustResult.imports,
      exports: rustResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: rustResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // C#: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'csharp') {
    let csharpResult;
    try {
      csharpResult = parseCSharpContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      csharpResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: csharpResult.imports,
      exports: csharpResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: csharpResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // PHP: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'php') {
    let phpResult;
    try {
      phpResult = parsePhpContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      phpResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: phpResult.imports,
      exports: phpResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: phpResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Kotlin: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'kotlin') {
    let kotlinResult;
    try {
      kotlinResult = parseKotlinContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      kotlinResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: kotlinResult.imports,
      exports: kotlinResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: kotlinResult.symbols,
    };
  }

  // Unsupported language (cpp, swift, dart)
  return {
    imports: [],
    exports: [],
    hasDefaultExport: false,
    hash,
    lineCount,
    tokenEstimate,
    symbols: [],
  };
}

export function buildFileId(relativePath: string): string {
  // Normalise to forward slashes for cross-platform stability
  return relativePath.replace(/\\/g, '/');
}
