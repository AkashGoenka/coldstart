import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListRootsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { IndexContext } from '../index-manager.js';
import { getCurrentVersion } from '../daemon-lock.js';
import {
  handleFind,
  handleGetStructure,
} from './tools.js';

// ---------------------------------------------------------------------------
// Tool definitions — shared between the stdio server and HTTP daemon sessions
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: 'find',
    description:
      'Locate the files relevant to a task. Pass `query` = EVERY salient identifier from the task (symbol names, domain nouns, the rare token you half-remember) — not one distilled keyword. Recall is bounded by the terms you give: a one-token query cannot out-rank lookalikes, so over-supply rather than under-supply. Reach for find BEFORE Read/Grep/Glob.\n\n' +
      'HOW IT WORKS: find greps every term across the repo body AND matches declared names (filenames, path segments, exported symbols), then ranks files by DISTINCT-TERM COVERAGE — the file that covers MORE of your query rises above its lookalikes. This catches body-level matches (nested defs, dynamic refs, string literals) that a declared-name index misses.\n\n' +
      'OUTPUT: a ranked page. Top files get an inline preview — their indexed symbols (with line ranges) plus the body lines where your rare terms CLUSTER (def/class/assignment lines first), so you often answer WITHOUT a follow-up Read. Lower-ranked files list as bare paths. Prose/doc and stylesheet matches are partitioned into secondary lists so they do not crowd out source. Related files (sharing a rare identifier with a top hit, no import edge between them) are surfaced as first-class neighbors.\n\n' +
      'NAMING: case- and separator-insensitive (`LoadStaging` ≡ `load_staging`). It does NOT expand synonyms or plurals for you — that is your job: if the concept could be named two ways, pass both tokens.\n\n' +
      'AFTER THE RESULT:\n' +
      '1. A path + its inline symbols/preview answer the question → done, no Read needed.\n' +
      '2. Path looks right but you need shape/usage → `gs` on it (symbols + imports + per-symbol callers + importers in one shot).\n' +
      '3. "no indexed file contains any of [...]" → those identifiers do not exist in the repo; reformulate or grep for a phrase/regex find cannot index. Do not grep spelling variants of a token find already reported absent.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Space-separated identifiers for the thing you are looking for — pass every salient token from the task, not one keyword. camelCase/snake_case both accepted. More discriminating tokens = sharper ranking.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'gs',
    description:
      'Drill into a known file. Returns these sections as compact text:\n' +
      '- Symbols — top-level + per-class methods (name, kind, line range, extends/implements). With cross-file callers attached per exported symbol (inline if 1 caller; newline-per-caller block if ≥2). For huge files (>20 symbols, no `match`), symbols are reordered by caller count (most-used first) and truncated to top 15.\n' +
      '- Imports — 1-hop internal outbound dependencies (library imports stripped).\n' +
      '- Importers — 1-hop reverse: files in this repo that import this one. With `match`, additionally lists EVERY indexed file (importer or not, any language) whose CONTENT references the matched term even when its filename does not (a registry, admin, or config file using the symbol — or a frontend file referencing a backend name). That subsection IS the complete "who uses <symbol>" answer: it is exhaustive over indexed content, so a subsystem absent from it does NOT use the symbol — do not grep to enumerate or re-verify use-sites, and do not keep hunting in subsystems the section rules out.\n' +
      '- Related — files sharing rare identifier/string-literal tokens with this file (with `match`: with the matched symbols\' code region), shown only when NO import edge connects them. These are name-reference relations the import graph cannot see — Django migrations↔models, config-by-name registration, cross-language (JS↔Python) pairs. Treat them as first-class neighbors: the shared token shown is the reason they are related.\n' +
      'Use this AFTER find surfaces a candidate file. This is the right tool for "who uses this file" / "who calls this symbol" — no separate call needed.\n\n' +
      '`view` controls which sections you get (default `full` = all four). `symbols`, `imports`, `importers`, `callers` each return one section in isolation when you want a byte-light answer.\n\n' +
      'For god-files (large classes, large routers, large config modules), pass `match` to filter symbols/imports/importers/callers to one area — e.g. `match: "auth"` or `match: "/^handle/"`. Substring is case-insensitive; wrap in slashes for regex.\n\n' +
      'Prefer this over Read when you need shape, neighbors, or usage. Reach for Read only for implementation details inside a method body. If you have called gs on 5+ files for one question, you are enumerating — go back to find with a sharper `path` glob or a different concept token instead.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path to the file (e.g. "src/auth/service.ts"). Suffix matches are accepted.',
        },
        match: {
          type: 'string',
          description: 'Filter all sections by name. Substring (case-insensitive) by default; use `|` to OR substrings (`match: "resource|tile"`); wrap in slashes for regex (`match: "/^handle/"`). Use this on large/god-files to avoid a wall of output — e.g. `match: "tile"` on a big models.py reduces output to just tile-related symbols, their callers, and matching imports/importers.',
        },
        view: {
          type: 'string',
          enum: ['full', 'symbols', 'imports', 'importers', 'callers'],
          description: 'Which sections to return. Default "full" = symbols (with inline callers) + imports + importers. Use one of the narrower views to halve or quarter the output when you know what you need: "symbols" (shape only, no callers), "imports" (outbound only), "importers" (inbound only), "callers" (per-symbol cross-file callers in expanded form, no symbol shape).',
        },
        symbol: {
          type: 'string',
          description: 'Deliver the BODY of the named symbol(s) inline, sliced from their indexed line range — so you read a method WITHOUT a Read at a guessed offset. Comma/pipe-separate names (`serialize,restore_state`). A bare name matches the method (`serialize` → `Graph.serialize`). Each body is followed by `callers:`/`calls:` POINTERS (file + line range) so the next hop is one more `gs --symbol` call, not a windowed Read. Use this the moment a file’s symbol list shows the method you need — it replaces the read-at-offset hunt on god-files. If the name is NOT a declared symbol (a runtime/template-injected value, a string key, a config token), it falls back to an in-tool GREP: returns the body lines where the token appears, with context — so you never shell out to grep. Overrides `view`/`match`.',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'kb_search',
    description:
      'Search the repo\'s NOTEBOOK — durable notes past agents wrote after finishing tasks here (file purposes, cross-file flows, traps/lessons, established absences). Try this BEFORE find when the task might have been seen before: a hit can answer outright or point straight at the right files, skipping a search. Pass plain task words (symptoms work: "logout loop after refresh"), symbol names, or file names.\n\n' +
      'Results are inlined in full with a freshness stamp computed against the CURRENT code: [fresh] = the cited file is byte-identical to when the note was verified; [evidence changed: <path>] = that file drifted since — re-verify before relying on it (and correct the note if it proved wrong: `coldstart kb write`). Absence notes ("there is no X") are re-checked live. No hits or an empty notebook → fall through to find, no tax.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Plain task words, symptoms, symbol names, or file names. Same over-supply rule as find: pass every salient token.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'kb_lookup',
    description:
      'Read everything the NOTEBOOK knows at ONE exact address — the file you are about to edit. Address-keyed, not concept-keyed: unlike kb_search (fuzzy, ranked), this filters notes by exact anchor path, so it is exhaustive at that path. Returns the file note\'s facets, every cross-file flow that passes THROUGH this file, and lessons/absences anchored here — each with a live freshness stamp against the current code.\n\n' +
      'Reach for this the moment you have DECIDED on a file and are about to modify it: it surfaces the flow you might break, the absence you are about to violate, the rationale for the code\'s shape. A clean result ("nothing known here") is itself a positive signal — proceed. Anything marked [evidence changed: <path>] drifted since it was verified; re-verify before relying on it, and correct the note with kb_write if it proved wrong. Pass an optional `symbol` to narrow to one top-level symbol at that path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Exact repo-relative path of the file (e.g. "src/auth/service.ts").',
        },
        symbol: {
          type: 'string',
          description: 'Optional top-level symbol name to narrow the lookup to notes anchored at that symbol.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'kb_write',
    description:
      'Save or correct a NOTEBOOK note after finishing real work here — you have the files in context, so no future agent is better placed to record what you learned. Write a file note (what a file is for), a flow note (how a task spans files), or an absence lesson (a confirmed "there is no X"). Also the tool to FIX or RETRACT a note you used that proved wrong (`op: "put"` replaces, `op: "retract"` removes).\n\n' +
      'TWO-PHASE reuse gate: a flow/lesson `spec` sent WITHOUT an `id` first searches the notebook for the same concept. If plausible matches exist, kb_write returns `{status:"candidates", candidates:[...]}` INSTEAD of writing — re-call with `into: "<id>"` to merge into an existing note, or `is_new: true` to declare a genuinely new one. This makes note identity reliable (matching, not guessing an exact title). File notes skip the gate (id derives from the path).\n\n' +
      'The `spec` shape is documented in coldstart.md — briefly: `type` ("file"|"flow"|"lesson", or sugar "file-hub"/"file-single"), `title`, `summary`, `anchors` ([{path, symbols?}] — the addresses the note is about, which drive freshness), plus type-specific fields (file: facets/character; flow: steps; lesson: kind:"absence"/scope/body). Call with NO arguments to get the full spec guide. This tool WRITES to the repo notebook; it never commits to git — publishing notes is a human-only step (`coldstart kb commit`).',
    inputSchema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          description: 'The note spec (JSON object). Fields: type, title, summary, anchors:[{path,symbols?}], and type-specific fields (facets/character for file; steps for flow; kind/scope/body for lesson). See coldstart.md. Omit `id` on a new flow/lesson to trigger the reuse gate.',
        },
        into: {
          type: 'string',
          description: 'Phase-2 answer: merge this write into the existing note with this id (from a prior `candidates` response).',
        },
        is_new: {
          type: 'boolean',
          description: 'Phase-2 answer: declare this a genuinely new concept, bypassing the candidate matches from a prior `candidates` response.',
        },
        session: {
          type: 'string',
          description: 'Optional session id (given in a capture prompt). Enables the flow-evidence check: a flow whose step files this session never actually read gets a warning.',
        },
      },
      required: [],
    },
  },
  {
    name: 'kb_status',
    description:
      'Notebook overview: how many notes exist (by type: file/flow/lesson), how many are flagged stale (their anchored files drifted since verification), and how many are superseded/retracted. Pass `paths` (array of repo-relative paths) to instead list the notes anchored at each of those exact paths with their freshness state — a quick "is anything known here?" check across several files at once.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional repo-relative paths. When given, returns per-path anchored notes + freshness instead of the whole-notebook overview.',
        },
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Shared handler registration — used by stdio server and HTTP daemon sessions
// ---------------------------------------------------------------------------
export interface McpServerOptions {
  /** Custom cache dir (--cache-dir) — kb_search reads the keeper's
   *  kb-notes.json from there; without it, the default cache dir. */
  cacheDir?: string;
}

