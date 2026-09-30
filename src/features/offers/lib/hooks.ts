import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { offersApi, type OfferClaim, type PublicOffer } from "@/lib/api/offers";

export type WalletTab = "available" | "used" | "expired";

export function useOfferCategories() {
  return useQuery({
    queryKey: ["offers", "categories"],
    queryFn: offersApi.categories,
    staleTime: 3_600_000,
  });
}

export function useOfferAreas() {
  return useQuery({ queryKey: ["offers", "areas"], queryFn: offersApi.areas, staleTime: 600_000 });
}

/** One wallet tab. Shares its cache with the Offers header count and the wallet page. */
export function useMyOffers(tab: WalletTab, enabled = true) {
  return useQuery({
    queryKey: ["offers", "mine", tab],
    queryFn: () => offersApi.mine(tab),
    enabled,
  });
}

/**
 * Save an offer to the wallet (or fetch the voucher already saved). Signed-out
 * visitors go to login and come back to `returnTo`; failures show a retry toast.
 */
export function useClaimOffer(returnTo: string) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function claim(
    offer: Pick<PublicOffer, "id" | "my_claim_id">,
    linkToken?: string,
  ): Promise<{ claim: OfferClaim; created: boolean } | null> {
    if (!user) {
      navigate({ to: "/auth/login", search: { redirect: returnTo } });
      return null;
    }
    if (user.role !== "customer") {
      toast.error("Offers are saved with a customer account.");
      return null;
    }
    setPendingId(offer.id);
    try {
      const existing = offer.my_claim_id ?? null;
      const result = existing
        ? await offersApi.myClaim(existing)
        : await offersApi.claim(offer.id, linkToken);
      if (!existing) queryClient.invalidateQueries({ queryKey: ["offers"] });
      return { claim: result, created: !existing };
    } catch (e: unknown) {
      toast.error((e as Error).message || "We couldn't save this offer.", {
        action: { label: "Try again", onClick: () => void claim(offer, linkToken) },
      });
      return null;
    } finally {
      setPendingId(null);
    }
  }

  return { claim, pendingId };
}
