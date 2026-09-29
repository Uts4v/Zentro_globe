import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Copy, Link2, Pencil, Plus, TicketPercent } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { merchantOffersApi, type Campaign } from "@/lib/api/offers";
import { CampaignWizard } from "./CampaignWizard";
import { CampaignStatsModal } from "./CampaignStatsModal";

const STATUS_STYLE: Record<Campaign["effective_status"], string> = {
  active: "bg-emerald-100 text-emerald-700",
  scheduled: "bg-sky-100 text-sky-700",
  draft: "bg-mist text-muted-foreground",
  paused: "bg-amber-100 text-amber-800",
  ended: "bg-mist text-muted-foreground",
  archived: "bg-mist text-muted-foreground",
};

export function MerchantOffersPage() {
  const { merchantProfile } = useAuth();
  const currencySymbol = merchantProfile?.currency_symbol || "Rs";
  const queryClient = useQueryClient();
  const campaigns = useQuery({
    queryKey: ["offers", "merchant"],
    queryFn: () => merchantOffersApi.list(),
  });
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [statsFor, setStatsFor] = useState<Campaign | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["offers", "merchant"] });

  async function act(
    c: Campaign,
    action: "publish" | "pause" | "resume" | "end" | "archive" | "duplicate",
  ) {
    let body: Record<string, unknown> = {};
    if (action === "end") {
      if (!confirm(`End "${c.title}"? Customers can't claim it any more.`)) return;
      if (c.claims_count > 0) {
        body = {
          revoke_claims: confirm(
            "Also stop the codes customers already saved?\n\nOK = stop them now\nCancel = let them use it until it expires",
          ),
        };
      }
    }
    setBusyId(c.id);
    try {
      await merchantOffersApi.action(c.id, action, body);
      toast.success(
        {
          publish: "Offer is live.",
          resume: "Offer is live again.",
          pause: "Offer paused.",
          end: "Offer ended.",
          archive: "Offer archived.",
          duplicate: "Copy created as a draft.",
        }[action],
      );
      refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Couldn't update the offer.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(c: Campaign) {
    const url = `${window.location.origin}${c.share_path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      prompt("Copy this link:", url);
    }
  }

  async function removeDraft(c: Campaign) {
    if (!confirm(`Delete draft "${c.title}"?`)) return;
    try {
      await merchantOffersApi.remove(c.id);
      refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  const list = campaigns.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Customers</p>
          <h1 className="font-display mt-1 text-3xl text-foreground sm:text-4xl">Offers</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Create offers customers discover in Zentro, save to My Offers and use online or at your
            counter.
          </p>
        </div>
        <Button onClick={() => setEditing("new")} className="h-11 rounded-2xl px-5">
          <Plus className="h-4 w-4" /> Create offer
        </Button>
      </div>

      {campaigns.isLoading && <p className="text-sm text-muted-foreground">Loading offers…</p>}
      {campaigns.isError && <p className="text-sm text-rose-600">Couldn't load your offers.</p>}
      {!campaigns.isLoading && list.length === 0 && (
        <div className="glass rounded-3xl py-16 text-center">
          <TicketPercent className="mx-auto h-10 w-10 text-ember" />
          <p className="mt-3 text-sm text-muted-foreground">
            No offers yet. Create your first one in under a minute.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((c) => (
          <article
            key={c.id}
            className="rounded-3xl bg-card p-5"
            style={{ border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-foreground">{c.title}</p>
                <p className="font-display text-lg text-ember">{c.summary}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${STATUS_STYLE[c.effective_status]}`}
              >
                {c.effective_status}
              </span>
            </div>
            {c.conditions_text.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{c.conditions_text.join(" · ")}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <b className="text-foreground">{c.claims_count}</b> claimed
                {c.max_claims ? ` / ${c.max_claims}` : ""}
              </span>
              <span>
                <b className="text-foreground">{c.redemptions_count}</b> used
              </span>
              {c.reserved_count > 0 && (
                <span>
                  <b className="text-foreground">{c.reserved_count}</b> in open orders
                </span>
              )}
              {c.ends_at && <span>Ends {new Date(c.ends_at).toLocaleDateString()}</span>}
              {c.visibility === "link_only" && <span className="font-semibold">Private link</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {c.status !== "archived" && c.status !== "ended" && (
                <SmallButton onClick={() => setEditing(c)} icon={Pencil}>
                  Edit
                </SmallButton>
              )}
              {c.status === "draft" && (
                <SmallButton onClick={() => act(c, "publish")} busy={busyId === c.id} primary>
                  Publish
                </SmallButton>
              )}
              {c.status === "published" && (
                <SmallButton onClick={() => act(c, "pause")} busy={busyId === c.id}>
                  Pause
                </SmallButton>
              )}
              {c.status === "paused" && (
                <SmallButton onClick={() => act(c, "resume")} busy={busyId === c.id} primary>
                  Resume
                </SmallButton>
              )}
              {(c.status === "published" || c.status === "paused") && (
                <SmallButton onClick={() => act(c, "end")} busy={busyId === c.id}>
                  End
                </SmallButton>
              )}
              {(c.status === "ended" || (c.status === "draft" && c.claims_count > 0)) && (
                <SmallButton onClick={() => act(c, "archive")} busy={busyId === c.id}>
                  Archive
                </SmallButton>
              )}
              {c.status === "draft" && c.claims_count === 0 && (
                <SmallButton onClick={() => removeDraft(c)}>Delete</SmallButton>
              )}
              <SmallButton onClick={() => act(c, "duplicate")} icon={Copy} busy={busyId === c.id}>
                Duplicate
              </SmallButton>
              {c.status !== "draft" && (
                <SmallButton onClick={() => setStatsFor(c)} icon={BarChart3}>
                  Stats
                </SmallButton>
              )}
              {c.status === "published" && (
                <SmallButton onClick={() => copyLink(c)} icon={Link2}>
                  Share link
                </SmallButton>
              )}
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <CampaignWizard
          campaign={editing === "new" ? null : editing}
          currencySymbol={currencySymbol}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            toast.success(c.status === "published" ? "Offer is live." : "Offer saved.");
            refresh();
          }}
        />
      )}
      {statsFor && (
        <CampaignStatsModal
          campaign={statsFor}
          currencySymbol={currencySymbol}
          onClose={() => setStatsFor(null)}
        />
      )}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  icon: Icon,
  busy,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon?: typeof Copy;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
        primary ? "bg-ink text-primary-foreground" : "bg-mist text-foreground"
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
