import { describe, expect, test } from "bun:test";

import {
  createOperatorCommands,
  createOperatorQuickReplies,
  validateOperatorCommands,
  validateOperatorQuickReplies,
  type CommandsFileIo,
} from "./operator-commands.ts";

// The palette's escape hatch: an operator-declared row for a command the shipped catalog cannot
// vouch for (a plugin's, or their own). The validator is pure, so it is driven with parsed TOML
// directly; the reader is driven through a fake io, so the caching contract needs no fs.

const quiet = () => {};

/** Parse a TOML source the way the reader does, then validate it — the whole grammar in one call. */
function rows(toml: string) {
  return validateOperatorCommands(Bun.TOML.parse(toml), quiet);
}

describe("validateOperatorCommands", () => {
  test("nothing declared yields nothing", () => {
    expect(rows("")).toEqual([]);
    expect(rows("commands = []")).toEqual([]);
    expect(validateOperatorCommands(undefined, quiet)).toEqual([]);
    expect(validateOperatorCommands(null, quiet)).toEqual([]);
  });

  test("scopes a row to one agent and keeps its description", () => {
    expect(
      rows(`
        [[commands]]
        scope = "omp"
        command = "/fork-in-herdr"
        description = "Fork into a new herdr tab"
      `),
    ).toEqual([
      {
        agent: "omp",
        command: "/fork-in-herdr",
        description: "Fork into a new herdr tab",
        takesArg: false,
        argHint: "",
        confirm: false,
      },
    ]);
  });

  test("an unscoped row carries no agent, so every pane gets it", () => {
    const out = rows(`[[commands]]\ncommand = "/deploy"`);
    expect(out).toEqual([
      {
        command: "/deploy",
        description: "Custom command",
        takesArg: false,
        argHint: "",
        confirm: false,
      },
    ]);
    expect("agent" in out[0]!).toBe(false);
  });

  test("a hint after the command marks the row arg-taking", () => {
    expect(
      rows(`
        [[commands]]
        scope = "claude"
        command = "/model <name>"
        description = "Switch model"
      `),
    ).toMatchObject([{ command: "/model", argHint: "<name>", takesArg: true }]);
  });

  test("trims fields and lowercases the agent", () => {
    expect(
      rows(`
        [[commands]]
        scope = " OMP "
        command = "  /a  "
        description = "  One  "
      `).map((c) => [c.agent, c.command, c.description]),
    ).toEqual([["omp", "/a", "One"]]);
  });

  test("a colon in the command belongs to the command", () => {
    const out = rows(`[[commands]]\ncommand = "/skill:review"\ndescription = "Run the review skill"`);
    expect(out[0]!.agent).toBeUndefined();
    expect(out[0]!.command).toBe("/skill:review");
  });

  test("prose the env grammar banned now survives intact", () => {
    // The whole reason the rows moved out of an env var: a comma no longer ends the row, and an `=`
    // no longer starts the description.
    expect(
      rows(`
        [[commands]]
        command = "/set [key=value]"
        description = "Set a key, then read it back"
      `),
    ).toMatchObject([
      { command: "/set", argHint: "[key=value]", description: "Set a key, then read it back" },
    ]);
  });

  test("drops rows that are not slash commands, keeping the rest", () => {
    expect(
      rows(`
        [[commands]]
        command = "fork-in-herdr"

        [[commands]]
        command = "/"

        [[commands]]
        scope = "omp"
        command = "/ok"
      `),
    ).toMatchObject([{ agent: "omp", command: "/ok" }]);
  });

  test("a redefinition wins, in place, without disturbing another scope", () => {
    expect(
      rows(`
        [[commands]]
        scope = "omp"
        command = "/x"
        description = "first"

        [[commands]]
        scope = "codex"
        command = "/x"
        description = "other"

        [[commands]]
        scope = "omp"
        command = "/x"
        description = "second"
      `).map((c) => [c.agent, c.description]),
    ).toEqual([
      ["omp", "second"],
      ["codex", "other"],
    ]);
  });

  test("an empty scope is rejected, never widened to every agent", () => {
    // `scope = ""` is someone reaching for a narrower rule than they typed. Dropping the empty scope
    // would hand them a row on every pane — the one outcome they were not asking for.
    expect(rows(`[[commands]]\nscope = ""\ncommand = "/wipe"`)).toEqual([]);
    expect(rows(`[[commands]]\nscope = "  "\ncommand = "/wipe"`)).toEqual([]);
    expect(rows(`[[commands]]\nscope = 7\ncommand = "/wipe"`)).toEqual([]);
  });

  test("confirm = true marks the operator's own row dangerous", () => {
    expect(rows(`[[commands]]\ncommand = "/deploy"\nconfirm = true`)[0]!.confirm).toBe(true);
    expect(rows(`[[commands]]\ncommand = "/deploy"\nconfirm = false`)[0]!.confirm).toBe(false);
  });

  test("an unusable confirm drops the row, never leaving it one-tap", () => {
    // `confirm = "yes"` is someone reaching for a brake. Honouring it as false would hand them the
    // one row they were trying to slow down, firing on a single tap.
    expect(rows(`[[commands]]\ncommand = "/deploy"\nconfirm = "yes"`)).toEqual([]);
    expect(rows(`[[commands]]\ncommand = "/deploy"\nconfirm = 1`)).toEqual([]);
  });

  test("a `commands` key that is not an array of tables costs only its own rows", () => {
    expect(validateOperatorCommands({ commands: "/deploy" }, quiet)).toEqual([]);
    expect(validateOperatorCommands({ commands: ["/deploy", { command: "/ok" }] }, quiet)).toMatchObject([
      { command: "/ok" },
    ]);
  });
});

