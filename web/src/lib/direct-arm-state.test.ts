import { afterEach, describe, expect, it } from "vitest";
import { __resetDirectArm, isDirectArmed, setDirectArmed } from "./direct-arm";

afterEach(__resetDirectArm);
describe("direct arm state", () => {
  it("is false by default and tracks changes", () => { expect(isDirectArmed()).toBe(false); setDirectArmed(true); expect(isDirectArmed()).toBe(true); setDirectArmed(false); expect(isDirectArmed()).toBe(false); });
  it("resets", () => { setDirectArmed(true); __resetDirectArm(); expect(isDirectArmed()).toBe(false); });
});
