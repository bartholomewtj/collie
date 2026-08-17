# Issue #9 — Low: upload MIME allow-list bypassed via Object.prototype keys; no magic-byte check; file mode

## What
`bridge/server.ts:51-56, 1074-1077, 1087`:
```ts
const IMAGE_EXT: Record<string, string> = { "image/png": "png", ... };
const ext = IMAGE_EXT[file.type];
if (!ext) { return json({ ok: false, error: `unsupported type...` }) }
```
`file.type` is the multipart part's Content-Type, client-controlled. `IMAGE_EXT["__proto__"]` is `Object.prototype` (truthy), `IMAGE_EXT["constructor"]` is `Object`. So `Content-Type: __proto__` passes and the file lands as `pane-...-abcd1234.[object Object]`. There is also no magic-byte check: "validated by MIME" means "the client's declared MIME". Not an escalation (uploader already has write access), but a defeated check; `journal/registry.ts:347` already uses `Object.hasOwn` for the same trap.

Also: uploads are written via `Bun.write` at umask default; confinement relies on the 0700 dir, which is only applied when the dir is created. If `COLLIE_STATE_DIR` points at an existing shared dir, uploads are world-readable. No aggregate size cap.

## Fix
- `Object.hasOwn(IMAGE_EXT, file.type)` or a `Map`; sniff first bytes.
- Write with `mode: 0o600`; add an aggregate cap.
