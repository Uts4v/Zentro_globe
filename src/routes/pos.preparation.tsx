import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import PreparationAreaListPage from "@/features/preparation/screens/PreparationAreaListPage";

export const Route = createFileRoute("/pos/preparation")({
  component: RouteComponent,
});

function RouteComponent() {
  const { location } = useRouterState();
  const isChildActive = location.pathname !== "/pos/preparation";

  if (isChildActive) return <Outlet />;
  return <PreparationAreaListPage />;
}
