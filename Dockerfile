# This image exists for MCP directory build sandboxes (Glama and friends), which
# need to boot the server and run the introspection exchange to verify it works.
#
# It is NOT a supported way to run coldstart day to day. coldstart is a repo-local
# tool: it indexes the repository you point it at, wires hooks into that repo, and
# writes its notebook there. A container has no repository, so this image starts a
# server that indexes its own source and little else. To actually use coldstart:
#
#     npm install -g @cstart/coldstart && cd your-project && coldstart init
#
# See README.md.

FROM node:20-slim

WORKDIR /app

# Dependencies first so the layer caches independently of source edits.
#
# --ignore-scripts: the only dependency with a postinstall is @vscode/ripgrep,
# which downloads a prebuilt ripgrep binary from GitHub at install time. Build
# sandboxes are frequently network-restricted, and coldstart does not need it —
# src/server/searcher.ts resolves a searcher at runtime and falls back through
# git grep, then grep, then a Node scan. Verified: a clean `npm ci` in this
# context leaves @vscode/ripgrep with no bin/ directory, and the server still
# builds, starts, and answers introspection.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# vendor/wasm/*.wasm (the 15 Tree-sitter grammars) is committed, so the parse
# engine needs no native toolchain and no node-gyp — plain files copied in.
COPY . .

RUN npm run build && npm prune --omit=dev --ignore-scripts

# Drop root for the security scan. /app is copied in as root, and the keeper
# writes its lockfile and logs under $HOME, so both need to belong to `node`.
RUN chown -R node:node /app
USER node
ENV HOME=/home/node

# stdio transport: the client speaks JSON-RPC over stdin/stdout. No port, no
# network listener. Invoked with no arguments, dist/index.js starts the MCP
# reader rooted at the working directory.
CMD ["node", "dist/index.js"]
