import { __resetDesktop, desktopPrefs, setDesktop, setTyping } from "./desktop";

describe("desktop preferences", () => {
  beforeEach(() => __resetDesktop());
  afterEach(() => __resetDesktop());

  it("has the phone-safe defaults", () => {
    expect(desktopPrefs()).toMatchInlineSnapshot(`
      {
        "on": false,
        "typing": "composer",
      }
    `);
  });
  it("persists both preferences", () => {
    setDesktop(true);
    setTyping("direct");
    expect(desktopPrefs()).toEqual({ on: true, typing: "direct" });
    expect(localStorage.getItem("collie:desktop:v1")).toContain("direct");
  });
});
