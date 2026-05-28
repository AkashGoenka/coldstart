#!/usr/bin/env python3
"""Render a graph JSON to a static SVG via a simple Fruchterman-Reingold layout.
Pure stdlib, no deps. Nodes colored by top-level dir, sized by in-degree.

Usage: python3 render_svg.py graph.json out.svg "Title"
"""
import json, math, random, sys
from collections import defaultdict

random.seed(7)
g = json.load(open(sys.argv[1]))
out = sys.argv[2]
title = sys.argv[3] if len(sys.argv) > 3 else ""

nodes = [n for n in g["nodes"] if n.endswith(".py")]
nset = set(nodes)
edges = [(a, b) for a, b in g["edges"] if a in nset and b in nset]

indeg = defaultdict(int)
for _, b in edges:
    indeg[b] += 1

W = H = 1400
area = W * H
k = math.sqrt(area / max(1, len(nodes)))
pos = {n: [random.uniform(0, W), random.uniform(0, H)] for n in nodes}

adj = defaultdict(set)
for a, b in edges:
    adj[a].add(b); adj[b].add(a)

ITER = 220
t = W / 10.0
for it in range(ITER):
    disp = {n: [0.0, 0.0] for n in nodes}
    for i, u in enumerate(nodes):
        ux, uy = pos[u]
        for v in nodes[i + 1:]:
            dx = ux - pos[v][0]; dy = uy - pos[v][1]
            d2 = dx * dx + dy * dy + 0.01
            d = math.sqrt(d2)
            f = (k * k) / d
            fx = f * dx / d; fy = f * dy / d
            disp[u][0] += fx; disp[u][1] += fy
            disp[v][0] -= fx; disp[v][1] -= fy
    for a, b in edges:
        dx = pos[a][0] - pos[b][0]; dy = pos[a][1] - pos[b][1]
        d = math.sqrt(dx * dx + dy * dy) + 0.01
        f = (d * d) / k
        fx = f * dx / d; fy = f * dy / d
        disp[a][0] -= fx; disp[a][1] -= fy
        disp[b][0] += fx; disp[b][1] += fy
    for n in nodes:
        dx, dy = disp[n]
        d = math.sqrt(dx * dx + dy * dy) + 0.01
        pos[n][0] += dx / d * min(d, t)
        pos[n][1] += dy / d * min(d, t)
        pos[n][0] = min(W - 20, max(20, pos[n][0]))
        pos[n][1] = min(H - 20, max(20, pos[n][1]))
    t *= 0.97

palette = ["#8ab4ff","#ff9e64","#9ece6a","#f7768e","#bb9af7","#7dcfff","#e0af68","#73daca","#c0caf5","#f4a6c0","#a9b1d6"]
def topdir(n):
    i = n.find("/")
    return n if i < 0 else n[:n.find("/", i + 1)]
dirs = {}
for n in nodes:
    d = topdir(n)
    if d not in dirs:
        dirs[d] = palette[len(dirs) % len(palette)]

parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
         f'viewBox="0 0 {W} {H}" style="background:#0e0f13;font-family:monospace">']
parts.append(f'<text x="20" y="34" fill="#8ab4ff" font-size="22">{title}</text>')
parts.append(f'<text x="20" y="56" fill="#9aa0aa" font-size="14">'
             f'{len(nodes)} files · {len(edges)} edges</text>')
parts.append('<g stroke="#5b6070" stroke-opacity="0.18" stroke-width="0.6">')
for a, b in edges:
    parts.append(f'<line x1="{pos[a][0]:.1f}" y1="{pos[a][1]:.1f}" '
                 f'x2="{pos[b][0]:.1f}" y2="{pos[b][1]:.1f}"/>')
parts.append('</g>')
for n in nodes:
    r = 2.5 + math.sqrt(indeg[n]) * 1.7
    parts.append(f'<circle cx="{pos[n][0]:.1f}" cy="{pos[n][1]:.1f}" r="{r:.1f}" '
                 f'fill="{dirs[topdir(n)]}"/>')
# label the top hubs
for n in sorted(nodes, key=lambda x: -indeg[x])[:12]:
    parts.append(f'<text x="{pos[n][0]+5:.1f}" y="{pos[n][1]:.1f}" fill="#e8eaf0" '
                 f'font-size="11">{n.split("/")[-1]} ({indeg[n]})</text>')
parts.append('</svg>')
open(out, "w").write("\n".join(parts))
print(f"wrote {out} ({len(nodes)} nodes, {len(edges)} edges)")
