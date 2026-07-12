/* Minimal assert.h shim — see stdlib.h in this dir for rationale. Grammars are
 * compiled with -DNDEBUG (as the shipped .wasm are), so assert() is a no-op and
 * no __assert_fail import is emitted (web-tree-sitter's core does not export it). */
#ifndef _COLDSTART_SHIM_ASSERT_H
#define _COLDSTART_SHIM_ASSERT_H

#undef assert
#ifdef NDEBUG
#define assert(expr) ((void)0)
#else
/* Fallback for a non-NDEBUG build: still a no-op, since no __assert_fail is
 * available in the wasm host. */
#define assert(expr) ((void)0)
#endif

#endif
