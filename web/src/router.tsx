import { createBrowserRouter } from "react-router";

import { BootSplash, RootError, RootLayout } from "@/routes/root";
import { TreeRoute } from "@/routes/tree";
import { SpacesRedirect, SpaceRedirect } from "@/routes/redirects";
import { TraceRoute, TracesRoute } from "@/routes/traces";
import { DetailRoute } from "@/routes/detail";
import { HistoryRoute } from "@/routes/history";
import { SettingsRoute } from "@/routes/settings";
import { FilesRoute } from "@/routes/files";
import { filesLoader, filesShouldRevalidate, historyLoader, rootLoader, paneLoader, PANE_ROUTE_ID, ROOT_ROUTE_ID } from "@/lib/loaders";

// We don't use view transitions. React Router persists an "applied view transitions" map to
// sessionStorage ("remix-router-transitions") and replays a phantom same-location transition on every
// revalidation for any path it once saw a `viewTransition: true` navigation from. A device that ran an
// older Collie build (which did use them) can carry a stale entry that fires
// document.startViewTransition on every poll. Clear it on boot — our code never repopulates it. The
// `:root { view-transition-name: none }` in index.css is the belt to this: even a stray transition
// then captures nothing, so there's no visible flicker regardless of this key's name.
try {
  sessionStorage.removeItem("remix-router-transitions");
} catch {
  // sessionStorage access can throw in locked-down / private contexts — ignore.
}

// Created once at module scope so the idle-lock in App can unmount/remount RouterProvider without
// losing the current location (the router instance retains it; loaders re-run fresh on remount).
export const router = createBrowserRouter([
  {
    id: ROOT_ROUTE_ID,
    path: "/",
    loader: rootLoader,
    element: <RootLayout />,
    // Catches render-phase errors and loader throws (e.g. a missing :paneId) so a component bug
    // shows a recoverable screen instead of React Router's blank default.
    errorElement: <RootError />,
    HydrateFallback: BootSplash,
    children: [
      { index: true, element: <TreeRoute /> },
      { path: "spaces", element: <SpacesRedirect /> },
      { path: "space/:spaceId", element: <SpaceRedirect /> },
      { path: "traces", element: <TracesRoute /> },
      { path: "traces/:spaceId/:repo", element: <TraceRoute /> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "files", loader: filesLoader, element: <FilesRoute />, shouldRevalidate: filesShouldRevalidate },
      { path: "files/*", loader: filesLoader, element: <FilesRoute />, shouldRevalidate: filesShouldRevalidate },
      { id: PANE_ROUTE_ID, path: "pane/:paneId", loader: paneLoader, element: <DetailRoute /> },
      {
        path: "pane/:paneId/history",
        loader: historyLoader,
        element: <HistoryRoute />,
        // Opt OUT of the poll loop. revalidate() re-runs every active loader, and a transcript can be
        // hundreds of turns — re-pulling it every 1.5s would be pure waste. History is fetched on
        // navigation; freshness is handled in-view via status-driven newest-page refresh and direct
        // api calls for older pages.
        shouldRevalidate: () => false,
      },
    ],
  },
]);
