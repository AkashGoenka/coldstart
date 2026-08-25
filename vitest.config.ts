import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // A large part of this suite is integration-shaped: it spawns `node` on a
    // hook script or on `dist/index.js`, sometimes several times per test, and
    // the kb tests load real WASM grammars. Process spawn and WASM
    // instantiation are markedly slower on Windows than on Linux — enough that
    // vitest's 5s default failed ~30 otherwise-correct tests there while CI
    // (ubuntu-only) stayed green and never showed it.
    //
    // This is a bound on hangs, not a performance target: nothing here should
    // come close to 30s. If something does, that is a regression worth
    // chasing, not a number to raise again.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
