import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";

import { AnsiOutput } from "./ansi-output";

const ESC = "\x1b";

// The mirror renders in DARK space under every theme, and the light theme inverts it wholesale
// (.adr/0002). These guard the two ways that arrangement silently breaks.
describe("terminal mirror colour space", () => {
  function mirror(text: string) {
    const { container } = render(<AnsiOutput text={text} />);
    return container.querySelector("pre")!;
  }

  it("inverts in light and leaves dark alone", () => {
    const pre = mirror("hello");
    expect(pre.className).toContain("[filter:invert(1)_hue-rotate(180deg)]");
    // Without the dark: reset the filter would apply in BOTH themes and dark would render inverted.
    expect(pre.className).toContain("dark:[filter:none]");
  });

  // Guards the ONE-SPELLING half of ADR 0002 rule 2. `bg-background` would in fact work here — an
  // inherited light-dark() token resolves against THIS element's colour-scheme (dark), not the
  // root's — but the mirror deliberately keeps a single spelling so nobody has to know that to read
  // it. Mixing the two is the regression this catches; a computed-style test would not.
  it("uses literal dark-space colours, never theme tokens", () => {
    const pre = mirror("hello");
    expect(pre.className).toContain("bg-[#0a0a0a]");
    expect(pre.className).toContain("text-[#fafafa]");
    expect(pre.className).not.toMatch(/\bbg-background\b/);
    expect(pre.className).not.toMatch(/\btext-foreground\b/);
  });

  it("keeps muted rule glyphs on a literal dark-space grey", () => {
    const pre = mirror("├────────────┤\n");
    const span = [...pre.querySelectorAll("span")].find((s) => s.textContent?.includes("─"));
    expect(span).toBeDefined();
    expect(span!.style.color).toBe("rgb(161, 161, 161)"); // #a1a1a1, --muted-foreground's dark half
  });

  it("emits palette variables for indexed colour so the 16 slots stay themeable", () => {
    const pre = mirror(`${ESC}[31mred${ESC}[0m`);
    const span = [...pre.querySelectorAll("span")].find((s) => s.textContent === "red");
    expect(span!.style.color).toBe("var(--ansi-1)");
  });
});

