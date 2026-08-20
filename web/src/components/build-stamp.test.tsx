import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { __resetServerBuild, observeServerBuild } from "@/lib/server-build";
import { server } from "@/test/setup";
import { BuildStamp } from "./build-stamp";

// BUILD.id under vitest is "test" (vitest.config `define`). The footer nag is driven live by the
// shared server-build store, so observing a differing id must flip the nag on in real time.
afterEach(() => __resetServerBuild());

describe("BuildStamp — live staleness from the server-build store", () => {
  it("shows no update nag while the server build matches (or is unknown)", () => {
    render(<BuildStamp />);
    expect(screen.queryByText(/tap to update/i)).not.toBeInTheDocument();
    act(() => observeServerBuild("test")); // === BUILD.id → not stale
    expect(screen.queryByText(/tap to update/i)).not.toBeInTheDocument();
  });

  it("flips the nag on the moment a newer build is observed, and off again when it re-matches", () => {
    render(<BuildStamp />);
    expect(screen.queryByText(/tap to update/i)).not.toBeInTheDocument();

    act(() => observeServerBuild("0.99.0+new.1")); // differs from BUILD.id → stale
    expect(screen.getByText(/new build — tap to update/i)).toBeInTheDocument();

    act(() => observeServerBuild("test")); // back in sync (e.g. this bundle was reloaded)
    expect(screen.queryByText(/tap to update/i)).not.toBeInTheDocument();
  });
});

// The OTHER staleness: the bridge's own web/dist predating the sources it was built from. Different
// axis from the cached-bundle nag above — this one is the host's problem and has no tap. It exists
// because a stale server bundle looks exactly like a working app (0.41.1), so the footer has to say
// so out loud.
describe("BuildStamp — the bridge reporting its own bundle stale", () => {
  it("stays quiet when /api/config omits staleBuild", async () => {
    render(<BuildStamp />);
    // Let the config fetch settle, so a passing assertion isn't just "the request hasn't landed".
    await waitFor(() => expect(screen.getByText(/^app /)).toBeInTheDocument());
    expect(screen.queryByText(/bun run build/i)).not.toBeInTheDocument();
  });

  it("names the command to run when the bridge reports staleBuild", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json({ push: false, vapidPublicKey: "", staleBuild: true }),
      ),
    );
    render(<BuildStamp />);
    expect(await screen.findByText(/server needs `bun run build`/i)).toBeInTheDocument();
    // It is deliberately not actionable from the phone — the fix is a shell command on the host.
    expect(screen.queryByRole("button", { name: /bun run build/i })).not.toBeInTheDocument();
  });
});
