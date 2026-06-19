/**
 * nudge-handler.mjs — PostToolUse nudge for the `coldstart find` CLI.
 *
 * Fires advisory nudges (additionalContext) at the moments the agent's search
 * behaviour goes wrong. Detectors, each fires sparingly:
 *
 *   1. READ-AFTER-2-FINDS  — ran `coldstart find` twice with no Read/gs in between
 *                            => stop searching, open a candidate.
 *   2. EMPTY-SEARCH        — a grep/glob/shell-find returned nothing
 *                            => empty != absent; refine find or read what you have.
 *   3. NONFIND-SHELL-3     — 3 non-find search/shell calls since last find/Read/gs
 *                            => the spiral; go back to find or read.
 *   3b. NO-NEW-EVIDENCE    — a grep/find CONFINED to files already in context
 *                            => re-checks surfaced data, can't reveal a new file.
 *                            Recall-safe: any call surfacing a new file is silent.
 *   4. CHECKPOINT          — every CHECKPOINT_EVERY tool calls
 *                            => can you answer from what you've read? name the gap.
 *   5. GS-OVER-SLICE       — sliced the SAME file with `gs` >= GS_SLICE_CAP times
 *                            => you have its bodies + pointers; answer or move on.
 *   6. GS-REGUESS          — re-called `gs --symbol` on a file that just returned
 *                            the method-menu fallback => pick from the menu.
 *
 * Also REGISTERS the canonical key of every SUCCESSFUL (non-empty) find into
 * `seen_find_queries` — the PreToolUse guard (find-preguard) denies a re-run of
 * a registered key. The key fn is shared (canonical-find-key.mjs); it MUST match
 * the guard exactly or the deny-key and registration-key drift.
 *
 * State per (session,agent) in /tmp. Fail-open: any error → null (runHook swallows).
 *
 * Ported 1:1 from find-nudge.py. Thresholds below are the same defaults.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { canonicalFindKey } from "./canonical-find-key.mjs";

// ---- detector thresholds (tune freely) ----
const FINDS_BEFORE_READ = 2; // (1) nudge to read after this many finds w/o a Read/gs
const NONFIND_SHELL_STREAK = 3; // (3) nudge after this many non-find search/shell calls
const CHECKPOINT_EVERY = 12; // (4) checkpoint nudge cadence, in tool calls
const GS_SLICE_CAP = 3; // (5) nudge once gs has sliced the SAME file this many times
const EMPTY_NUDGE_CAP = 3; // (2) max empty-search nudges per session
const REDUNDANT_CAP = 6; // (3b) max no-new-evidence nudges per session

// coldstart find (the GOOD locator)
const FIND_RE = /coldstart\s+find\b|index\.js\s+find\b/;
// coldstart gs (the GOOD reader — slices symbol bodies): read-equivalent for the
// spiral, but with its own abuse modes (over-slice, re-guess after a menu fallback).
const GS_RE = /coldstart\s+gs\b|index\.js\s+gs\b/;
// the gs menu-fallback marker (printed when --symbol isn't a declared symbol)
const GS_FALLBACK_RE = /NOT a declared symbol here|no declared symbol matches/;
// search/shell that ISN'T coldstart find/gs — the spiral surface
const SEARCH_RE =
  /(^|[;&|]|\s)(grep|egrep|fgrep|rg)\b|git\s+grep|git\s+log|(^|[;&|]|\s)find\s|(^|[;&|]|\s)ls\b|(^|[;&|]|\s)cat\b/;
const GS_FILE_RE = /(?:coldstart|index\.js)\s+gs\s+(\S+)/;

// Evidence store regexes — paths printed in ANY output, and files named as ARGS.
const PATH_RE = /[\w./-]+\.(?:py|js|jsx|ts|tsx|htm|html|vue|json|scss|css|rb|java)/g;
const FILE_ARG_RE =
  /(?<![\w/])([\w][\w./-]*\.(?:py|js|jsx|ts|tsx|htm|html|vue|json|scss|css|rb|java))\b/g;

/** Mirror of find-nudge.py result_text: extract the raw text payload of a tool
 * response, collapsing a present-but-empty stdout to "" (NOT to the JSON of the
 * whole envelope, which would hide emptiness). */
function resultText(input) {
  let r = input.tool_response;
  if (r === undefined) r = input.tool_output;
  if (r === undefined || r === null) return null;
  if (typeof r === "string") return r;
  if (Array.isArray(r)) {
    return r
      .map((x) => (x && typeof x === "object" ? x.text || "" : String(x)))
      .join(" ");
  }
  if (typeof r === "object") {
    const KEYS = ["stdout", "stderr", "content", "output", "result"];
    if (KEYS.some((k) => k in r)) {
      return KEYS.map((k) => String(r[k] ?? "")).join("");
    }
    return JSON.stringify(r);
  }
  return String(r);
}

