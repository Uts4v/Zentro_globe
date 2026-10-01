// src/features/team/access.tsx
// Who is acting (the owner or an employee in staff mode) and what they may
// do. This only tailors what the UI shows — the server enforces every rule.
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { teamApi, type Access } from "@/lib/api";
import { staffSession } from "@/lib/staff-session";

export function useStaffToken(): string {
  return useSyncExternalStore(
    staffSession.subscribe,
    () => staffSession.get()?.token ?? "",
    () => "",
  );
}

export type Perm = string | string[];

export function useAccess() {
  const token = useStaffToken();
  const query = useQuery({
    queryKey: ["access", token],
    queryFn: teamApi.me,
    // Role changes should show up promptly without a new sign-in.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: token ? 60_000 : false,
  });
  const access: Access | undefined = query.data;
  const can = (perm: Perm | undefined) => {
    if (!perm) return true;
    if (!access) return false;
    const wanted = Array.isArray(perm) ? perm : [perm];
    return wanted.some((code) => access.permissions.includes(code));
  };
  return {
    access,
    can,
    isStaff: access?.mode === "staff",
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function NoAccess({ links = [] }: { links?: { to: string; label: string }[] }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-3xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-semibold text-foreground">
        You don't have access to this page.
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Contact your administrator if you need access.
      </p>
      {links.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to as never}
              className="inline-flex h-11 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground hover:border-primary/40"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
