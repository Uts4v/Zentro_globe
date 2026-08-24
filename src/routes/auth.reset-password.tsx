// routes/auth.reset-password.tsx — Django password reset (token from email link)
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { Loader2, Lock, ArrowRight } from "lucide-react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

export const Route = createFileRoute("/auth/reset-password")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: (s.token as string) || "",
  }),
  head: () => ({ meta: [{ title: "Set New Password · Zentro" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      await djangoFetch(apiUrl("/auth/reset-password/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-center justify-center px-5">
        <p className="text-sm text-destructive">Invalid reset link.</p>
        <Link
          to="/auth/forgot-password"
          search={{ redirect: undefined }}
          className="mt-4 text-xs text-ink underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pb-10 pt-10">
      <Link to="/" className="inline-flex items-center text-ink" aria-label="Zentro home">
        <ZentroLogo className="h-7 w-auto" title="" />
      </Link>

      <div className="mt-12">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">New password</p>
        <h1 className="font-display mt-2 text-5xl leading-[1.05] text-ink">
          Set your new
          <br />
          password.
        </h1>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success ? (
        <div className="mt-10 rounded-2xl bg-emerald-50 px-5 py-6 text-center">
          <p className="text-sm font-medium text-emerald-700">Password updated!</p>
          <p className="mt-1 text-xs text-emerald-600">
            You can now sign in with your new password.
          </p>
          <Link
            to="/auth"
            search={{ redirect: undefined }}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 text-xs font-medium text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-10 space-y-3">
          {(["New password", "Confirm password"] as const).map((label, i) => (
            <label key={label} className="block">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </span>
              <div className="relative mt-1.5">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  type="password"
                  placeholder="••••••••"
                  required
                  value={i === 0 ? password : confirm}
                  onChange={(e) =>
                    i === 0 ? setPassword(e.target.value) : setConfirm(e.target.value)
                  }
                  className="h-14 w-full rounded-2xl bg-mist pl-11 pr-4 text-sm text-ink outline-none transition-all placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ember/40"
                />
              </div>
            </label>
          ))}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 grid h-14 w-full place-items-center rounded-2xl bg-ink text-sm font-medium text-primary-foreground shadow-ember transition-all hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <span className="flex items-center gap-2">
                Update password <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
