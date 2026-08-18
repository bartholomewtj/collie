import { homePath, panePath, tracePath } from "./nav";

describe("panePath", () => {
  it("URL-encodes the colon in a pane id", () => {
    expect(panePath("wE:p2")).toBe("/pane/wE%3Ap2");
  });

  it("leaves a colon-free id alone", () => {
    expect(panePath("abc")).toBe("/pane/abc");
  });

  it("round-trips back to the original pane id via decodeURIComponent", () => {
    const id = "w1:p1";
    const encoded = panePath(id).replace("/pane/", "");
    expect(decodeURIComponent(encoded)).toBe(id);
  });

  it("omits the session param on the primary session (undefined/blank)", () => {
    expect(panePath("w1:p1", undefined)).toBe("/pane/w1%3Ap1");
    expect(panePath("w1:p1", "  ")).toBe("/pane/w1%3Ap1");
  });

  it("carries a named session as ?s= (encoded)", () => {
    expect(panePath("w1:p1", "collie-demo")).toBe("/pane/w1%3Ap1?s=collie-demo");
    expect(panePath("abc", "a b")).toBe("/pane/abc?s=a%20b");
  });
});

describe("homePath", () => {
  it("is '/' on the primary session", () => {
    expect(homePath()).toBe("/");
    expect(homePath(undefined)).toBe("/");
    expect(homePath("")).toBe("/");
  });

  it("carries a named session as ?s=", () => {
    expect(homePath("collie-demo")).toBe("/?s=collie-demo");
  });
});

describe("tracePath", () => {
  it("is space + repo, encoded, with no query on primary and no scope", () => {
    expect(tracePath("w1", "collie")).toBe("/traces/w1/collie");
    expect(tracePath("w1", "my repo", "lab")).toBe("/traces/w1/my%20repo?s=lab");
  });

  it("carries a pane scope and a pinned run alongside the session, encoded", () => {
    expect(tracePath("w1", "collie", undefined, { pane: "w1:p2" })).toBe("/traces/w1/collie?pane=w1%3Ap2");
    expect(tracePath("w1", "collie", "lab", { pane: "w1:p2", adw: "ab12" })).toBe(
      "/traces/w1/collie?s=lab&pane=w1%3Ap2&adw=ab12",
    );
  });
});
