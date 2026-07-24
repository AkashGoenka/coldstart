/**
 * trigger.mjs — the capture arming/firing state machine. Pure: no I/O, no
 * clock, no client specifics. The hook feeds it one stop's observations and
 * it returns the updated state + a fire decision.
 *
 * FROZEN SPEC (2026-07-15, replay + wave-lab validated; 2026-07-21 descent/synthesis update;
 *              2026-07-24 "option C" — see the REGRESSION note below):
 *   score  = uncaptured contentRead files ×1
 *          + settled edited files       ×2   (settled = 3 active stops w/o re-edit)
 *          + ALL stops since last fire        (every stop is engagement; see below)
 *     fresh-noted files contribute NOTHING — genuinely new knowledge drives firing.
 *   arm    at score ≥ T(10), requiring ≥1 active stop AND ≥1 uncaptured file.
 *   fire   armed + descent (1 quiet stop)               → non-blocking (inject)
 *          score ≥ CAP(20), ≥2 uncaptured files         → non-blocking (backlog
 *            rescue — replay showed dense sessions starve descent and hit cap
 *            repeatedly; blocking each cap re-created the v4 agitation)
 *          .git/HEAD drift, ≥2 uncaptured files         → BLOCKING (instant —
 *            the one boundary where waiting for a next prompt loses the moment)
 *
 * REGRESSION FIXED 2026-07-24 (why the stop term is ALL stops, not active ones):
 *   The 2026-07-21 change made synthesis turns count as QUIET so they could feed
 *   descent. Correct for descent — but the score's stop term read `activeStops`,
 *   so the same edit silently DELETED the only score-growth term a discussion
 *   session has. Measured consequence: descent fired ZERO times in this repo's
 *   entire history (104 stops / 24 fires — all head-drift or cap). A session that
 *   reads 3 files then discusses them for 8 turns sat at score 4 forever.
 *   The two questions are now asked of different counters, which is the point:
 *     "has enough happened?"  → score, counting EVERY stop (engagement)
 *     "has it wound down?"    → quietRun, counting only non-active stops
 *   The ≥2-active-stops arming gate went with it: a discussion session bursts its
 *   file reads in ONE stop, so that gate alone would have kept the fix inert.
 *   Blocking paths (head-drift) keep MIN_FILES=2 — relaxing those to 1 re-creates
 *   the v4 single-file agitation this design exists to kill.
 *   NEVER: first-stop fire, wall-clock, gap/resume, conversation classification.
 *   (surge removed 2026-07-21: with descent=1 a quiet stop fires descent before
 *    surge could ever apply — the two were redundant. cap + head-drift remain the
 *    safety nets, so no armed state escapes a fire.)
 *
 * State lives in the session marker (JSON-serializable, owned by the caller).
 * Files enter state ONLY if they passed the ignore filter and have contentRead
 * evidence — mentions and ignored files never arm anything.
 */

export const T_ARM = 10;
export const T_CAP = 20;
export const SETTLE_ACTIVE_STOPS = 3;
export const DESCENT_QUIET = 1;
/** Uncaptured-file floor for the BLOCKING/backlog paths (head-drift, cap).
 *  Stays at 2 deliberately: a one-file blocking prompt is the v4 agitation. */
export const MIN_FILES = 2;
/** Floor for the non-blocking paths (arm → descent). One real file is enough to
 *  be worth a note, and descent only ever injects. */
export const MIN_FILES_ARM = 1;

export function initialState() {
  return {
    v: 2,
    stop: 0,            // stops processed
    activeStops: 0,     // ACTIVE stops since last fire (settle clock + arming floor)
    stopsSinceFire: 0,  // ALL stops since last fire (score's engagement term)
    quietRun: 0,        // consecutive quiet stops
    armed: false,
    fires: 0,
    lineCount: 0,       // transcript lines already consumed (caller-owned)
    head: "",           // .git/HEAD fingerprint at last stop (caller-owned)
    // (surge removed 2026-07-21 — descent=1 subsumes it; old markers may still
    //  carry a wasQuiet field, which is simply ignored.)
    files: {},          // rel → { reads, edits, gs, firstStop, lastStop,
                        //         lastEditActive, retouches, captured, fresh }
  };
}

