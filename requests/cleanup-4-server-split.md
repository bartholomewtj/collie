Split `bridge/server.ts` (1,852 lines, 30 exports) into route-group modules without changing behaviour.

Where: `bridge/server.ts` and its tests in `bridge/server.test.ts`; new files under `bridge/` (one per route group — e.g. files, push, sssf, sessions, reply — named after what they serve). `bridge/index.ts` is the entry point and keeps working unchanged.

Done means:
- `bridge/server.ts` is the composition root only — it wires the route modules and exports the same public names it exports today, so every existing import (`grep -rn "from \"./server\"" bridge scripts`) and every test still resolves.
- No route, response shape, header, or error path changes. `bun run test` passes with the same count (859 backend) and `bun run typecheck` is clean.
- `bridge/server.test.ts` may be split the same way as the code it tests; test names stay the same.
- PATCH version bump to 0.55.2 in `herdr-plugin.toml`, `package.json`, `web/package.json`, with a `CHANGELOG.md` entry under `### Changed` saying it is an internal split with no behaviour change.

Out of scope: `web/src/` and `web/public/` (the only web file that changes is the version line in web/package.json); `bridge/sssf-viz.ts`, `bridge/herdr-client.ts`, `bridge/push.ts` internals (only their wiring moves); any new behaviour, renamed routes, or dependency.
