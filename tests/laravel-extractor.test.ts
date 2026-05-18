import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDirectory } from '../src/indexer/walker.js';
import { parseFile, buildFileId } from '../src/indexer/parser.js';
import { resolveImports } from '../src/indexer/resolvers/index.js';
import { buildGraph } from '../src/indexer/graph.js';
import { addLaravelSyntheticEdges } from '../src/indexer/laravel-synthetic.js';
import { buildFileDomains, isTestPath } from '../src/indexer/tokenize.js';
import type { CodebaseIndex, IndexedFile } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Test Index Builder
// ============================================================================
async function buildLaravelTestIndex(rootDir: string): Promise<CodebaseIndex> {
  const walkedFiles = await walkDirectory({ rootDir, excludes: [], includes: [] });
  const indexedFiles: IndexedFile[] = [];

  await Promise.all(
    walkedFiles.map(async (wf) => {
      try {
        const id = buildFileId(wf.relativePath);
        const parsed = await parseFile(wf.absolutePath, wf.language, id);
        if (!parsed) return;

        const file: IndexedFile = {
          id,
          path: wf.absolutePath,
          relativePath: wf.relativePath,
          language: wf.language,
          domainMap: buildFileDomains(wf.relativePath, parsed.exports),
          exports: parsed.exports,
          hasDefaultExport: parsed.hasDefaultExport,
          imports: parsed.imports,
          hash: parsed.hash,
          lineCount: parsed.lineCount,
          tokenEstimate: parsed.tokenEstimate,
          importedByCount: 0,
          transitiveImportedByCount: 0,
          isBarrel: false,
          isTestFile: isTestPath(wf.relativePath),
          symbols: parsed.symbols,
          eloquentRelations: parsed.eloquentRelations,
          containerResolutions: parsed.containerResolutions,
        };
        indexedFiles.push(file);
      } catch {
        // skip
      }
    }),
  );

  const { edges } = await resolveImports(indexedFiles, rootDir);
  const fullFileIdSet = new Set(indexedFiles.map(f => f.id));
  await addLaravelSyntheticEdges(indexedFiles, edges, fullFileIdSet, rootDir);
  const nodeIds = indexedFiles.map(f => f.id);
  const { outEdges, inEdges } = buildGraph(nodeIds, edges);

  for (const file of indexedFiles) {
    file.importedByCount = inEdges.get(file.id)?.length ?? 0;
  }

  const filesMap = new Map<string, IndexedFile>(indexedFiles.map(f => [f.id, f]));
  return {
    rootDir,
    files: filesMap,
    edges,
    outEdges,
    inEdges,
  };
}

// ============================================================================
// Laravel Mini Fixture Tests
// ============================================================================
describe('Laravel extractor — eloquent relationships', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/laravel-mini');

  beforeAll(async () => {
    index = await buildLaravelTestIndex(FIXTURE_ROOT);
  });

  it('user.php imports post.php via hasMany(Post::class)', async () => {
    const userId = 'app/Models/User.php';
    const outgoing = index.outEdges.get(userId) ?? [];
    const postId = 'app/Models/Post.php';
    expect(outgoing).toContain(postId);
  });

  it('user.php imports comment.php via hasMany(Comment::class)', async () => {
    const userId = 'app/Models/User.php';
    const outgoing = index.outEdges.get(userId) ?? [];
    const commentId = 'app/Models/Comment.php';
    expect(outgoing).toContain(commentId);
  });

  it('post.php imports user.php via belongsTo(User::class)', async () => {
    const postId = 'app/Models/Post.php';
    const outgoing = index.outEdges.get(postId) ?? [];
    const userId = 'app/Models/User.php';
    expect(outgoing).toContain(userId);
  });

  it('post.php imports comment.php via hasMany(Comment::class)', async () => {
    const postId = 'app/Models/Post.php';
    const outgoing = index.outEdges.get(postId) ?? [];
    const commentId = 'app/Models/Comment.php';
    expect(outgoing).toContain(commentId);
  });

  it('comment.php imports post.php via belongsTo(Post::class)', async () => {
    const commentId = 'app/Models/Comment.php';
    const outgoing = index.outEdges.get(commentId) ?? [];
    const postId = 'app/Models/Post.php';
    expect(outgoing).toContain(postId);
  });

  it('comment.php imports user.php via belongsTo(User::class)', async () => {
    const commentId = 'app/Models/Comment.php';
    const outgoing = index.outEdges.get(commentId) ?? [];
    const userId = 'app/Models/User.php';
    expect(outgoing).toContain(userId);
  });
});

describe('Laravel extractor — container resolutions', () => {
  let index: CodebaseIndex;
  const FIXTURE_ROOT = join(__dirname, 'fixtures/laravel-mini');

  beforeAll(async () => {
    index = await buildLaravelTestIndex(FIXTURE_ROOT);
  });

  it('UserService.php imports User.php via app(User::class)', async () => {
    const serviceId = 'app/Services/UserService.php';
    const outgoing = index.outEdges.get(serviceId) ?? [];
    const userId = 'app/Models/User.php';
    expect(outgoing).toContain(userId);
  });

  it('UserService.php imports User.php via resolve(User::class)', async () => {
    const serviceId = 'app/Services/UserService.php';
    const outgoing = index.outEdges.get(serviceId) ?? [];
    const userId = 'app/Models/User.php';
    expect(outgoing).toContain(userId);
  });

  it('UserService.php imports User.php via bind(User::class)', async () => {
    const serviceId = 'app/Services/UserService.php';
    const outgoing = index.outEdges.get(serviceId) ?? [];
    const userId = 'app/Models/User.php';
    expect(outgoing).toContain(userId);
  });
});
