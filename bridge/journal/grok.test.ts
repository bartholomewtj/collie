import { describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractGrokUserSpeech,
  grokJournal,
  GrokTranscriptSource,
  isGrokSessionId,
  parseGrokTranscript,
} from "./grok.ts";

const SID = "01a00e2f-d3f3-7290-bc3d-fd276f91e272";
const OLDER = "703814f0-cd28-5e23-b5c6-869df1969c41";

const userQuery = (text: string, index = 0) =>
  JSON.stringify({
    type: "user",
    content: [{ type: "text", text: `<user_query>\n${text}\n</user_query>` }],
    prompt_index: index,
  });

const assistant = (text: string, toolCalls?: unknown[]) =>
  JSON.stringify({
    type: "assistant",
    content: text,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  });

describe("isGrokSessionId", () => {
  test.each([
    ["a v7-shaped id", SID, true],
    ["a v4 uuid", OLDER, true],
    ["a traversal attempt", "../../secrets", false],
    ["chat_history.jsonl", "chat_history.jsonl", false],
  ])("%s → %s", (_label, value, expected) => {
    expect(isGrokSessionId(value)).toBe(expected);
  });
});

describe("extractGrokUserSpeech", () => {
  test("unwraps <user_query>", () => {
    expect(extractGrokUserSpeech("<user_query>\nmerge\n</user_query>")).toBe("merge");
  });

  test.each([
    ["the injected workspace blob", "<user_info>\nOS Version: windows\n</user_info>"],
    ["a system reminder", "<system-reminder>\nskills…\n</system-reminder>"],
    ["empty", ""],
  ])("drops %s", (_label, raw) => {
    expect(extractGrokUserSpeech(raw)).toBeNull();
  });

  test("keeps a bare spoken line (no envelope)", () => {
    expect(extractGrokUserSpeech("just this")).toBe("just this");
  });
});

describe("parseGrokTranscript", () => {
  test("reads spoken turns and drops system / reminder / reasoning rows", () => {
    const text = [
      JSON.stringify({ type: "system", content: "You are Grok." }),
      JSON.stringify({
        type: "user",
        content: [{ type: "text", text: "<user_info>\nOS Version: windows\n</user_info>" }],
      }),
      JSON.stringify({
        type: "user",
        content: [{ type: "text", text: "<system-reminder>\nskills\n</system-reminder>" }],
        synthetic_reason: "system_reminder",
      }),
      userQuery("how do I scroll?"),
      JSON.stringify({
        type: "reasoning",
        id: "rs_1",
        summary: [{ type: "summary_text", text: "thinking…" }],
      }),
      assistant("Swipe up."),
    ].join("\n");
    const entries = parseGrokTranscript(text);
    expect(entries.map((e) => [e.role, e.parts[0] && "text" in e.parts[0] ? e.parts[0].text : ""])).toEqual([
      ["user", "how do I scroll?"],
      ["assistant", "Swipe up."],
    ]);
  });

  test("folds a tool_result onto the matching call", () => {
    const text = [
      assistant("Looking.", [
        { id: "call-1", name: "read_file", arguments: JSON.stringify({ target_file: "/repo/README.md" }) },
      ]),
      JSON.stringify({ type: "tool_result", tool_call_id: "call-1", content: "# Collie\nA phone UI." }),
    ].join("\n");
    const entries = parseGrokTranscript(text);
    expect(entries).toHaveLength(1);
    const tool = entries[0]!.parts.find((p) => p.kind === "tool");
    expect(tool).toMatchObject({
      kind: "tool",
      name: "read_file",
      summary: "/repo/README.md",
      result: { text: "# Collie\nA phone UI." },
    });
  });

  test("skips a clipped last line rather than throwing", () => {
    expect(parseGrokTranscript(['{"type":"assi', userQuery("hi")].join("\n"))).toHaveLength(1);
  });

  test("gives each turn a stable unique cursor", () => {
    const text = [userQuery("one"), userQuery("two"), assistant("ok")].join("\n");
    const entries = parseGrokTranscript(text);
    const ids = entries.map((e) => e.uuid);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseGrokTranscript(text).map((e) => e.uuid)).toEqual(ids);
  });
});

describe("GrokTranscriptSource", () => {
  async function fixture() {
    const created = `${tmpdir()}/collie-grok-${Math.floor(performance.now() * 1000)}`;
    await mkdir(created, { recursive: true });
    const base = await realpath(created);
    const root = join(base, "sessions");
    const cwd = "C:\\ClaudeOS";
    const cwdDir = join(root, encodeURIComponent(cwd));
    const sessionDir = join(cwdDir, SID);
    await mkdir(sessionDir, { recursive: true });
    const log = join(sessionDir, "chat_history.jsonl");
    await Bun.write(log, userQuery("hi"));
    const olderDir = join(cwdDir, OLDER);
    await mkdir(olderDir, { recursive: true });
    const olderLog = join(olderDir, "chat_history.jsonl");
    await Bun.write(olderLog, userQuery("older"));
    // Make SID newer so inferFromCwd picks the live session.
    await Bun.write(log, userQuery("hi") + "\n" + assistant("yo"));
    // Stamped explicitly: on a fast disk both writes can land in the same millisecond, and a tie on
    // mtime would leave readdir order to decide which session is "newest".
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-01-01T00:01:00Z");
    await utimes(olderLog, older, older);
    await utimes(log, newer, newer);
    return { base, root, cwd, log };
  }

  test("resolves an id by scanning per-cwd directories", async () => {
    const { base, root, log } = await fixture();
    expect(await new GrokTranscriptSource(root).resolve({ kind: "id", value: SID })).toBe(log);
    await rm(base, { recursive: true, force: true });
  });

  test("an unknown id resolves to null rather than guessing", async () => {
    const { base, root } = await fixture();
    expect(
      await new GrokTranscriptSource(root).resolve({
        kind: "id",
        value: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      }),
    ).toBeNull();
    await rm(base, { recursive: true, force: true });
  });

  test("refuses a traversal id", async () => {
    const { base, root } = await fixture();
    expect(await new GrokTranscriptSource(root).resolve({ kind: "id", value: "../../secrets" })).toBeNull();
    await rm(base, { recursive: true, force: true });
  });

  test("inferFromCwd returns the newest session under that cwd", async () => {
    const { base, root, cwd } = await fixture();
    expect(await new GrokTranscriptSource(root).inferFromCwd(cwd)).toEqual({ kind: "id", value: SID });
    await rm(base, { recursive: true, force: true });
  });

  test("inferFromCwd matches a cwd whose separators or case differ", async () => {
    const { base, root } = await fixture();
    expect(await new GrokTranscriptSource(root).inferFromCwd("c:/claudeos")).toEqual({
      kind: "id",
      value: SID,
    });
    await rm(base, { recursive: true, force: true });
  });

  test("grokJournal.inferFromCwd is wired through the adapter", async () => {
    const { base, root, cwd } = await fixture();
    const adapter = grokJournal(root);
    expect(adapter.agent).toBe("grok");
    expect(await adapter.inferFromCwd?.(cwd)).toEqual({ kind: "id", value: SID });
    await rm(base, { recursive: true, force: true });
  });
});
