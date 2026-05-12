# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-05-12

### Fixed
- `init` no longer runs a second `npm install --prefix ~/.coldstart/versions/<v>/`. That install hung indefinitely on npm's dep resolver oscillating between `tree-sitter ^0.21` (needed by `@tree-sitter-grammars/tree-sitter-xml` and `tree-sitter-c-sharp`) and `tree-sitter ^0.22` (our direct dep). With no lockfile in an empty `--prefix`, npm's idealTree algorithm cycles 89,000+ `placeDep ROOT` lines without converging.
- `init` now copies the already-resolved `node_modules` from the running install (npx cache, global, or local devDep) into `~/.coldstart/versions/<version>/` via `fs.cpSync`. First-run cost drops from "indefinite hang" to 2–5 s. No network, no compile, no npm involvement.

## [1.4.1] - 2026-05-12

### Fixed
- `npx coldstart-mcp@latest init` crashed with `ReferenceError: __filename is not defined`. The package ships as ESM (`"type": "module"`), where `__filename`/`__dirname` are CommonJS-only. `src/init.ts` and `src/migrate.ts` now derive `__filename` from `import.meta.url` via `fileURLToPath`.

## [1.4.0] - 2026-05-12

### Changed
- `coldstart-mcp init` now writes `.mcp.json` entries using direct `node` invocation against a stable install at `~/.coldstart/versions/<version>/`. Previously used `npx -y coldstart-mcp` which caused MCP startup timeouts on machines where `npm exec`'s integrity-check tax exceeded the 30 s MCP timeout.
- Server auto-migrates legacy `.mcp.json` entries on startup. If your config has `"command": "npx"`, it gets rewritten on first launch (with backup). Opt out via `COLDSTART_NO_AUTO_MIGRATE=1`.

### Why
- Fixes "MCP connection timed out after 30000ms" reported by users on common configurations.
- See `NPX_COLD_START_2026-05-11.md` for the diagnosis.
