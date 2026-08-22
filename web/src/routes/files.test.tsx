import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router";
import { http, HttpResponse } from "msw";
import { server } from "@/test/setup";
import { FilesRoute } from "./files";
import { filesShouldRevalidate, ROOT_ROUTE_ID } from "@/lib/loaders";
import type { FilesData, HomeData } from "@/lib/loaders";
import type { FilesResponse } from "@/lib/types";

const home: HomeData = { bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], device: undefined, sessions: [], session: undefined, snoozedUntil: null, update: undefined, files: true, error: false, authError: false };
function renderFiles(data: unknown) {
  const router = createMemoryRouter([{ id: ROOT_ROUTE_ID, path: "/", loader: () => home, element: <Outlet />, children: [{ path: "files", loader: () => data, element: <FilesRoute /> }, { path: "files/*", loader: () => data, element: <FilesRoute /> }] }], { initialEntries: ["/files"] });
  render(<RouterProvider router={router} />); return router;
}

function splatLoader(listings: Record<string, FilesResponse>) {
  return ({ params }: { params: Record<string, string | undefined> }): FilesData => {
    const rel = (params["*"] ?? "").split("/").filter(Boolean).map(decodeURIComponent).join("/");
    return { rel, data: listings[rel] };
  };
}
describe("FilesRoute", () => {
  it("renders folders and navigates into one", async () => {
    server.use(http.get("/api/files", () => HttpResponse.json({ kind: "dir", path: "", entries: [{ name: "src", kind: "dir", mtimeMs: 1 }], truncated: false })));
    const router = renderFiles({ rel: "", data: { kind: "dir", path: "", entries: [{ name: "src", kind: "dir", mtimeMs: 1 }], truncated: false } });
    const folder = await screen.findByText("src"); fireEvent.click(folder); await waitFor(() => expect(router.state.location.pathname).toContain("/files/src"));
  });
  it("walks a nested folder, not just the first one", async () => {
    const loader = splatLoader({
      "": { kind: "dir", path: "", entries: [{ name: "src", kind: "dir", mtimeMs: 1 }], truncated: false },
      src: { kind: "dir", path: "src", entries: [{ name: "lib", kind: "dir", mtimeMs: 1 }], truncated: false },
      "src/lib": { kind: "dir", path: "src/lib", entries: [{ name: "nav.ts", kind: "file", size: 10, mtimeMs: 1 }], truncated: false },
    });
    const router = createMemoryRouter([{ id: ROOT_ROUTE_ID, path: "/", loader: () => home, element: <Outlet />, children: [
      { path: "files", loader, element: <FilesRoute />, shouldRevalidate: filesShouldRevalidate },
      { path: "files/*", loader, element: <FilesRoute />, shouldRevalidate: filesShouldRevalidate },
    ] }], { initialEntries: ["/files"] });
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByText("src"));
    expect(await screen.findByText("lib")).toBeInTheDocument();
    fireEvent.click(screen.getByText("lib"));
    expect(await screen.findByText("nav.ts")).toBeInTheDocument();
  });
  it("debounces filename search", async () => {
    vi.useFakeTimers(); const search = vi.fn(() => HttpResponse.json({ q: "abc", results: [{ path: "abc.txt", name: "abc.txt", kind: "file" }], truncated: false }));
    server.use(http.get("/api/files/search", search));
    renderFiles({ rel: "", data: { kind: "dir", path: "", entries: [], truncated: false } });
    await act(async () => { await Promise.resolve(); }); const input = screen.getByRole("searchbox"); fireEvent.change(input, { target: { value: "abc" } }); await act(async () => { vi.advanceTimersByTime(200); await vi.runOnlyPendingTimersAsync(); await Promise.resolve(); });
    vi.useRealTimers(); await waitFor(() => expect(screen.getByText("abc.txt")).toBeInTheDocument()); expect(search).toHaveBeenCalledTimes(1);
  });
  it("shows binary download without preview and copies relative path", async () => {
    vi.useRealTimers(); const clipboard = vi.fn().mockResolvedValue(undefined); Object.assign(navigator, { clipboard: { writeText: clipboard } });
    renderFiles({ rel: "bin.dat", data: { kind: "file", path: "bin.dat", name: "bin.dat", size: 2, mtimeMs: 1, binary: true } });
    expect(await screen.findByText(/Can't preview/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Copy path")); await waitFor(() => expect(clipboard).toHaveBeenCalledWith("bin.dat")); expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.queryByText("Open in browser")).toBeNull();
  });
  it("offers Open in browser for types Chrome can display", async () => {
    renderFiles({ rel: "shot.png", data: { kind: "file", path: "shot.png", name: "shot.png", size: 2, mtimeMs: 1, binary: true, openInBrowser: true } });
    const link = await screen.findByRole("link", { name: /Open in browser/ });
    expect(link.getAttribute("href")).toBe("/api/files/open?path=shot.png");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("download")).toBeNull();
  });
});
