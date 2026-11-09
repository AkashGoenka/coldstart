/**
 * Run one file's synchronous parse under a time limit, so a file that hangs
 * the parser is skipped instead of hanging the whole build.
 *
 * Why this works when nothing else does: a hang here is a synchronous CPU spin
 * (a backtracking regex, a loop in our extractor code, a loop inside the
 * tree-sitter wasm). While it spins the event loop is dead, so a setTimeout or
 * a signal handler can never run. `vm`'s `timeout` is different: Node arms a
 * watchdog on a SEPARATE thread that calls V8's TerminateExecution, which stops
 * JS, regex and wasm alike, and the call throws ERR_SCRIPT_EXECUTION_TIMEOUT.
 * The function passed in is ordinary main-context code; the vm script is only
 * the trampoline that calls it, so no extractor needs to change.
 *
 * It does NOT stop a hang inside Node's own native code (a sync fs call on a
 * dead network mount). None of the hangs seen so far were of that kind;
 * inflight.ts still names those.
 *
 * Cost: one watchdog per call, measured ~40µs. One call per file.
 */
import vm from 'node:vm';

/** A parse normally takes milliseconds; 5s means the file is pathological. */
export const DEFAULT_PARSE_TIMEOUT_MS = 5_000;

/** COLDSTART_PARSE_TIMEOUT_MS overrides the limit (tests use a tiny one). */
export function parseTimeoutMs(): number {
  const v = Number(process.env.COLDSTART_PARSE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PARSE_TIMEOUT_MS;
}

export class ParseTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`parse exceeded ${ms}ms`);
  }
}

const context = vm.createContext({ fn: null as null | (() => unknown), out: undefined as unknown });
const trampoline = new vm.Script('out = fn()');

/** Run `fn` synchronously; throw ParseTimeoutError if it runs past `ms`.
 *  Any other error `fn` throws is rethrown unchanged. */
export function runWithTimeout<T>(fn: () => T, ms: number): T {
  context.fn = fn;
  context.out = undefined;
  try {
    trampoline.runInContext(context, { timeout: ms });
    return context.out as T;
  } catch (err) {
    if ((err as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new ParseTimeoutError(ms);
    throw err;
  } finally {
    context.fn = null;
    context.out = undefined;
  }
}
