import { describe, expect, it } from "vitest";
import { resumePath } from "./resume";

const saved = (path: string, at: number) => JSON.stringify({ path, at });

describe("resumePath", () => {
  it("resumes a recent in-app path when launched at start_url", () => {
    expect(resumePath("/", 1000, saved("/files/src?s=two", 500))).toBe("/files/src?s=two");
  });
  it("leaves a deep link alone", () => {
    expect(resumePath("/pane/x", 1000, saved("/files", 500))).toBeNull();
  });
  it("ignores a stale save", () => {
    expect(resumePath("/", 11 * 60 * 1000, saved("/files", 0))).toBeNull();
  });
  it("ignores junk and the home path itself", () => {
    expect(resumePath("/", 1000, null)).toBeNull();
    expect(resumePath("/", 1000, "{nope")).toBeNull();
    expect(resumePath("/", 1000, saved("/", 500))).toBeNull();
    expect(resumePath("/", 1000, saved("https://evil", 500))).toBeNull();
  });
});