// Wrap defaults ON (#53): the mirror is mostly agent prose and a phone shows far fewer columns than
// the desktop width panes are spawned at. The no-wrap branch is still the right rendering for TUI
// tables and box drawing, but it is now reachable ONLY through the View toggle — so it is exactly
// the kind of code a later refactor can drop without any test noticing.
describe("mirror line wrapping", () => {
  function preFor(props: Partial<ComponentProps<typeof AnsiOutput>>) {
    const { container } = render(<AnsiOutput text="a very long line" {...props} />);
    return container.querySelector("pre")!;
  }

  it("wraps by default rather than making the block a horizontal panner", () => {
    const cls = preFor({}).className;
    expect(cls).toContain("whitespace-pre-wrap");
    expect(cls).not.toContain("overflow-x-auto");
  });

  it("still pans, column-faithful, when wrap is turned off", () => {
    const cls = preFor({ wrap: false }).className;
    expect(cls).toContain("whitespace-pre");
    expect(cls).toContain("overflow-x-auto");
    expect(cls).not.toContain("whitespace-pre-wrap");
  });

  it("keeps a marked ANSI border to one pannable row without changing its text, styles, links, or find offsets", () => {
    const border = `  ${"─".repeat(20)}`;
    const text = `ordinary prose\n${ESC}[41m${border.slice(0, 12)}${ESC}[44m${border.slice(12)}${ESC}[0m\nsee https://herdr.dev/docs\n`;
    const { container } = render(<AnsiOutput text={text} query="───" />);
    const pre = container.querySelector("pre")!;
    const pan = pre.querySelector("[data-mirror-pan]")!;

    expect(pan.className).toContain("max-w-full");
    expect(pan.className).toContain("overflow-x-auto");
    expect(pan.className).not.toContain("overflow-hidden");
    // overflow-x-auto on inline-block still gives a bottom-edge baseline; align it to the line
    // box's bottom so the border keeps the terminal grid's one-row line advance.
    expect(pan.className).toContain("align-bottom");
    expect(pan.className).toContain("whitespace-pre");
    expect(pan.className).not.toContain("whitespace-nowrap");
    expect(pan.className).toContain("break-normal");
    expect(pan.textContent).toBe(border);
    expect(pan.children).toHaveLength(2);
    expect((pan.children[0] as HTMLElement).style.backgroundColor).toBe("var(--ansi-1)");
    expect((pan.children[1] as HTMLElement).style.backgroundColor).toBe("var(--ansi-4)");
    expect(pan.querySelector("[data-find-match]")).not.toBeNull();
    expect(pre.querySelector("a")?.textContent).toBe("https://herdr.dev/docs");
    expect(pre.textContent).toBe(`ordinary prose\n${border}\nsee https://herdr.dev/docs\n`);
  });

  it("pans a plain border only while wrapping, leaving ordinary output and wrap-off panning alone", () => {
    const border = `  ${"─".repeat(20)}`;
    const { container: plain } = render(<AnsiOutput text={`${border}\n`} />);
    expect(plain.querySelector("[data-mirror-pan]")?.textContent).toBe(border);

    const { container: wrapped } = render(<AnsiOutput text={`unbroken-${"x".repeat(40)}\n`} />);
    const wrappedPre = wrapped.querySelector("pre")!;
    expect(wrappedPre.className).toContain("break-words");
    expect(wrappedPre.querySelector("[data-mirror-pan]")).toBeNull();

    const { container: panned } = render(<AnsiOutput text={`${border}\n`} wrap={false} />);
    const pannedPre = panned.querySelector("pre")!;
    expect(pannedPre.className).toContain("overflow-x-auto");
    expect(pannedPre.querySelector("[data-mirror-pan]")).toBeNull();
    expect(pannedPre.textContent).toBe(`${border}\n`);
  });

  it("pans a long rounded box border while wrapping (Grok/omp composer chrome)", () => {
    const top = `  ╭${"─".repeat(40)}╮`;
    const { container } = render(<AnsiOutput text={`${top}\n`} />);
    expect(container.querySelector("[data-mirror-pan]")?.textContent).toBe(top);
  });

  it("pans a wide enclosed table/box row while wrapping", () => {
    const row = "│ col 1      │ col 2      │";
    const { container } = render(<AnsiOutput text={`${row}\n`} />);
    const pan = container.querySelector("[data-mirror-pan]")!;
    expect(pan).not.toBeNull();
    expect(pan.className).toContain("overflow-x-auto");
    expect(pan.textContent).toBe(row);
  });

  it("wraps boxed prose instead of panning it like a table", () => {
    const row = "│ Yes. Tap the image button on the reply box. This is a long boxed message. │";
    const { container } = render(<AnsiOutput text={`${row}\n`} />);
    const pre = container.querySelector("pre")!;
    expect(pre.querySelector("[data-mirror-pan]")).toBeNull();
    expect(pre.className).toContain("whitespace-pre-wrap");
    expect(pre.textContent).toBe(`${row}\n`);
  });

  it("groups consecutive Grok edit/diff gutter rows into one pan scroller", () => {
    const del = `${ESC}[48;2;66;14;20m       45  - hang on Windows${ESC}[0m`;
    const ins = `${ESC}[48;2;6;56;6m       42  - hang on Windows${ESC}[0m`;
    const ctx = "       38  ## Open";
    const text = `intro\n${ctx}\n${del}\n${ins}\noutro\n`;
    const { container } = render(<AnsiOutput text={text} />);
    const pans = container.querySelectorAll("[data-mirror-pan]");
    expect(pans).toHaveLength(1);
    expect(pans[0]!.textContent).toBe("       38  ## Open\n       45  - hang on Windows\n       42  - hang on Windows");
    const red = [...pans[0]!.querySelectorAll("span")].find(
      (s) => (s as HTMLElement).style.backgroundColor === "rgb(66, 14, 20)",
    );
    const green = [...pans[0]!.querySelectorAll("span")].find(
      (s) => (s as HTMLElement).style.backgroundColor === "rgb(6, 56, 6)",
    );
    expect(red).toBeTruthy();
    expect(green).toBeTruthy();
  });

  it("groups consecutive table rows into one pan scroller so columns stay aligned", () => {
    const r1 = "| Flag | Default | Type | Applies to | Notes |";
    const r2 = "|------|---------|------|------------|-------|";
    const r3 = "| --wrap | on | bool | grok, agy, claude | Prose wraps |";
    const text = `intro\n${r1}\n${r2}\n${r3}\noutro\n`;
    const { container } = render(<AnsiOutput text={text} />);
    const pans = container.querySelectorAll("[data-mirror-pan]");
    expect(pans).toHaveLength(1);
    expect(pans[0]!.textContent).toBe(`${r1}\n${r2}\n${r3}`);
    expect(container.querySelector("pre")!.textContent).toBe(text);
  });

  it("strips trailing spaces from a full-width highlight row, keeps its background, and wraps it like prose", () => {
    const highlight = `${ESC}[7mHighlight bar${" ".repeat(30)}${ESC}[27m`;
    const { container } = render(<AnsiOutput text={`${highlight}\n`} />);
    const pre = container.querySelector("pre")!;
    expect(pre.querySelector("[data-mirror-pan]")).toBeNull();
    expect(pre.textContent).toBe("Highlight bar\n");
    const span = [...pre.querySelectorAll("span")].find((s) => s.textContent === "Highlight bar") as HTMLElement;
    expect(span.style.backgroundColor).toBe("rgb(250, 250, 250)");
  });

  it("renders a coloured padded row trimmed to visible text, and strips pure-space coloured lines completely", () => {
    const padded = `${ESC}[41mok${" ".repeat(60)}${ESC}[0m`;
    const { container: paddedCont } = render(<AnsiOutput text={`${padded}\n`} />);
    expect(paddedCont.querySelector("[data-mirror-pan]")).toBeNull();
    const paddedSpan = [...paddedCont.querySelectorAll("span")].find((s) => s.textContent === "ok") as HTMLElement;
    expect(paddedSpan.textContent).toBe("ok");
    expect(paddedSpan.style.backgroundColor).toBe("var(--ansi-1)");

    const pureSpace = `${ESC}[41m${" ".repeat(60)}${ESC}[0m`;
    const { container: emptyCont } = render(<AnsiOutput text={`${pureSpace}\n`} />);
    expect(emptyCont.querySelectorAll("span")).toHaveLength(0);
  });

  it("threads find match offsets and autolinks accurately on lines after a stripped row", () => {
    const text = `${ESC}[41mtitle${" ".repeat(30)}${ESC}[0m\nline after with searchtarget and https://herdr.dev/docs\n`;
    const { container } = render(<AnsiOutput text={text} query="searchtarget" />);
    const pre = container.querySelector("pre")!;
    const hit = pre.querySelector("[data-find-match]")!;
    expect(hit).not.toBeNull();
    expect(hit.textContent).toBe("searchtarget");
    expect(pre.querySelector("a")?.textContent).toBe("https://herdr.dev/docs");
    expect(pre.textContent).toBe("title\nline after with searchtarget and https://herdr.dev/docs\n");
  });

  it("does not paint Grok canvas fill or coloured vpad rows as zebra bars", () => {
    const canvas = `${ESC}[48;2;20;20;20m`;
    const prose = `${canvas}     Do not add --bind. Do not put it in Settings.${" ".repeat(12)}${ESC}[0m`;
    const vpad = `${canvas}${" ".repeat(60)}${ESC}[0m`;
    const next = `${canvas}     --lan still needs a token.${" ".repeat(20)}${ESC}[0m`;
    const { container } = render(<AnsiOutput text={`${prose}\n${vpad}\n${next}\n`} />);
    const pre = container.querySelector("pre")!;
    expect(pre.textContent).toBe("     Do not add --bind. Do not put it in Settings.\n     --lan still needs a token.\n");
    const filled = [...pre.querySelectorAll("span")].filter((s) => (s as HTMLElement).style.backgroundColor);
    expect(filled).toHaveLength(0);
  });

  it("leaves an enclosed table row unclipped under wrap={false} with interior columns intact", () => {
    const tableRow = "│ col 1      │ col 2      │";
    const { container: panned } = render(<AnsiOutput text={`${tableRow}\n`} wrap={false} />);
    const pannedPre = panned.querySelector("pre")!;
    expect(pannedPre.className).toContain("overflow-x-auto");
    expect(pannedPre.querySelector("[data-mirror-pan]")).toBeNull();
    expect(pannedPre.textContent).toBe(`${tableRow}\n`);
  });
});

