import { createFileRoute } from "@tanstack/react-router";
import PreparationAreaScreen from "@/features/preparation/screens/PreparationAreaScreen";

export const Route = createFileRoute("/pos/preparation/$areaId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { areaId } = Route.useParams();
  return <PreparationAreaScreen areaId={Number(areaId)} />;
}
