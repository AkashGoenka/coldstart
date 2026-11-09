/**
 * Where the find-nudge / preguard / recall hooks keep their shared per-session
 * state. It must be os.tmpdir(), not a literal "/tmp": on Windows "/tmp" means
 * C:\tmp, which does not exist on a fresh machine, and every write there failed
 * silently (the hooks never fail on a state write) — so the nudges never
 * remembered a find and the spiral detector could not fire at all.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findNudgeStatePath(key) {
  return join(tmpdir(), `find_nudge_${key}.json`);
}
