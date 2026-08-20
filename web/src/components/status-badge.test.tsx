import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusBadge, StatusDot } from "./status-badge";

describe("StatusDot", () => {
  it("renders amber with animate-ping when working and runningCommand is absent/false", () => {
    const { container } = render(<StatusDot status="working" />);
    const ping = container.querySelector(".animate-ping");
    expect(ping).not.toBeNull();
    expect(ping).toHaveClass("bg-status-working");

    const innerDot = container.querySelector(".relative.inline-flex");
    expect(innerDot).toHaveClass("bg-status-working");
  });

  it("renders solid blue with no animate-ping when working and runningCommand is true", () => {
    const { container } = render(<StatusDot status="working" runningCommand />);
    const ping = container.querySelector(".animate-ping");
    expect(ping).toBeNull();

    const innerDot = container.querySelector(".relative.inline-flex");
    expect(innerDot).toHaveClass("bg-status-running");
    expect(innerDot).not.toHaveClass("bg-status-working");
  });

  it("ignores runningCommand when status is not working", () => {
    const { container } = render(<StatusDot status="idle" runningCommand />);
    const ping = container.querySelector(".animate-ping");
    expect(ping).toBeNull();

    const innerDot = container.querySelector(".relative.inline-flex");
    expect(innerDot).toHaveClass("border-[1.5px]");
    expect(innerDot).not.toHaveClass("bg-status-running");
  });
});

describe("StatusBadge", () => {
  it("renders working badge with amber dot by default", () => {
    const { container } = render(<StatusBadge status="working" />);
    expect(screen.getByText("working")).toBeInTheDocument();
    const dot = container.querySelector(".size-1\\.5");
    expect(dot).toHaveClass("bg-status-working");
  });

  it("renders working badge with blue dot when runningCommand is true", () => {
    const { container } = render(<StatusBadge status="working" runningCommand />);
    expect(screen.getByText("working")).toBeInTheDocument();
    const dot = container.querySelector(".size-1\\.5");
    expect(dot).toHaveClass("bg-status-running");
    expect(dot).not.toHaveClass("bg-status-working");
  });
});
