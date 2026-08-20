import { useEffect } from "react";
import { useNavigate, useParams, useRouteLoaderData } from "react-router";

import { useDashPrefs } from "@/hooks/use-dash-prefs";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath } from "@/lib/nav";

// Redirect /spaces → /
export function SpacesRedirect() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const navigate = useNavigate();

  useEffect(() => {
    navigate(homePath(data?.session), { replace: true });
  }, [navigate, data?.session]);

  return null;
}

// Redirect /space/:spaceId → / with that space expanded first
export function SpaceRedirect() {
  const { spaceId = "" } = useParams();
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const navigate = useNavigate();
  const { expandSpace } = useDashPrefs();

  useEffect(() => {
    if (spaceId) {
      expandSpace(spaceId);
    }
    navigate(homePath(data?.session), { replace: true });
  }, [spaceId, expandSpace, navigate, data?.session]);

  return null;
}
