import { dirname, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

/**
 * Shared Cargo workspace discovery used by both the Rust extractor and resolver.
 *
 * Walks up from a file's directory to find the nearest Cargo.toml with a
 * [workspace] section (or the nearest plain package Cargo.toml as a fallback
 * for single-crate repos). Parses the workspace's member list and each
 * member's [package] name to build a crateName → src-root map.
 *
 * Crate names are stored with `-` normalised to `_` because Rust identifiers
 * use the underscore form (a crate named "tokio-util" is `use tokio_util::...`
 * in source).
 *
 * Caches by Cargo.toml path so multiple files in the same workspace share
 * parsed state.
 */

export interface RustCrateInfo { name: string; srcRoot: string; }
export interface RustWorkspaceInfo { workspaceDir: string; crates: Map<string, RustCrateInfo>; }

const workspaceCache = new Map<string, RustWorkspaceInfo | null>();
const startDirToWorkspaceToml = new Map<string, string | null>();

async function readFileOpt(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8'); } catch { return null; }
}

/**
 * Returns the member list when a [workspace] section exists (may be empty),
 * or null when the toml has no [workspace] section at all.
 */
function parseWorkspaceMembers(toml: string): string[] | null {
  const sectionRe = /^\s*\[workspace\]\s*$/m;
  const wsMatch = toml.match(sectionRe);
  if (!wsMatch) return null;
  const rest = toml.slice(wsMatch.index! + wsMatch[0].length);
  const nextSection = rest.search(/^\s*\[[^\]]+\]\s*$/m);
  const section = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
  const arrMatch = section.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!arrMatch) return [];
  const members: string[] = [];
  const strRe = /["']([^"']+)["']/g;
  let mm: RegExpExecArray | null;
  while ((mm = strRe.exec(arrMatch[1])) !== null) members.push(mm[1]);
  return members;
}

function parsePackageName(toml: string): string | null {
  const pkgMatch = toml.match(/^\s*\[package\]\s*$/m);
  if (!pkgMatch) return null;
  const rest = toml.slice(pkgMatch.index! + pkgMatch[0].length);
  const next = rest.search(/^\s*\[[^\]]+\]\s*$/m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const nameMatch = section.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  return nameMatch ? nameMatch[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

async function expandMemberPattern(workspaceDir: string, pattern: string): Promise<string[]> {
  if (pattern.startsWith('!')) return [];
  if (!pattern.includes('*')) return [join(workspaceDir, pattern)];
  const segments = pattern.split('/');
  let dirs: string[] = [workspaceDir];
  for (const seg of segments) {
    if (!seg.includes('*')) {
      dirs = dirs.map(d => join(d, seg));
      continue;
    }
    const regex = new RegExp('^' + seg.split('*').map(escapeRegex).join('.*') + '$');
    const next: string[] = [];
    for (const d of dirs) {
      try {
        const entries = await readdir(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && regex.test(e.name)) next.push(join(d, e.name));
        }
      } catch { /* skip */ }
    }
    dirs = next;
  }
  return dirs;
}

async function loadWorkspaceInfo(
  workspaceDir: string,
  workspaceToml: string,
  isWorkspace: boolean,
): Promise<RustWorkspaceInfo> {
  const crates = new Map<string, RustCrateInfo>();
  const addCrate = (name: string, srcRoot: string) => {
    crates.set(name.replace(/-/g, '_'), { name, srcRoot });
  };

  // ripgrep's root Cargo.toml ships BOTH [workspace] and [package] — handle either.
  const rootName = parsePackageName(workspaceToml);
  if (rootName) addCrate(rootName, join(workspaceDir, 'src'));

  if (isWorkspace) {
    const members = parseWorkspaceMembers(workspaceToml) ?? [];
    for (const pattern of members) {
      const memberDirs = await expandMemberPattern(workspaceDir, pattern);
      for (const memberDir of memberDirs) {
        const memberToml = await readFileOpt(join(memberDir, 'Cargo.toml'));
        if (!memberToml) continue;
        const name = parsePackageName(memberToml);
        if (!name) continue;
        addCrate(name, join(memberDir, 'src'));
      }
    }
  }

  return { workspaceDir, crates };
}

export async function findRustWorkspace(startDir: string): Promise<RustWorkspaceInfo | null> {
  if (startDirToWorkspaceToml.has(startDir)) {
    const tomlPath = startDirToWorkspaceToml.get(startDir)!;
    return tomlPath ? workspaceCache.get(tomlPath) ?? null : null;
  }

  let workspaceTomlPath: string | null = null;
  let workspaceTomlContent: string | null = null;
  let nearestTomlPath: string | null = null;
  let nearestTomlContent: string | null = null;

  let dir = startDir;
  for (let i = 0; i < 64; i++) {
    const tomlPath = join(dir, 'Cargo.toml');
    const content = await readFileOpt(tomlPath);
    if (content !== null) {
      if (!nearestTomlContent) { nearestTomlPath = tomlPath; nearestTomlContent = content; }
      if (parseWorkspaceMembers(content) !== null) {
        workspaceTomlPath = tomlPath;
        workspaceTomlContent = content;
        break;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  let chosenPath: string | null = null;
  let chosenContent: string | null = null;
  let chosenIsWorkspace = false;
  if (workspaceTomlPath && workspaceTomlContent) {
    chosenPath = workspaceTomlPath;
    chosenContent = workspaceTomlContent;
    chosenIsWorkspace = true;
  } else if (nearestTomlPath && nearestTomlContent) {
    chosenPath = nearestTomlPath;
    chosenContent = nearestTomlContent;
  }

  if (!chosenPath || !chosenContent) {
    startDirToWorkspaceToml.set(startDir, null);
    return null;
  }

  startDirToWorkspaceToml.set(startDir, chosenPath);
  const cached = workspaceCache.get(chosenPath);
  if (cached !== undefined) return cached;
  const info = await loadWorkspaceInfo(dirname(chosenPath), chosenContent, chosenIsWorkspace);
  workspaceCache.set(chosenPath, info);
  return info;
}
