// Cloudflare Worker: serve the markdown twin when a client asks for it.
// Route: coldstartmcp.dev/*  (set in wrangler.toml). Everything else passes through
// to the GitHub Pages origin untouched. Twins are built by site-astro/scripts/markdown-twins.mjs.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const wantsMd = /\btext\/markdown\b/i.test(request.headers.get('Accept') || '');
    const eligible = request.method === 'GET' || request.method === 'HEAD';
    // Directory-style routes only ("/", "/docs/"); files like /og.png or /x.md pass through.
    if (!wantsMd || !eligible || !url.pathname.endsWith('/')) return passThrough(request);

    const twin = new URL(url);
    twin.pathname += 'index.md';
    const res = await fetch(new Request(twin, request));
    if (!res.ok) return passThrough(request); // no twin (graph, demo, ...): fall back to HTML

    const headers = new Headers(res.headers);
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
    headers.append('Vary', 'Accept');
    addDiscoveryLinks(url, headers);
    return new Response(res.body, { status: 200, headers });
  },
};

// RFC 8288 Link headers on the homepage only, pointing at real machine-readable resources.
// No api-catalog rel: coldstart exposes no HTTP API, so there is no catalog to point at.
function addDiscoveryLinks(url, headers) {
  if (url.pathname !== '/') return;
  headers.append('Link', '</docs/>; rel="service-doc"');
  headers.append('Link', '</llms.txt>; rel="describedby"; type="text/plain"');
  headers.append('Link', '</index.md>; rel="alternate"; type="text/markdown"');
}

async function passThrough(request) {
  const res = await fetch(request);
  const headers = new Headers(res.headers);
  headers.append('Vary', 'Accept'); // HTML and markdown share a URL, so caches must key on Accept
  addDiscoveryLinks(new URL(request.url), headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