export function registerToolHandlers(
  server: Server,
  getContext: () => Promise<IndexContext>,
  opts: McpServerOptions = {},
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {}) as Record<string, unknown>;

    let ctx: IndexContext;
    try {
      ctx = await getContext();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Index build failed — restart the MCP server.';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
        isError: true,
      };
    }
    const { index, isRebuilding } = ctx;

    let result: object;

    switch (name) {
      case 'find':
        result = await handleFind(index, {
          query: (params['query'] ?? params['domain_filter']) as string | undefined,
        });
        break;

      case 'gs':
        result = handleGetStructure(index, {
          file_path: (params['file_path'] ?? params['file'] ?? params['file_name']) as string,
          match: params['match'] as string | undefined,
          symbol: params['symbol'] as string | undefined,
          view: params['view'] as 'full' | 'symbols' | 'imports' | 'importers' | 'callers' | undefined,
        });
        break;

      case 'kb_search': {
        const { kbSearch, renderSearchPage } = await import('../kb/search.js');
        const { loadKbNotesIndex } = await import('../kb/notes-index.js');
        const query = String(params['query'] ?? '');
        if (!query.trim()) {
          result = { error: 'kb_search needs a `query`' };
          break;
        }
        const searchResult = await kbSearch(index.rootDir, query, { notesIndex: loadKbNotesIndex(index.rootDir, opts.cacheDir), source: 'tool' });
        result = { __rawText: renderSearchPage(index.rootDir, query, searchResult) };
        break;
      }

      case 'kb_lookup': {
        const { kbLookup, renderLookup } = await import('../kb/lookup.js');
        const path = String(params['path'] ?? params['file_path'] ?? params['file'] ?? '');
        if (!path.trim()) {
          result = { error: 'kb_lookup needs a `path` (exact repo-relative file path)' };
          break;
        }
        const symbol = params['symbol'] ? String(params['symbol']) : undefined;
        const lookup = kbLookup(index.rootDir, path, symbol);
        result = { __rawText: renderLookup(lookup) };
        break;
      }

      case 'kb_write': {
        const { kbWrite } = await import('../kb/write.js');
        const { initSkeleton } = await import('../kb/store.js');
        const { writeGuideMcp, flowEvidenceWarning } = await import('../kb/write-guide.js');
        const spec = params['spec'];
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
          // Parity with `kb write` (no spec): return the full guide, not an error.
          result = { __rawText: writeGuideMcp() };
          break;
        }
        initSkeleton(index.rootDir); // first write creates the notebook
        const wres = await kbWrite(index.rootDir, spec as import('../kb/write.js').WriteSpec, {
          into: params['into'] ? String(params['into']) : undefined,
          isNew: Boolean(params['is_new']),
        });
        if (wres.status === 'error') {
          result = { error: wres.message };
        } else if (wres.status === 'candidates') {
          result = {
            status: 'candidates',
            candidates: wres.candidates,
            message: `${wres.message} Re-call kb_write with the same spec plus \`into: "<id>"\` to merge into one of these, or \`is_new: true\` to create a new note.`,
          };
        } else {
          const warnings = [...(wres.warnings ?? [])];
          // Flow-evidence WARN (never a rejection) — parity with `kb write --session`.
          const flowWarn = flowEvidenceWarning(
            spec as import('../kb/write.js').WriteSpec,
            params['session'] ? String(params['session']) : undefined,
          );
          if (flowWarn) warnings.push(flowWarn);
          result = { status: 'written', op: wres.op, id: wres.id, warnings };
        }
        break;
      }

      case 'kb_status': {
        const { loadAll } = await import('../kb/store.js');
        const { stampAnchors } = await import('../kb/freshness.js');
        const { notes, warnings } = loadAll(index.rootDir);
        const paths = Array.isArray(params['paths'])
          ? (params['paths'] as unknown[]).map((p) => String(p)).filter(Boolean)
          : undefined;
        if (paths?.length) {
          result = {
            paths: paths.map((p) => ({
              path: p,
              notes: notes
                .filter((n) => n.anchors.some((a) => a.path === p))
                .map((n) => ({
                  id: n.id, type: n.type, title: n.title, status: n.status,
                  state: stampAnchors(index.rootDir, n.anchors.filter((a) => a.path === p))[0]?.state ?? 'unverified',
                })),
            })),
          };
        } else {
          const byType = { file: 0, flow: 0, lesson: 0 };
          let flagged = 0, superseded = 0;
          for (const n of notes) {
            byType[n.type]++;
            if (n.status !== 'active') superseded++;
            else if (stampAnchors(index.rootDir, n.anchors).some((s) => s.state === 'changed' || s.state === 'missing')) flagged++;
          }
          result = { total: notes.length, byType, flagged, superseded, warnings: warnings.length };
        }
        break;
      }

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    // _indexStatus deliberately dropped: per-call byte savings on hot path; if
    // the agent needs a stale-snapshot warning it is one query away via GO.
    void isRebuilding;

    const isError = 'error' in result;
    const rawText = (result as { __rawText?: string }).__rawText;
    return {
      content: [{ type: 'text', text: rawText !== undefined ? rawText : JSON.stringify(result, null, 2) }],
      isError,
    };
  });
}

