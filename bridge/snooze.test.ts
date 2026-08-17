import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clampSnooze, MAX_SNOOZE_MS, Snooze } from "./snooze.ts";
import { loadConfig } from "./config.ts";

// Snooze owns the global do-not-disturb deadline: its expiry/coercion logic is pure (clock injected),
// and we verify the disk round-trip through a throwaway temp state dir.

const dirs: string[] = [];
async function tempCfg() {
  const stateDir = await mkdtemp(join(tmpdir(), "collie-snooze-"));
  dirs.push(stateDir);
  return { ...loadConfig(), stateDir };
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("Snooze", () => {
  test("a future deadline mutes; the clock advancing past it un-mutes", async () => {
    let now = 1_000;
    const snooze = new Snooze(await tempCfg(), () => now);
    await snooze.set(1_000 + 60_000);
    expect(snooze.isMuted()).toBe(true);
    expect(snooze.until()).toBe(61_000);
    now = 61_000; // deadline reached
    expect(snooze.isMuted()).toBe(false);
    expect(snooze.until()).toBe(null);
  });

  test("a past deadline or null resumes immediately", async () => {
    const now = 5_000;
    const snooze = new Snooze(await tempCfg(), () => now);
    await snooze.set(4_000); // already in the past
    expect(snooze.isMuted()).toBe(false);
    await snooze.set(10_000);
    expect(snooze.isMuted()).toBe(true);
    await snooze.set(null); // explicit resume
    expect(snooze.isMuted()).toBe(false);
  });

  test("persists across a reload (survives a restart)", async () => {
    const cfg = await tempCfg();
    let now = 2_000;
    const a = new Snooze(cfg, () => now);
    await a.set(2_000 + 30_000);

    const b = new Snooze(cfg, () => now);
    await b.load();
    expect(b.until()).toBe(32_000);

    now = 32_000;
    expect(b.isMuted()).toBe(false); // a persisted deadline still expires on its own
  });

  test("load tolerates a missing file", async () => {
    const snooze = new Snooze(await tempCfg());
    await snooze.load();
    expect(snooze.until()).toBe(null);
  });

  test("a deadline beyond the cap is clamped to MAX_SNOOZE_MS (issue #8)", async () => {
    let now = 1_000;
    const snooze = new Snooze(await tempCfg(), () => now);
    await snooze.set(9e15); // "mute forever"
    expect(snooze.until()).toBe(now + MAX_SNOOZE_MS);
  });

  test("a deadline inside the cap is kept exactly", async () => {
    let now = 1_000;
    const snooze = new Snooze(await tempCfg(), () => now);
    await snooze.set(now + 60_000);
    expect(snooze.until()).toBe(now + 60_000);
  });

  test("an uncapped value already on disk is clamped on load", async () => {
    const cfg = await tempCfg();
    await mkdir(cfg.stateDir, { recursive: true });
    await writeFile(join(cfg.stateDir, "snooze.json"), JSON.stringify({ mutedUntil: 9e15 }));
    let now = 5_000;
    const snooze = new Snooze(cfg, () => now);
    await snooze.load();
    expect(snooze.until()).toBe(now + MAX_SNOOZE_MS);
  });
});

describe("clampSnooze", () => {
  const now = 10_000;

  test("null resumes (returns null)", () => {
    expect(clampSnooze(null, now)).toBeNull();
  });

  test("NaN and Infinity return null", () => {
    expect(clampSnooze(NaN, now)).toBeNull();
    expect(clampSnooze(Infinity, now)).toBeNull();
    expect(clampSnooze(-Infinity, now)).toBeNull();
  });

  test("past or present timestamp returns null", () => {
    expect(clampSnooze(now, now)).toBeNull();
    expect(clampSnooze(now - 1, now)).toBeNull();
  });

  test("future timestamp within cap is returned unchanged", () => {
    expect(clampSnooze(now + 1_000, now)).toBe(now + 1_000);
    expect(clampSnooze(now + MAX_SNOOZE_MS, now)).toBe(now + MAX_SNOOZE_MS);
  });

  test("future timestamp beyond cap is clamped to now + MAX_SNOOZE_MS", () => {
    expect(clampSnooze(now + MAX_SNOOZE_MS + 1, now)).toBe(now + MAX_SNOOZE_MS);
    expect(clampSnooze(9e15, now)).toBe(now + MAX_SNOOZE_MS);
  });
});
