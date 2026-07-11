/* Minimal freestanding stdlib.h shim for building tree-sitter grammars to
 * emscripten SIDE_MODULE wasm. Only declarations are needed: the referenced
 * functions are left as undefined imports and resolved by web-tree-sitter's
 * core module (`env`) at Language.load() time. See scripts/wasm-build/. */
#ifndef _COLDSTART_SHIM_STDLIB_H
#define _COLDSTART_SHIM_STDLIB_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

void *malloc(size_t size);
void *calloc(size_t nmemb, size_t size);
void *realloc(void *ptr, size_t size);
void free(void *ptr);
void abort(void);
void exit(int status);

#ifdef __cplusplus
}
#endif

#endif
