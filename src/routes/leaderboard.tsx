import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/features/loyalty-engine/pages/LeaderboardPage";
import { requireAuth } from "@/lib/auth-guard";

export const Route = createFileRoute("/leaderboard")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Leaderboard · Zentro" }] }),
  component: LeaderboardPage,
});
