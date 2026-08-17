# Issue #11 — Low: frontend/static hardening — build-info bypasses host allowlist, // links, ctrl+ hint keys

Three small front-end/static hardening items, none exploitable for RCE (the React side has no HTML sinks).

1. **`build-info.json` and static assets bypass the host allowlist.** `/api/config` was moved behind `guard()` (upstream #32) so a rebound DNS name cannot read the build id, but `serveStatic` (`server.ts:389 -> 1411-1439`) has no `checkAccess`/host check and serves `web/dist/build-info.json`, plus stamps `X-Collie-Build` on every static response. Fix: apply `isHostAllowed` to `serveStatic` when `publicHosts` is set; drop `build-info.json` from the static route.

2. **Markdown links allow scheme-relative hrefs.** `web/src/lib/markdown.ts:66`: `if (href.startsWith("/") || href.startsWith("#")) return href;` so `//evil.tld/login` passes (comment acknowledges it). Phishing surface only. Fix: reject `//` prefix or resolve against origin and require same host.

3. **Footer key hints let agent text choose which key a labelled button sends.** `web/src/lib/harness/menu-hints.ts:70-71` accepts `ctrl+<letter>` from parsed pane text; the label comes from the same text. Agent prints `ctrl+c to Continue`, user taps "Continue", Collie sends `ctrl+c`. Same-pane only. Fix: drop `ctrl+` from `menuKeyFor`; mark text-parsed buttons visually.