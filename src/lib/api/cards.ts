import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type {
  MembershipCardDesign,
  MembershipCard,
  MembershipQrToken,
  MembershipQrResolve,
} from "./types";

export const merchantCardDesignApi = {
  get: async (): Promise<MembershipCardDesign> => {
    return djangoFetch<MembershipCardDesign>(apiUrl("/loyalty/merchant/card-design/"), {
      headers: authHeaders(),
    });
  },

  update: async (data: Partial<MembershipCardDesign>): Promise<MembershipCardDesign> => {
    return djangoFetch<MembershipCardDesign>(apiUrl("/loyalty/merchant/card-design/"), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  publish: async (): Promise<MembershipCardDesign> => {
    return djangoFetch<MembershipCardDesign>(apiUrl("/loyalty/merchant/card-design/publish/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
  },
};

export const membershipCardApi = {
  list: async (): Promise<MembershipCard[]> => {
    return djangoFetch<MembershipCard[]>(apiUrl("/loyalty/membership-cards/"), {
      headers: authHeaders(),
    });
  },

  getQr: async (merchantSlug: string): Promise<MembershipQrToken> => {
    return djangoFetch<MembershipQrToken>(
      apiUrl(`/customer/memberships/${encodeURIComponent(merchantSlug)}/qr/`),
      { headers: authHeaders() },
    );
  },

  rotateQr: async (merchantSlug: string): Promise<MembershipQrToken> => {
    return djangoFetch<MembershipQrToken>(
      apiUrl(`/customer/memberships/${encodeURIComponent(merchantSlug)}/qr/`),
      {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({}),
      },
    );
  },

  getMembershipDetail: async (merchantSlug: string) => {
    return djangoFetch<any>(apiUrl(`/customer/memberships/${encodeURIComponent(merchantSlug)}/`), {
      headers: authHeaders(),
    });
  },
};

export const publicQrApi = {
  resolve: async (token: string): Promise<MembershipQrResolve> => {
    return djangoFetch<MembershipQrResolve>(apiUrl(`/loyalty/qr/${encodeURIComponent(token)}/`));
  },
};
