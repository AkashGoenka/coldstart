import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { Language, ParsedFile } from '../types.js';
import { parseTsContent } from './ts-parser.js';
import { parseJavaContent } from './extractors/java.js';
import { parseRubyContent } from './extractors/ruby.js';
import { parsePythonContent } from './extractors/python.js';
import { parseGoContent } from './extractors/go.js';
import { parseRustContent } from './extractors/rust.js';
import { findRustWorkspace } from './rust-workspace.js';
import { parseCSharpContent } from './extractors/csharp.js';
import { parsePhpContent } from './extractors/php.js';
import { parseKotlinContent } from './extractors/kotlin.js';
import { parseCppContent } from './extractors/cpp.js';
import { extractAngularJsSymbols } from './extractors/angularjs.js';
import { parseGraphQLContent } from './extractors/graphql.js';
import { parseYamlContent } from './extractors/yaml.js';
import { parseTomlContent } from './extractors/toml.js';
import { parseEnvContent } from './extractors/env.js';
import { parseXmlContent } from './extractors/xml.js';
import { parseGroovyContent } from './extractors/groovy.js';

const MAX_FILE_SIZE = 1_000_000; // 1 MB

/**
 * Extract all <script> block bodies from a Vue or Svelte SFC and return them
 * concatenated. Handles both <script> and <script setup>, with any lang attr.
 * Returns null if no script block is found.
 */
function extractSfcScripts(content: string): string | null {
  const blocks: string[] = [];
  const re = /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const inner = m[0]
      .replace(/<script(?:\s[^>]*)?>/i, '')
      .replace(/<\/script>/i, '');
    blocks.push(inner);
  }
  return blocks.length > 0 ? blocks.join('\n') : null;
}

/**
 * Extract TypeScript frontmatter from an Astro file (content between --- fences).
 * Returns null if no frontmatter is present.
 */
function extractAstroFrontmatter(content: string): string | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

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

    // AngularJS 1.x: merge registered names + this./\$scope. methods as pseudo-exports
    if (language === 'javascript') {
      const ngSymbols = extractAngularJsSymbols(content);
      if (ngSymbols.length > 0) {
        tsResult = { ...tsResult, exports: [...tsResult.exports, ...ngSymbols] };
      }
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
      constantReferences: rubyResult.constantReferences,
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
      djangoConventionRefs: pythonResult.djangoConventionRefs,
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

    // Filter `use crate_name::…` specifiers to only those whose leading
    // segment matches a workspace member crate. External crates (third-party
    // deps like `bytes`, `criterion`) are out of scope — including them in
    // imports[] would just inflate unresolved counts without yielding edges.
    const ws = await findRustWorkspace(dirname(filePath));
    const workspaceCrates = ws?.crates;
    const filteredImports = workspaceCrates
      ? rustResult.imports.filter(spec => {
          if (!spec.includes('::')) return true; // mod / extern crate / bare use
          return workspaceCrates.has(spec.split('::')[0]);
        })
      : rustResult.imports.filter(spec => !spec.includes('::'));

    return {
      imports: filteredImports,
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
      partialDeclarations: csharpResult.partialDeclarations,
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
      eloquentRelations: phpResult.eloquentRelations,
      containerResolutions: phpResult.containerResolutions,
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

  // -------------------------------------------------------------------------
  // C++: use Tree-sitter for symbol-level extraction
  // -------------------------------------------------------------------------
  if (language === 'cpp') {
    let cppResult;
    try {
      cppResult = parseCppContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      cppResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: cppResult.imports,
      exports: cppResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: cppResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Vue / Svelte: extract <script> blocks and parse as TS/JS
  // -------------------------------------------------------------------------
  if (language === 'vue' || language === 'svelte') {
    const scriptContent = extractSfcScripts(content);
    if (!scriptContent) {
      return { imports: [], exports: [], hasDefaultExport: false, hash, lineCount, tokenEstimate, symbols: [] };
    }
    let tsResult;
    try {
      tsResult = parseTsContent(scriptContent, fileId || filePath, false);
    } catch (err) {
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
  // Astro: extract frontmatter (--- fences) and parse as TS
  // -------------------------------------------------------------------------
  if (language === 'astro') {
    const frontmatter = extractAstroFrontmatter(content);
    if (!frontmatter) {
      return { imports: [], exports: [], hasDefaultExport: false, hash, lineCount, tokenEstimate, symbols: [] };
    }
    let tsResult;
    try {
      tsResult = parseTsContent(frontmatter, fileId || filePath, false);
    } catch (err) {
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
  // GraphQL: regex-based extractor (operations, fragments, type-system defs)
  // -------------------------------------------------------------------------
  if (language === 'graphql') {
    const gqlResult = parseGraphQLContent(content, fileId || filePath);
    return {
      imports: gqlResult.imports,
      exports: gqlResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: gqlResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // YAML: tree-sitter extractor (top-level and one-level-nested keys)
  // -------------------------------------------------------------------------
  if (language === 'yaml') {
    const yamlResult = parseYamlContent(content, fileId || filePath);
    return {
      imports: yamlResult.imports,
      exports: yamlResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: yamlResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // TOML: tree-sitter extractor (sections, keys, array-of-tables)
  // -------------------------------------------------------------------------
  if (language === 'toml') {
    const tomlResult = parseTomlContent(content, fileId || filePath);
    return {
      imports: tomlResult.imports,
      exports: tomlResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: tomlResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // .env: regex-based extractor (variable names)
  // -------------------------------------------------------------------------
  if (language === 'env') {
    const envResult = parseEnvContent(content, fileId || filePath);
    return {
      imports: envResult.imports,
      exports: envResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: envResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // XML: tree-sitter-based extractor (attributes, element text)
  // -------------------------------------------------------------------------
  if (language === 'xml') {
    let xmlResult;
    try {
      xmlResult = parseXmlContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      xmlResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: xmlResult.imports,
      exports: xmlResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: xmlResult.symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Groovy: tree-sitter-based extractor (Gradle DSL, Jenkinsfile DSL)
  // -------------------------------------------------------------------------
  if (language === 'groovy') {
    let groovyResult;
    try {
      groovyResult = parseGroovyContent(content, fileId || filePath);
    } catch (err) {
      console.error(`[parser] Tree-sitter error in ${fileId || filePath}: ${err}`);
      groovyResult = { imports: [], exports: [], hasDefaultExport: false as const, symbols: [] };
    }

    return {
      imports: groovyResult.imports,
      exports: groovyResult.exports,
      hasDefaultExport: false,
      hash,
      lineCount,
      tokenEstimate,
      symbols: groovyResult.symbols,
    };
  }

  // Token-only fallback: template formats (erb, haml, slim), static assets
  // (html, css, json, markdown), and unsupported languages. No AST parsing —
  // the file is still indexed so its path/filename tokens feed domainMap.
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
