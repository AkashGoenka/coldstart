/* Minimal freestanding stdio.h shim — see stdlib.h in this dir for rationale.
 * tree_sitter/alloc.h includes <stdio.h>; release (NDEBUG) grammar code does
 * not actually call into stdio, so only the type/decls needed to compile are
 * provided. Any reference would become an undefined import. */
#ifndef _COLDSTART_SHIM_STDIO_H
#define _COLDSTART_SHIM_STDIO_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct _COLDSTART_FILE FILE;
extern FILE *stderr;
extern FILE *stdout;
int fprintf(FILE *stream, const char *format, ...);
int printf(const char *format, ...);
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream);

#ifdef __cplusplus
}
#endif

#endif
