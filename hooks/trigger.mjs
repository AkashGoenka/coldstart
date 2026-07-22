/**
 * trigger.mjs — the capture arming/firing state machine. Pure: no I/O, no
 * clock, no client specifics. The hook feeds it one stop's observations and
 * it returns the updated state + a fire decision.
 *
 * FROZEN SPEC (2026-07-15, replay + wave-lab validated; 2026-07-21 descent/synthesis update):
 *   score  = uncaptured contentRead files ×1
 *          + settled edited files       ×2   (settled = 3 active stops w/o re-edit)
 *          + active stops since last fire     (new files or edits only; synthesis no longer counts as active)
 *     fresh-noted files contribute NOTHING — genuinely new knowledge drives firing.
 *   arm    at score ≥ T(10), requiring ≥2 active stops AND ≥2 uncaptured files.
 *   fire   armed + descent (1 quiet stop)               → non-blocking (inject)
 *          score ≥ CAP(20)                              → non-blocking (backlog
 *            rescue — replay showed dense sessions starve descent and hit cap
 *            repeatedly; blocking each cap re-created the v4 agitation)
 *          .git/HEAD drift, ≥2 uncaptured files         → BLOCKING (instant —
 *            the one boundary where waiting for a next prompt loses the moment)
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
export const MIN_FILES = 2;

export function initialState() {
  return {
    v: 2,
    stop: 0,            // stops processed
    activeStops: 0,     // ACTIVE stops since last fire
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
  for (const f of Object.values(s.files)) {
    if (f.lastEditActive === -2) f.lastEditActive = s.activeStops; // edit stamped at current active count
  }

  // ---- score -------------------------------------------------------------------
  const uncaptured = Object.entries(s.files).filter(([, f]) => !f.captured && !f.fresh);
  const readPts = uncaptured.length;
  const settledEdits = uncaptured.filter(([, f]) =>
    f.edits > 0 && f.lastEditActive >= 0 && s.activeStops - f.lastEditActive >= SETTLE_ACTIVE_STOPS,
  ).length;
  const score = readPts + settledEdits * 2 + s.activeStops;

  // ---- arm / fire ----------------------------------------------------------------
  if (!s.armed && score >= T_ARM && s.activeStops >= 2 && uncaptured.length >= MIN_FILES) {
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
    s.quietRun = 0;
    s.fires++;
    decision = { ...fire, files, score };
  }
  return { state: s, decision };
}
