import { createFileRoute } from "@tanstack/react-router";
import PreparationSettingsScreen from "@/features/preparation/screens/PreparationSettingsScreen";

export const Route = createFileRoute("/merchant/preparation")({
  head: () => ({ meta: [{ title: "Preparation · Merchant · Zentro" }] }),
  component: PreparationSettingsScreen,
});
