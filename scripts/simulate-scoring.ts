/**
 * Simulation: penalty factor + threshold tuning for get-overview scoring.
 *
 * The penalty alone isn't enough — noise files still pass threshold because
 * "action" is an exact match giving them a high floor.
 *
 * We test two combined approaches:
 * A) Penalty × relative threshold (current threshold_pct mechanism)
 * B) Penalty × require all concepts to have exact match (strict mode)
 * C) Penalty × score gap filter (only include if score > topScore * gap_pct)
 */

interface MockFile {
  path: string;
  domains: string[];
  isBarrel: boolean;
  archRole: string;
  label: 'target' | 'noise' | 'partial';
}

const TOTAL_FILES = 5863;
const TOKEN_DOC_FREQ: Record<string, number> = {
  group:      600,
  grouphub:   12,
  action:     180,
  hub:        15,
  form:       300,
  node:       400,
  policy:     120,
  helper:     350,
  membership: 40,
  menu:       25,
  auth:       30,
  login:      25,
  jwt:        8,
  user:       500,
  payment:    20,
};

function idf(token: string): number {
  const freq = TOKEN_DOC_FREQ[token] ?? 1;
  return Math.log(TOTAL_FILES / freq);
}

const FILES: MockFile[] = [
  // Targets: have exact "grouphub" + exact "action"
  {
    path: 'enduser-app/components/grouphubs/GroupHubActionMenu/GroupHubActionMenu.tsx',
    domains: ['grouphub', 'group', 'hub', 'action', 'menu', 'membership'],
    isBarrel: false, archRole: 'unknown', label: 'target',
  },
  {
    path: 'enduser-app/components/grouphubs/GroupHubsActionMenu/GroupHubsActionMenu.tsx',
    domains: ['grouphub', 'group', 'hub', 'action', 'menu'],
    isBarrel: false, archRole: 'unknown', label: 'target',
  },
  {
    path: 'enduser-app/server/membership/membershipMiddleware.ts',
    domains: ['grouphub', 'group', 'hub', 'action', 'membership'],
    isBarrel: false, archRole: 'middleware', label: 'target',
  },
  // Partial: has "grouphub" but not "action"
  {
    path: 'enduser-app/components/grouphubs/EditGroupHubWidget/EditGroupHubWidget.tsx',
    domains: ['grouphub', 'group', 'hub', 'form'],
    isBarrel: false, archRole: 'unknown', label: 'partial',
  },
  // Noise: only "group" (substring match for grouphub) + exact "action"
  {
    path: 'shared/client/helpers/form/FormHelper/FormHelper.ts',
    domains: ['form', 'group', 'action', 'helper'],
    isBarrel: false, archRole: 'util', label: 'noise',
  },
  {
    path: 'shared/client/helpers/nodes/NodePolicyHelper.ts',
    domains: ['node', 'policy', 'group', 'action', 'helper'],
    isBarrel: false, archRole: 'util', label: 'noise',
  },
  {
    path: 'shared/client/components/form/types.ts',
    domains: ['form', 'group', 'action'],
    isBarrel: false, archRole: 'types', label: 'noise',
  },
  {
    path: 'e2e-tests/integration/tests/ValidateCategoryReportPage.cy.ts',
    domains: ['group', 'action'],
    isBarrel: false, archRole: 'test', label: 'noise',
  },
  {
    path: 'enduser-app/components/nodes/NodeActionButtonWidget/NodeActionButtonWidget.tsx',
    domains: ['node', 'group', 'action'],
    isBarrel: false, archRole: 'unknown', label: 'noise',
  },
];

interface ConceptGroup { tokens: string[] }

interface ScoreResult {
  file: MockFile;
  score: number;
  matchedTokens: string[];
  matchTypes: Array<'exact' | 'substring'>;
  allExact: boolean;
}

function scoreFile(
  file: MockFile,
  conceptGroups: ConceptGroup[],
  substringPenalty: number,
): ScoreResult {
  let idfSum = 0;
  const matchedTokens: string[] = [];
  const matchTypes: Array<'exact' | 'substring'> = [];

  for (const group of conceptGroups) {
    let bestToken: string | null = null;
    let bestIdf = -1;
    let bestIsExact = false;

    for (const queryToken of group.tokens) {
      const matchingDomain = file.domains.find(
        d => d === queryToken || (queryToken.length > d.length && queryToken.includes(d))
      );
      if (matchingDomain) {
        const isExact = matchingDomain === queryToken;
        const rawIdf = idf(matchingDomain);
        const effectiveIdf = isExact ? rawIdf : rawIdf * substringPenalty;
        if (effectiveIdf > bestIdf) {
          bestIdf = effectiveIdf;
          bestToken = matchingDomain;
          bestIsExact = isExact;
        }
      }
    }

    if (bestToken !== null) {
      matchedTokens.push(bestToken);
      matchTypes.push(bestIsExact ? 'exact' : 'substring');
      idfSum += bestIdf;
    }
  }

  const matchedGroupCount = matchedTokens.length;
  const coverage = matchedGroupCount / conceptGroups.length;
  const score = idfSum * coverage * coverage;
  const allExact = matchTypes.every(t => t === 'exact');

  return { file, score, matchedTokens, matchTypes, allExact };
}

