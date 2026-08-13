// routes/auth.signup.tsx — Customer sign-up only
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Loader2, Mail, Lock, User } from "lucide-react";

export const Route = createFileRoute("/auth/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: (search.redirect as string) || undefined,
  }),
  head: () => ({ meta: [{ title: "Customer Sign Up · Zentro" }] }),
  component: CustomerSignup,
});

function CustomerSignup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth/signup" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const { error: err } = await signUp(email, password, name, { role: "customer", confirmPassword });
      if (err) {
        setError(err);
        return;
      }
      navigate({ to: (redirect || "/") as any, replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pb-10 pt-10">
      <Link to="/" className="font-display text-2xl text-ink">
        zentro<span className="text-ember">.</span>
      </Link>

      <div className="mt-12">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">New here</p>
        <h1 className="font-display mt-2 text-5xl leading-[1.05] text-ink">Join the loyalty club.</h1>
        <p className="mt-3 max-w-[300px] text-sm text-muted-foreground">Earn from your first order. No card needed.</p>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="mt-10 space-y-3">
        <Field label="Name" placeholder="Maya Rivera" icon={<User className="h-4 w-4" />} value={name} onChange={setName} />
        <Field label="Email" placeholder="you@maison.com" type="email" icon={<Mail className="h-4 w-4" />} value={email} onChange={setEmail} />
        <Field label="Password" placeholder="••••••••" type="password" icon={<Lock className="h-4 w-4" />} value={password} onChange={setPassword} />
        <Field label="Confirm password" placeholder="••••••••" type="password" icon={<Lock className="h-4 w-4" />} value={confirmPassword} onChange={setConfirmPassword} />

        <button
          type="submit"
          disabled={busy}
          className="mt-6 grid h-14 w-full place-items-center rounded-2xl bg-ink text-sm font-medium text-primary-foreground shadow-ember transition-all hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create account"}
        </button>
      </form>

      <p className="mt-auto pt-8 text-center text-xs text-muted-foreground">
        Already have an account? <Link to="/auth/login" search={{ redirect: undefined }} className="font-medium text-ink underline-offset-4 hover:underline">Sign in</Link>
      </p>

      <Link to="/auth/merchant/signup" search={{ redirect: undefined }} className="mt-3 block text-center text-xs text-muted-foreground hover:text-ink hover:underline">
        Register your business →
      </Link>
    </div>
  );
}

function Field({ label, placeholder, type = "text", icon, value, onChange }: {
  label: string;
  placeholder: string;
  type?: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <div className="relative mt-1.5">
        {icon && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className={`h-14 w-full rounded-2xl bg-mist text-sm text-ink outline-none transition-all placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ember/40 ${icon ? "pl-11" : "px-4"} pr-4`}
        />
      </div>
    </label>
  );
}
