import { afterEach, describe, expect, it } from "vitest";
import { onArmToggleRequest, requestArmToggle } from "./direct-arm";

afterEach(() => { /* subscribers are removed by each test */ });

describe("direct arm signal", () => {
  it("is safe without subscribers", () => { expect(() => requestArmToggle()).not.toThrow(); });
  it("notifies each subscriber once", () => {
    const one = vi.fn(); const two = vi.fn();
    const offOne = onArmToggleRequest(one); const offTwo = onArmToggleRequest(two);
    requestArmToggle();
    expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(1);
    offOne(); offTwo();
  });
  it("supports unsubscribe", () => {
    const listener = vi.fn();
    const off = onArmToggleRequest(listener); off(); requestArmToggle();
    expect(listener).not.toHaveBeenCalled();
  });
});
