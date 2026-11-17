# S6 mapper brief (Sonnet, writes NO notes)
You plan a notebook-seeding run. Orient yourself in ROOT (README, manifests such as
package.json/go.mod/Gemfile/pyproject, the entry points, the routing/command table, the top
of the tree). You are given HUBS: the repo's most-imported/most-changed files.

Produce 8–12 TOPICS. A topic is a mechanism that spans files and that a developer would
ask about. The list MUST start with these onboarding topics (adapt names to the repo, and
drop one only if the repo truly has no such thing):
  1. what the system is, its entry points/processes, and how it boots (config/env read where)
  2. how a request / command / event reaches its handler (routing, middleware/filter order)
  3. how auth and permissions are enforced (if any)
  4. how to add the most common new thing (endpoint, command, page, job…)
Then the repo's own domain mechanisms (the core thing this project does, its data
writes, its background work, its integrations). Prefer what is specific to THIS repo.
Every HUB file should fall under some topic's seeds unless it is trivial.

For each topic give 2–6 seed files and a one-sentence hint ONLY if you actually read
something non-obvious (hints are verified by the worker, so a wrong hint costs a correction;
a missing hint costs nothing).
Save JSON to <SCRATCH>/topics.json:
  [{"id":"t1","topic":"...","seeds":["path",...],"hint":"..."}]
Final message: the JSON.
