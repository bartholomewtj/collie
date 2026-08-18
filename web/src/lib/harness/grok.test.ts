import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnsi } from "../ansi";
import { splitLines } from "../blocks";
import { describeAdapterConformance } from "./conformance";
import { grokAdapter } from "./grok";

const PANES_DIR = join(import.meta.dirname, "..", "..", "fixtures", "panes");

const allGrokFixtures = readdirSync(PANES_DIR)
  .filter((f) => f.startsWith("grok--") && f.endsWith(".txt"))
  .sort();
const allClaudeFixtures = readdirSync(PANES_DIR)
  .filter((f) => f.startsWith("claude--") && f.endsWith(".txt"))
  .sort();
const allOmpFixtures = readdirSync(PANES_DIR)
  .filter((f) => f.startsWith("omp--") && f.endsWith(".txt"))
  .sort();

const PINNED = [
  "grok--draft-single.txt",
  "grok--draft-wrapped.txt",
  "grok--fresh-idle.txt",
  "grok--working.txt",
];

describeAdapterConformance(grokAdapter, {
  ownFixtures: [],
  foreignFixtures: [...allClaudeFixtures, ...allOmpFixtures],
  neutralFixtures: allGrokFixtures,
});

describe("the grok corpus", () => {
  it("is exactly the captures this adapter was developed against", () => {
    expect(allGrokFixtures).toEqual(PINNED);
  });

  it("declines all of them — nothing is up-levelled", () => {
    expect(allGrokFixtures).toEqual(PINNED);
  });
});

function fixtureLines(name: string) {
  return splitLines(parseAnsi(readFileSync(join(PANES_DIR, name), "utf8")));
}

describe("grokBuildBlocks emits nothing but raw", () => {
  it.each(allGrokFixtures)("%s builds only raw blocks", (name) => {
    const blocks = grokAdapter.buildBlocks(fixtureLines(name));
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.map((b) => b.kind)).toEqual(blocks.map(() => "raw"));
  });

  it("exposes only read-only surfaces", () => {
    expect(Object.keys(grokAdapter).sort()).toEqual(
      [
        "agent",
        "buildBlocks",
        "composerPrompt",
        "composerReady",
        "extractInputDraft",
        "extractStatusLines",
      ].sort(),
    );
  });

  it("is composer-ready on every grok capture", () => {
    for (const name of allGrokFixtures) {
      expect(grokAdapter.composerReady!(fixtureLines(name))).toBe(true);
    }
  });

  it("is not composer-ready on a claude screen", () => {
    expect(grokAdapter.composerReady!(fixtureLines("claude--fresh-idle.txt"))).toBe(false);
  });
});
