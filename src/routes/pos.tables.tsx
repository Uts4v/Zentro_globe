import { createFileRoute } from "@tanstack/react-router";
import TablesPage from "@/features/pos/screens/TablesPage";

export const Route = createFileRoute("/pos/tables")({
  component: TablesPage,
});
