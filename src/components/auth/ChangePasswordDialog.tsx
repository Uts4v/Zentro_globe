// src/components/auth/ChangePasswordDialog.tsx
// Shared "change password" form for both customer and merchant surfaces.
// Posts to POST /api/auth/change-password/ via useAuth().changePassword.

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";

const MIN_LENGTH = 8;

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { changePassword, user } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noUsablePassword, setNoUsablePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  const reset = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setNoUsablePassword(false);
    setReveal(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNoUsablePassword(false);

    if (newPassword.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword === oldPassword) {
      setError("New password must be different from your current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await changePassword(oldPassword, newPassword);
      if (res.error) {
        setError(res.error);
        setNoUsablePassword(Boolean(res.noUsablePassword));
        return;
      }
      toast.success("Password changed successfully");
      handleOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "h-12 w-full rounded-2xl bg-mist pl-4 pr-11 text-sm text-ink outline-none transition-all placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ember/40";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-ink">Change password</DialogTitle>
          <DialogDescription>
            Use at least {MIN_LENGTH} characters. You'll stay signed in on this device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Current password
            </span>
            <div className="relative mt-1.5">
              <input
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
                disabled={noUsablePassword}
                className={inputClass}
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              New password
            </span>
            <div className="relative mt-1.5">
              <input
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={noUsablePassword}
                className={inputClass}
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Confirm new password
            </span>
            <div className="relative mt-1.5">
              <input
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={noUsablePassword}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide passwords" : "Show passwords"}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink"
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {error && (
            <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {noUsablePassword && (
            <Link
              to="/auth/forgot-password"
              className="block text-center text-sm font-medium text-ember hover:underline"
            >
              Set a password via email reset
            </Link>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="h-12 flex-1 rounded-2xl bg-mist text-sm font-medium text-ink transition-opacity hover:opacity-80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || noUsablePassword}
              className="h-12 flex-1 rounded-2xl bg-ink text-sm font-medium text-primary-foreground shadow-ember transition-all hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Update password"}
            </button>
          </DialogFooter>
        </form>

        {user?.has_usable_password === false && (
          <p className="text-xs text-muted-foreground">
            You signed up with Google, so you don't have a password yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