// Server-level guidance, sent ONCE in the initialize result — not per call, so
// this is the right home for setup/lifecycle notes that would otherwise have to
// ride on every tool description (which load into context every session).
// Registry-installed users never run `coldstart init`, so they get the tools with
// no hooks: no automatic capture, no recall. Nothing else tells them.
export const SERVER_INSTRUCTIONS = [
  'coldstart answers "which files are relevant to this task?" from a static index (`find`, `gs`) and keeps a durable NOTEBOOK of notes past agents wrote about this repo (`kb_search`, `kb_lookup`, `kb_write`, `kb_status`). Try `kb_search` before `find` when the task may have been worked on here before.',
  '',
  'SETUP: the hooks that capture notes automatically at the end of a task, and surface matching notes when a prompt arrives, are NOT installed by this MCP server. If the user asks why notes are never captured or recalled, tell them to run `coldstart init` once in the repo root (install: `npm i -g @cstart/coldstart`); it wires those hooks for Claude Code, Cursor, or Codex. Every tool here works without it — only the automatic capture and recall are missing.',
].join('\n');

// ---------------------------------------------------------------------------
// Factory — creates a fully wired MCP server (the stdio reader over the cache)
// ---------------------------------------------------------------------------
export function createMcpServer(getContext: () => Promise<IndexContext>, opts: McpServerOptions = {}): Server {
  const server = new Server(
    { name: 'coldstart', version: getCurrentVersion() },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  registerToolHandlers(server, getContext, opts);
  return server;
}

// ---------------------------------------------------------------------------
// Stdio MCP server — traditional single-process mode (--no-daemon)
// ---------------------------------------------------------------------------
export async function startMCPServer(
  onReady: (clientRoots: string[]) => Promise<void>,
  getContext: () => Promise<IndexContext>,
  opts: McpServerOptions = {},
): Promise<void> {
  const server = createMcpServer(getContext, opts);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // After connect, ask for roots — cap at 1s so standalone runs don't stall
  let clientRoots: string[] = [];
  try {
    const result = await server.request(
      { method: 'roots/list' },
      ListRootsResultSchema,
      { timeout: 1000 },
    );
    if (result && result.roots && result.roots.length > 0) {
      clientRoots = result.roots.map((r: any) => r.uri);
    }
  } catch {
    // Client might not support roots/list, or timed out — proceed with CLI root
  }

  await onReady(clientRoots);
}
