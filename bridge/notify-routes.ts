import type { Config } from "./config.ts";
import { guard } from "./access.ts";
import { json, requireJsonBody, secure, text } from "./responses.ts";
import { parsePushSubscription } from "./push-endpoint.ts";
import type { Push } from "./push.ts";
import type { Snooze } from "./snooze.ts";
import { herdTagFor, type SessionRegistry } from "./sessions.ts";
import type { NotifyPrefs, NotifyPrefsStore } from "./notify-prefs.ts";
import type { UpdateMonitor } from "./update.ts";

export async function subscribeRoute(req: Request, cfg: Config, push: Push): Promise<Response> {
  const denied = guard(req, cfg, "write");
  if (denied) return denied;
  const bad = requireJsonBody(req);
  if (bad) return bad;
  let body: unknown;
  try { body = await req.json(); } catch { return text("bad subscription", 400); }
  const parsed = parsePushSubscription(body, cfg.pushAllowedHosts);
  if (parsed === null) return text("bad subscription", 400);
  const result = await push.addSubscription(parsed, {
    replaces: supersededEndpoint(body), userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (result === "full") return text("too many subscriptions", 429);
  return secure(new Response(null, { status: 204 }));
}

export async function snoozeRoute(req: Request, cfg: Config, snooze: Snooze, registry: SessionRegistry, push: Push): Promise<Response> {
  const denied = guard(req, cfg, "write");
  if (denied) return denied;
  const bad = requireJsonBody(req); if (bad) return bad;
  let body: unknown; try { body = await req.json(); } catch { return text("bad request", 400); }
  const until = (body as { snoozedUntil?: unknown }).snoozedUntil;
  if (until !== null && (typeof until !== "number" || !Number.isFinite(until))) return text("bad snoozedUntil", 400);
  await snooze.set(until);
  if (snooze.isMuted()) for (const rt of registry.all()) void push.send({ type: "clear", tag: herdTagFor(rt.isPrimary, rt.name) });
  return json({ snoozedUntil: snooze.until() }, req.headers.get("accept-encoding"));
}

export async function notifyPrefsRoute(req: Request, cfg: Config, notifyPrefs: NotifyPrefsStore, registry: SessionRegistry): Promise<Response> {
  if (req.method === "GET") { const denied = guard(req, cfg, "read"); if (denied) return denied; return json(notifyPrefs.current(), req.headers.get("accept-encoding")); }
  if (req.method === "POST") {
    const denied = guard(req, cfg, "write"); if (denied) return denied;
    const bad = requireJsonBody(req); if (bad) return bad;
    let body: unknown; try { body = await req.json(); } catch { return text("bad request", 400); }
    const patch = parseNotifyPrefsPatch(body); if (!patch) return text("bad prefs", 400);
    const updated = await notifyPrefs.set(patch);
    for (const rt of registry.all()) rt.notifications.applyPrefs();
    return json(updated, req.headers.get("accept-encoding"));
  }
  return text("method not allowed", 405);
}

export async function updateCheckRoute(req: Request, cfg: Config, updateMonitor: UpdateMonitor): Promise<Response> {
  const denied = guard(req, cfg, "read"); if (denied) return denied;
  await updateMonitor.checkRelease();
  return json(updateMonitor.status(), req.headers.get("accept-encoding"));
}

export function parseNotifyPrefsPatch(v: unknown): Partial<NotifyPrefs> | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>; const patch: Partial<NotifyPrefs> = {};
  for (const key of ["blocked", "done", "updates"] as const) { if (!(key in o)) continue; if (typeof o[key] !== "boolean") return null; patch[key] = o[key] as boolean; }
  return patch;
}
function supersededEndpoint(body: unknown): string | undefined {
  const replaces = (body as { replaces?: unknown }).replaces;
  if (typeof replaces !== "string" || replaces === "" || replaces.length > 2048) return undefined;
  return replaces;
}
