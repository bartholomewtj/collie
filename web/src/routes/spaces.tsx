import { useState } from "react";
import { useNavigate, useRevalidator, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { SpaceOverview } from "@/components/space-overview";
import { NewSpaceSheet } from "@/components/new-space-sheet";
import { StatusArea } from "@/components/status-area";
import { BuildStamp } from "@/components/build-stamp";
import { UpdateBanner } from "@/components/update-banner";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { useSpaceActions } from "@/hooks/use-spaces";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { spacePath } from "@/lib/nav";
import { isReadOnly } from "@/lib/types";

// Spaces — the bottom bar's second destination: every Herdr workspace, recency-ordered and
// filterable, each drilling into /space/:id. It used to be the last, foldable section of the
// dashboard; as its own screen the list is the page, so it never folds.
export function SpacesRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const stalled = useLoadingStalled();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { newSpace } = useSpaceActions();
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} stalled={stalled} wordmark />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ReadOnlyBanner device={data.device} />
        <main className="flex-1">
          <SpaceOverview
            workspaces={data.workspaces}
            agents={data.agents}
            shellPanes={data.shellPanes}
            onOpen={(id) => navigate(spacePath(id, data.session))}
            onNewSpace={() => setNewSpaceOpen(true)}
            session={data.session}
            readOnly={isReadOnly(data.device)}
            onRenamed={() => revalidator.revalidate()}
          />
        </main>
        <UpdateBanner className="px-3 pt-3" />
        <BuildStamp className="px-3 pt-3 pb-3" />
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_4rem)]">
        <StatusArea />
      </div>

      <NewSpaceSheet open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreate={newSpace} />
    </div>
  );
}