// ---------------------------------------------------------------------------
// APPROACH A: penalty only (current mechanism, just tuned)
// ---------------------------------------------------------------------------
function approachA(
  files: MockFile[],
  groups: ConceptGroup[],
  penalty: number,
  thresholdPct: number,
): ScoreResult[] {
  const scored = files.map(f => scoreFile(f, groups, penalty)).filter(r => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter(r => r.score >= top * thresholdPct);
}

// ---------------------------------------------------------------------------
// APPROACH B: penalty + require all concepts matched exactly
// (fallback: if <50% of results have all-exact, don't apply this filter)
// ---------------------------------------------------------------------------
function approachB(
  files: MockFile[],
  groups: ConceptGroup[],
  penalty: number,
  thresholdPct: number,
): ScoreResult[] {
  const scored = files.map(f => scoreFile(f, groups, penalty)).filter(r => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  const afterThreshold = scored.filter(r => r.score >= top * thresholdPct);
  // Only apply exact-only filter if at least 1 result has all-exact matches
  const hasExact = afterThreshold.some(r => r.allExact);
  if (hasExact) return afterThreshold.filter(r => r.allExact);
  return afterThreshold;
}

// ---------------------------------------------------------------------------
// APPROACH C: penalty + score gap (drop if score < topScore * gap_pct)
// This is a tighter relative threshold
// ---------------------------------------------------------------------------
function approachC(
  files: MockFile[],
  groups: ConceptGroup[],
  penalty: number,
  gapPct: number,
): ScoreResult[] {
  const scored = files.map(f => scoreFile(f, groups, penalty)).filter(r => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter(r => r.score >= top * gapPct);
}

// ---------------------------------------------------------------------------
// Run all simulations
// ---------------------------------------------------------------------------
const GROUPS_GROUPHUB_ACTION: ConceptGroup[] = [
  { tokens: ['grouphub'] },
  { tokens: ['action'] },
];

// Also test: "auth login" query — a case where substring matching IS useful
// "authentication" in file path should match "auth" concept
const FILES_AUTH: MockFile[] = [
  {
    path: 'src/auth/AuthService.ts',
    domains: ['auth', 'user', 'login'],
    isBarrel: false, archRole: 'service', label: 'target',
  },
  {
    path: 'src/middleware/authenticationMiddleware.ts', // indexed as "authentication" → tokens: ["auth"]
    domains: ['auth', 'middleware'],
    isBarrel: false, archRole: 'middleware', label: 'target',
  },
  {
    path: 'src/user/UserService.ts',
    domains: ['user', 'login'],  // no auth
    isBarrel: false, archRole: 'service', label: 'noise',
  },
];

const GROUPS_AUTH_LOGIN: ConceptGroup[] = [
  { tokens: ['auth'] },
  { tokens: ['login'] },
];

function printResults(label: string, results: ScoreResult[], totalFiles: number) {
  console.log(`\n  ${label} → ${results.length} result(s)`);
  for (const r of results) {
    const emoji = r.file.label === 'target' ? '✓' : r.file.label === 'partial' ? '~' : '✗';
    const shortPath = r.file.path.split('/').slice(-1)[0];
    const matchInfo = r.matchedTokens.map((t, i) => `${t}(${r.matchTypes[i]})`).join(', ');
    console.log(`    ${emoji} ${shortPath.padEnd(42)} score=${r.score.toFixed(2).padEnd(6)} [${matchInfo}]`);
  }
  const targets = results.filter(r => r.file.label === 'target').length;
  const noise = results.filter(r => r.file.label === 'noise').length;
  console.log(`    → targets: ${targets}  noise: ${noise}`);
}

console.log('='.repeat(80));
console.log('SCENARIO 1: "grouphub action" — want GroupHubActionMenu, not FormHelper');
console.log('='.repeat(80));

// Approach A: vary penalty + threshold
for (const [penalty, threshold] of [[1.0, 0.30], [0.3, 0.30], [0.3, 0.55], [0.1, 0.55]] as [number, number][]) {
  const r = approachA(FILES, GROUPS_GROUPHUB_ACTION, penalty, threshold);
  printResults(`A penalty=${penalty} threshold=${threshold}`, r, TOTAL_FILES);
}

// Approach B: exact-only filter
for (const penalty of [1.0, 0.3]) {
  const r = approachB(FILES, GROUPS_GROUPHUB_ACTION, penalty, 0.30);
  printResults(`B (exact-only filter) penalty=${penalty}`, r, TOTAL_FILES);
}

// Approach C: tighter gap
for (const [penalty, gap] of [[1.0, 0.60], [0.3, 0.60], [0.3, 0.70]] as [number, number][]) {
  const r = approachC(FILES, GROUPS_GROUPHUB_ACTION, penalty, gap);
  printResults(`C penalty=${penalty} gap=${gap}`, r, TOTAL_FILES);
}

console.log('\n' + '='.repeat(80));
console.log('SCENARIO 2: "auth login" — substring matching should still work');
console.log('(auth files indexed as "auth" token, but query is also "auth" here — exact)');
console.log('='.repeat(80));

for (const [penalty, threshold] of [[1.0, 0.30], [0.3, 0.55], [0.1, 0.55]] as [number, number][]) {
  const r = approachA(FILES_AUTH, GROUPS_AUTH_LOGIN, penalty, threshold);
  printResults(`penalty=${penalty} threshold=${threshold}`, r, TOTAL_FILES);
}

console.log('\n' + '='.repeat(80));
console.log('FINAL RECOMMENDATION TABLE');
console.log('Approach B (exact-only) with penalty=0.3 as fallback looks promising.');
console.log('If ANY result has all-exact matches, drop substring-only results.');
console.log('='.repeat(80));
