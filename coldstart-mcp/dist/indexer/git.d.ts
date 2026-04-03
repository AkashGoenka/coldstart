/**
 * Run `git log` to extract co-change relationships between files.
 *
 * Returns Map<fileA, Map<fileB, normalizedScore>>.
 * Score = commits_together / max(commits_A, commits_B).
 *
 * Returns empty map if git is unavailable or directory is not a repo.
 */
export declare function analyzeGitCoChange(rootDir: string, maxCommits?: number): Promise<Map<string, Map<string, number>>>;
/**
 * Get the current HEAD commit hash. Returns '' if unavailable.
 */
export declare function getGitHead(rootDir: string): Promise<string>;
//# sourceMappingURL=git.d.ts.map