function matchAllGroup(re, s, group) {
  const found = new Set();
  if (!s) return found;
  for (const m of s.matchAll(re)) found.add(group ? m[group] : m[0]);
  return found;
}

/**
 * @param {any} input parsed PostToolUse stdin payload
 * @returns {object|null} an additionalContext envelope, or null for no nudge
 */
export default function handle(input) {
  const sid = input.session_id || "default";
  const aid = input.agent_id || ""; // set when inside a subagent
  const tool = input.tool_name || "";
  const tin = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const cmd = typeof tin.command === "string" ? tin.command : "";
  const out = resultText(input);

  const key = aid ? `${sid}_${aid}` : sid;
  const stateFile = `/tmp/find_nudge_${key}.json`;
  const st = {
    seen_find: false,
    total: 0,
    finds_since_read: 0,
    nonfind_streak: 0,
    empty_fired: 0,
    last_checkpoint: 0,
    read_fired: false,
    shell_fired: false,
    gs_counts: {},
    gs_slice_fired: [],
    last_gs_fallback: "",
    gs_reguess_fired: false,
    held_files: [],
    redundant_fired: 0,
    seen_find_queries: [],
  };
  try {
    Object.assign(st, JSON.parse(readFileSync(stateFile, "utf8")));
  } catch {
    /* defaults */
  }

  // classify this call
  const isFind = tool === "Bash" && FIND_RE.test(cmd);
  const isGs = tool === "Bash" && GS_RE.test(cmd);
  let gsFile = "";
  if (isGs) {
    const gm = GS_FILE_RE.exec(cmd);
    gsFile = gm ? gm[1] : "";
  }
  const prevFallback = st.last_gs_fallback || ""; // set by the PREVIOUS gs call's output
  const isRead = tool === "Read";
  // gs/find are tools, not the grep-spiral, even when piped to head/grep
  const isSearch =
    tool === "Grep" ||
    tool === "Glob" ||
    (tool === "Bash" && !isFind && !isGs && SEARCH_RE.test(cmd));
  const isNonfindShell = isSearch;

  const _ob = out !== null && out !== undefined ? out.trim().toLowerCase() : null;
  const outEmpty =
    _ob !== null &&
    (_ob === "" ||
      _ob.includes("completed with no output") ||
      _ob === "no matches found" ||
      _ob === "no files found");

  st.total += 1;
  const msgs = []; // [priority, text]; lower priority number = more urgent, wins

  // --- evidence: what files THIS call touched, and which are genuinely NEW ---
  const held = new Set(st.held_files || []);
  const outFiles = matchAllGroup(PATH_RE, out, 0);
  const cmdFiles = matchAllGroup(FILE_ARG_RE, cmd, 1);
  if (isRead) {
    const rp = typeof tin.file_path === "string" ? tin.file_path : "";
    if (rp) cmdFiles.add(rp);
  }
  const scope = new Set([...outFiles, ...cmdFiles]);
  const novel = [...scope].filter((f) => !held.has(f)); // files newly in context

  if (isFind) {
    st.seen_find = true;
    st.finds_since_read += 1;
    st.nonfind_streak = 0;
    st.shell_fired = false;
    // register the canonical key ONLY on a successful (non-empty) result, so the
    // PreToolUse guard never blocks a retry of a find that errored/returned nothing.
    if (out && !outEmpty) {
      const ck = canonicalFindKey(cmd);
      if (ck && !st.seen_find_queries.includes(ck)) {
        st.seen_find_queries = st.seen_find_queries.concat([ck]);
      }
    }
    if (st.finds_since_read >= FINDS_BEFORE_READ && !st.read_fired) {
      st.read_fired = true;
      msgs.push([
        2,
        `You've run \`coldstart find\` ${st.finds_since_read}× without opening a file. ` +
          "The page already ranks candidates and shows symbol + body lines WITH line numbers — " +
          "stop searching and READ the 1–2 most promising now. Refine the query only if a file's " +
          "actual contents send you elsewhere.",
      ]);
    }
  } else if (isRead) {
    st.finds_since_read = 0;
    st.nonfind_streak = 0;
    st.read_fired = false;
    st.shell_fired = false;
  } else if (isGs) {
    // gs opens file content — credit it like a Read for the spiral/find counters.
    st.finds_since_read = 0;
    st.nonfind_streak = 0;
    st.read_fired = false;
    st.shell_fired = false;
    const counts = st.gs_counts || {};
    counts[gsFile] = (counts[gsFile] || 0) + 1;
    st.gs_counts = counts;
    const fired = st.gs_slice_fired || [];
    // (6) GS-REGUESS — the previous gs on THIS file returned the method menu, and
    // the agent is slicing it again instead of picking a name from that menu.
    if (gsFile && prevFallback === gsFile && !st.gs_reguess_fired) {
      st.gs_reguess_fired = true;
      msgs.push([
        2,
        `\`${gsFile}\` just returned its method MENU — the \`--symbol\` name you passed isn't declared ` +
          "there. Pick a name from that menu, or `Read` the file. Re-calling `gs --symbol` with another " +
          "guessed name on the same file is the single most common wasted call — you already have the menu.",
      ]);
    } else if (gsFile && counts[gsFile] >= GS_SLICE_CAP && !fired.includes(gsFile)) {
      // (5) GS-OVER-SLICE — sliced one file enough times; you have it.
      fired.push(gsFile);
      st.gs_slice_fired = fired;
      msgs.push([
        2,
        `You've sliced \`${gsFile}\` ${counts[gsFile]}× with \`gs\` — you have its bodies plus the ` +
          "`calls:`/`callers:` pointers, so you almost certainly have enough of THIS file. Answer from " +
          "what you have, `Read` it whole if you need lines BETWEEN symbols, or follow a pointer to a " +
          "DIFFERENT file. Stop re-slicing this one.",
      ]);
    }
  } else if (isNonfindShell && st.seen_find) {
    st.nonfind_streak += 1;
    // (3b) NO-NEW-EVIDENCE — per-call: this grep/find is confined to files the
    // agent ALREADY has in context, so it surfaced nothing new.
    const confined = scope.size > 0 && novel.length === 0 && !outEmpty;
    if (confined && (st.redundant_fired || 0) < REDUNDANT_CAP) {
      st.redundant_fired = (st.redundant_fired || 0) + 1;
      const heldHits = [...scope].sort().slice(0, 3);
      const names = heldHits.map((f) => "`" + f + "`").join(", ");
      msgs.push([
        1,
        `This search only touched files you ALREADY have in context — ${names}. You surfaced or read ` +
          "them earlier, so re-grepping them returns lines you already hold; it cannot reveal a new file. " +
          "The answer is in the results already in your context — RE-READ those (the find/gs page, the " +
          "files you opened) and answer the task now. Only search if you can name a genuinely NEW file, " +
          "identifier, or directory you have not yet covered.",
      ]);
    } else if (st.nonfind_streak >= NONFIND_SHELL_STREAK && !st.shell_fired) {
      // (3) generic spiral fallback — non-find streak, but nothing was re-checked
      st.shell_fired = true;
      msgs.push([
        3,
        `${st.nonfind_streak} non-find search/shell calls since your last \`coldstart find\`/Read — ` +
          "this is the spiral. `coldstart find` already body-scans the top files and ranks on filenames " +
          "and symbols, not just body text. Add the missing term and re-run it, or Read a candidate you " +
          "already have. Reserve grep for a literal body string you KNOW exists.",
      ]);
    }
  }

  // (2) empty search result — independent, capped
  if (isSearch && outEmpty && st.empty_fired < EMPTY_NUDGE_CAP) {
    st.empty_fired += 1;
    msgs.push([
      4,
      "That search returned nothing. An empty result means the term or path is WRONG, not that the " +
        "thing is absent — don't repeat the same shape or guess spelling variants. If you're grepping a " +
        "specific FILE for an identifier, run `coldstart gs <file> --symbol <token>` instead: it returns " +
        "the body lines where the token appears (it greps in-tool), so you stop guessing. Otherwise re-run " +
        "`coldstart find` with a different salient term, or Read a candidate you already have.",
    ]);
  }

  // record whether THIS gs call hit the menu fallback, so the NEXT call can detect a re-guess
  if (isGs) {
    st.last_gs_fallback = out && GS_FALLBACK_RE.test(out) ? gsFile : "";
  }

  // (4) checkpoint — periodic, lowest urgency
  if (st.total - st.last_checkpoint >= CHECKPOINT_EVERY) {
    st.last_checkpoint = st.total;
    msgs.push([
      5,
      `Checkpoint (${st.total} tool calls). Stop and think before the next call — answer these in order:\n` +
        "1. Restate the task in one sentence — what is the ONE thing it asks for?\n" +
        "2. List the files you have already surfaced or read that bear on it.\n" +
        "3. Can you answer (1) from (2)? If YES — write the answer now and stop searching; you almost " +
        "certainly have enough.\n" +
        "4. Only if NO — name the single specific fact still missing, and make the next call target ONLY " +
        "that. Do not re-run a search whose results are already in your context.",
    ]);
  }

  // merge THIS call's evidence into the store (after novelty was computed above)
  if (scope.size > 0) {
    st.held_files = [...new Set([...held, ...scope])];
  }

  try {
    const tmp = stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(st));
    renameSync(tmp, stateFile);
  } catch {
    /* never fail on state write */
  }

  if (msgs.length) {
    msgs.sort((a, b) => a[0] - b[0]);
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msgs[0][1],
      },
    };
  }
  return null;
}