// URLs printed by an agent are plain characters — the mirror finds them and wraps those ranges in
// anchors. The invariants worth guarding are the ones a refactor would silently break: the text is
// still exactly what the terminal printed, and nothing but http(s) ever becomes an href.
describe("clickable links in the mirror", () => {
  function mirror(props: Partial<ComponentProps<typeof AnsiOutput>> & { text: string }) {
    const { container } = render(<AnsiOutput {...props} />);
    return container.querySelector("pre")!;
  }

  it("links a bare URL without changing the rendered text", () => {
    const pre = mirror({ text: "opened https://herdr.dev/docs ok\n" });
    const a = pre.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://herdr.dev/docs");
    expect(a.textContent).toBe("https://herdr.dev/docs");
    // The mirror must stay a faithful copy — the anchor adds structure, never characters.
    expect(pre.textContent).toBe("opened https://herdr.dev/docs ok\n");
  });

  it("opens in a new tab and severs the opener — these hrefs come from agent output", () => {
    const a = mirror({ text: "https://herdr.dev\n" }).querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never links a dangerous scheme", () => {
    const pre = mirror({ text: "javascript:alert(1) data:text/html,<script>x</script>\n" });
    expect(pre.querySelector("a")).toBeNull();
    expect(pre.querySelector("script")).toBeNull(); // text nodes only — the XSS boundary holds
  });

  // A URL that changes colour mid-way (an agent underlining just the path, say) is split across
  // segments. Each slice gets its own anchor, so the whole run is tappable and carries one href.
  it("links a URL that straddles an SGR change", () => {
    const pre = mirror({ text: `${ESC}[34mhttps://herdr.dev${ESC}[32m/docs${ESC}[0m\n` });
    const anchors = [...pre.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(1);
    expect(anchors.every((a) => a.getAttribute("href") === "https://herdr.dev/docs")).toBe(true);
    expect(anchors.map((a) => a.textContent).join("")).toBe("https://herdr.dev/docs");
  });

  // Find and links split the same coordinate space; the order they nest in is the easy thing to get
  // wrong, and getting it wrong drops one of them.
  it("still highlights a find match inside a link", () => {
    const pre = mirror({ text: "see https://herdr.dev/docs\n", query: "herdr" });
    const a = pre.querySelector("a")!;
    const hit = a.querySelector("[data-find-match]")!;
    expect(hit.textContent).toBe("herdr");
    expect(a.textContent).toBe("https://herdr.dev/docs");
  });

  // The underline inherits the agent's colour rather than pinning one, so it stays legible whatever
  // the pane printed and whichever theme is up.
  it("underlines in currentColor rather than a fixed colour", () => {
    const a = mirror({ text: "https://herdr.dev\n" }).querySelector("a")!;
    expect(a.className).toContain("underline");
    expect(a.className).not.toMatch(/decoration-\[#/);
  });

  // The tap-target pad must scale with the font-size control. jsdom has no layout, so this can only
  // guard the unit — but the unit is the whole point: a px pad tuned for 12px text reaches past the
  // neighbouring line's centre at 9px (the A− floor), and a tap on ordinary output opens a link.
  // The padded box deliberately OVERLAPS its neighbours (~22px against a 15px line advance); what
  // must hold is that it never reaches the neighbouring line's centre, which only an em value keeps
  // true across the A+/A- range. See the LINK_CLASS comment for the full argument.
  it("sizes the link tap target in em, never px", () => {
    const a = mirror({ text: "https://herdr.dev\n" }).querySelector("a")!;
    expect(a.className).toContain("py-[0.35em]");
    expect(a.className).not.toMatch(/\bpy-\[[\d.]+px\]/);
  });
});