/** An io whose file contents and mtime are set by hand, counting every read it is asked for. */
function fakeIo(initial: { mtime: number | null; text: string }) {
  const state = { ...initial, reads: 0 };
  const io: CommandsFileIo = {
    mtime: async () => state.mtime,
    read: async () => {
      state.reads += 1;
      if (state.mtime === null) throw new Error("ENOENT");
      return state.text;
    },
  };
  return { io, state };
}

const ONE_ROW = `[[commands]]\ncommand = "/a"\ndescription = "One"`;
const TWO_ROWS = `${ONE_ROW}\n\n[[commands]]\ncommand = "/b"\ndescription = "Two"`;

describe("createOperatorCommands", () => {
  test("parses once and serves the cache until the mtime moves", async () => {
    const { io, state } = fakeIo({ mtime: 100, text: ONE_ROW });
    const read = createOperatorCommands("/cfg/commands.toml", io, quiet);
    expect(await read()).toMatchObject([{ command: "/a" }]);
    expect(await read()).toMatchObject([{ command: "/a" }]);
    expect(state.reads).toBe(1);

    state.text = TWO_ROWS;
    state.mtime = 200;
    expect(await read()).toMatchObject([{ command: "/a" }, { command: "/b" }]);
    expect(state.reads).toBe(2);
  });

  test("a malformed rewrite keeps the last good rows, and does not re-read", async () => {
    const { io, state } = fakeIo({ mtime: 100, text: ONE_ROW });
    const read = createOperatorCommands("/cfg/commands.toml", io, quiet);
    expect(await read()).toMatchObject([{ command: "/a" }]);

    state.text = "[[commands]\ncommand = ";
    state.mtime = 200;
    expect(await read()).toMatchObject([{ command: "/a" }]);
    // Warned once per change, not once per request: the failed mtime is remembered too.
    expect(await read()).toMatchObject([{ command: "/a" }]);
    expect(state.reads).toBe(2);

    // Fixing the file recovers on the next mtime move.
    state.text = TWO_ROWS;
    state.mtime = 300;
    expect(await read()).toMatchObject([{ command: "/a" }, { command: "/b" }]);
  });

  test("no file at all is not an error", async () => {
    const { io, state } = fakeIo({ mtime: null, text: "" });
    const read = createOperatorCommands("/cfg/commands.toml", io, quiet);
    expect(await read()).toEqual([]);
    expect(state.reads).toBe(0);

    state.text = ONE_ROW;
    state.mtime = 100;
    expect(await read()).toMatchObject([{ command: "/a" }]);
  });

  test("a file that never parsed serves empty rather than failing", async () => {
    const { io } = fakeIo({ mtime: 100, text: "nonsense = [" });
    const read = createOperatorCommands("/cfg/commands.toml", io, quiet);
    expect(await read()).toEqual([]);
  });
});

/** The Quick-dock half of the same file, parsed the same way. */
function quick(toml: string) {
  return validateOperatorQuickReplies(Bun.TOML.parse(toml), quiet);
}

describe("validateOperatorQuickReplies", () => {
  test("nothing declared yields nothing, and [[commands]] rows are not quick replies", () => {
    expect(quick("")).toEqual([]);
    expect(quick("quick = []")).toEqual([]);
    expect(quick(`[[commands]]
command = "/a"`)).toEqual([]);
    expect(validateOperatorQuickReplies(undefined, quiet)).toEqual([]);
  });

  test("a row keeps its text, defaults its group, and carries no agent when unscoped", () => {
    const out = quick(`[[quick]]
text = "run the tests"`);
    expect(out).toEqual([{ text: "run the tests", group: "mine" }]);
    expect("agent" in out[0]!).toBe(false);
  });

  test("scope and group are lowercased and trimmed", () => {
    expect(quick(`[[quick]]
text = " ship it "
scope = " Claude "
group = "Review"`)).toEqual([
      { agent: "claude", text: "ship it", group: "review" },
    ]);
  });

  test("whitespace runs collapse — a multi-line string cannot send half a reply", () => {
    expect(quick(`[[quick]]
text = """fix the
  failing test"""`)).toEqual([
      { text: "fix the failing test", group: "mine" },
    ]);
  });

  test("drops empty, over-long, and mis-typed rows, and an empty scope or group, keeping the rest", () => {
    const warned: string[] = [];
    const out = validateOperatorQuickReplies(
      Bun.TOML.parse(`
        [[quick]]
        text = ""
        [[quick]]
        text = "${"x".repeat(81)}"
        [[quick]]
        text = "ok"
        scope = ""
        [[quick]]
        text = "ok"
        group = " "
        [[quick]]
        text = 42
        [[quick]]
        text = "kept"
      `),
      (m) => warned.push(m),
    );
    expect(out).toEqual([{ text: "kept", group: "mine" }]);
    expect(warned).toHaveLength(5);
  });

  test("a later row with the same scope and text replaces the earlier one in place", () => {
    expect(
      quick(`
        [[quick]]
        text = "yes"
        group = "confirm"
        [[quick]]
        text = "no"
        group = "confirm"
        [[quick]]
        text = "yes"
        group = "mine"
      `),
    ).toEqual([
      { text: "yes", group: "mine" },
      { text: "no", group: "confirm" },
    ]);
  });

  test("the reader serves quick rows from the same file, cached on mtime like commands", async () => {
    const { io, state } = fakeIo({ mtime: 100, text: `[[quick]]
text = "a"` });
    const read = createOperatorQuickReplies("/cfg/commands.toml", io, quiet);
    expect(await read()).toEqual([{ text: "a", group: "mine" }]);
    expect(await read()).toEqual([{ text: "a", group: "mine" }]);
    expect(state.reads).toBe(1);
    state.text = ONE_ROW;
    state.mtime = 200;
    expect(await read()).toEqual([]);
  });
});