/**
 * step(state, obs) → { state, decision }
 *   obs = {
 *     delta:       Map/obj rel → {reads, edits, gs}   (this stop's NEW evidence,
 *                  ignore-filtered, contentRead tiers only — no mentions),
 *     synthesis:   bool  (prose-heavy tool-light segment),
 *     freshNoted:  Set<rel> (files whose note is currently fresh),
 *     headDrift:   bool  (.git/HEAD changed since last stop — manual commits too),
 *   }
 *   decision = null | { fire: "descent"|"cap"|"head-drift",
 *                       mode: "inject"|"block", files: [rel…] }
 */
export function step(state, obs) {
  const s = state;
  s.stop++;

  // ---- merge this stop's evidence -------------------------------------------
  let newFiles = 0;
  let editsThisStop = 0;
  const entries = obs.delta instanceof Map ? obs.delta.entries() : Object.entries(obs.delta || {});
  const freshNoted = obs.freshNoted || new Set();
  for (const [rel, d] of entries) {
    let f = s.files[rel];
    if (!f) {
      // A file whose note is currently FRESH contributes nothing to the score
      // (genuinely new knowledge drives firing). An edit clears the discount:
      // the note no longer covers what the file just became.
      f = { reads: 0, edits: 0, gs: 0, firstStop: s.stop, lastStop: 0, lastEditActive: -1, retouches: 0, captured: false, fresh: freshNoted.has(rel) };
      s.files[rel] = f;
      newFiles++;
    } else if (f.lastStop !== s.stop && f.lastStop < s.stop) {
      f.retouches++;
    }
    f.reads += d.reads || 0;
    f.gs += d.gs || 0;
    if (d.edits) {
      f.edits += d.edits;
      editsThisStop++;
      f.fresh = false;
      f.captured = false; // re-edit after a capture = new knowledge to capture again
      f.lastEditActive = -2; // provisional: fixed up after active-stop accounting below
    }
    f.lastStop = s.stop;
  }

  // ---- active vs quiet --------------------------------------------------------
  // Active = new files or edits only. Synthesis (prose-heavy, tool-light turns)
  // is the agent settling/explaining — exactly the wind-down signal descent should fire on —
  // so it counts as quiet, not active.
  const active = newFiles > 0 || editsThisStop > 0;
  if (active) { s.activeStops++; s.quietRun = 0; } else { s.quietRun++; }
  // Engagement, counted separately from "work happened". `|| 0` tolerates
  // markers written before this field existed (a live session mid-upgrade).
  s.stopsSinceFire = (s.stopsSinceFire || 0) + 1;
  for (const f of Object.values(s.files)) {
    if (f.lastEditActive === -2) f.lastEditActive = s.activeStops; // edit stamped at current active count
  }

  // ---- score -------------------------------------------------------------------
  const uncaptured = Object.entries(s.files).filter(([, f]) => !f.captured && !f.fresh);
  const readPts = uncaptured.length;
  const settledEdits = uncaptured.filter(([, f]) =>
    f.edits > 0 && f.lastEditActive >= 0 && s.activeStops - f.lastEditActive >= SETTLE_ACTIVE_STOPS,
  ).length;
  const score = readPts + settledEdits * 2 + s.stopsSinceFire;

  // ---- arm / fire ----------------------------------------------------------------
  if (!s.armed && score >= T_ARM && s.activeStops >= 1 && uncaptured.length >= MIN_FILES_ARM) {
    s.armed = true;
  }

  let fire = null;
  if (obs.headDrift && uncaptured.length >= MIN_FILES) {
    fire = { fire: "head-drift", mode: "block" };
  } else if (score >= T_CAP && uncaptured.length >= MIN_FILES) {
    fire = { fire: "cap", mode: "inject" };
  } else if (s.armed && s.quietRun >= DESCENT_QUIET) {
    fire = { fire: "descent", mode: "inject" };
  }

  let decision = null;
  if (fire) {
    // worklist = the uncaptured set, most-worked first (edits, then retouches)
    const files = uncaptured
      .sort((a, b) => (b[1].edits - a[1].edits) || (b[1].retouches - a[1].retouches) || (b[1].reads - a[1].reads))
      .map(([rel]) => rel);
    for (const [, f] of uncaptured) f.captured = true;
    s.armed = false;
    s.activeStops = 0;
    s.stopsSinceFire = 0;
    s.quietRun = 0;
    s.fires++;
    decision = { ...fire, files, score };
  }
  return { state: s, decision };
}
