// C:\Users\ACER\Desktop\NTE Loyalty\zentro-glow-loyalty\src\routes\missions.tsx
import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";
import { MissionsPage } from "@/features/loyalty-engine/pages/MissionsPage";

export const Route = createFileRoute("/missions")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Missions · Zentro" }] }),
  component: MissionsPage,
});
