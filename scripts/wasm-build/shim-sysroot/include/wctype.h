/* Minimal freestanding wctype.h shim — see stdlib.h in this dir for rationale.
 * wint_t is i32 at the wasm boundary regardless of signedness, matching the
 * functions web-tree-sitter's core exports. */
#ifndef _COLDSTART_SHIM_WCTYPE_H
#define _COLDSTART_SHIM_WCTYPE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef int wint_t;

int iswalnum(wint_t wc);
int iswalpha(wint_t wc);
int iswblank(wint_t wc);
int iswcntrl(wint_t wc);
int iswdigit(wint_t wc);
int iswgraph(wint_t wc);
int iswlower(wint_t wc);
int iswprint(wint_t wc);
int iswpunct(wint_t wc);
int iswspace(wint_t wc);
int iswupper(wint_t wc);
int iswxdigit(wint_t wc);
wint_t towlower(wint_t wc);
wint_t towupper(wint_t wc);

#ifdef __cplusplus
}
#endif

#endif
