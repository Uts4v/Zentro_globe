// routes/auth.forgot-password.tsx — Django password reset
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { Loader2, Mail, ArrowLeft, ArrowRight } from "lucide-react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => ({ meta: [{ title: "Reset Password · Zentro" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await djangoFetch(apiUrl("/auth/forgot-password/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pb-10 pt-10">
      <Link to="/" className="inline-flex items-center text-ink" aria-label="Zentro home">
        <ZentroLogo className="h-7 w-auto" title="" />
      </Link>

      <button
        type="button"
        onClick={() => navigate({ to: "/auth", search: {} as any })}
        className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>

      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Password reset
        </p>
        <h1 className="font-display mt-2 text-5xl leading-[1.05] text-ink">Can't log in?</h1>
        <p className="mt-3 max-w-[300px] text-sm text-muted-foreground">
          We'll send you a link to reset your password. Check your inbox after submitting.
        </p>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success ? (
        <div className="mt-10 rounded-2xl bg-emerald-50 px-5 py-6 text-center">
          <p className="text-sm font-medium text-emerald-700">Check your inbox</p>
          <p className="mt-1 text-xs text-emerald-600">
            We sent a password reset link to <strong>{email}</strong>. It may take a minute to
            arrive.
          </p>
          <Link
            to="/auth"
            search={{ redirect: undefined }}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 text-xs font-medium text-primary-foreground"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-10 space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Email
            </span>
            <div className="relative mt-1.5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Mail className="h-4 w-4" />
              </span>
              <input
                type="email"
                placeholder="you@maison.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-14 w-full rounded-2xl bg-mist pl-11 pr-4 text-sm text-ink outline-none transition-all placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ember/40"
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="mt-6 grid h-14 w-full place-items-center rounded-2xl bg-ink text-sm font-medium text-primary-foreground shadow-ember transition-all hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <span className="flex items-center gap-2">
                Send reset link <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
