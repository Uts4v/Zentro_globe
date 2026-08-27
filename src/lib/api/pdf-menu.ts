import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

export interface PdfMenuInfo {
  has_pdf: boolean;
  pdf_url: string | null;
  pdf_menu_token: string;
  pdf_menu_page_url: string;
}

export interface PublicPdfPage {
  index: number;
  url: string;
}

export interface PublicPdfMenuResolution {
  merchant: {
    id: number;
    name: string;
    slug: string;
    logo: string | null;
    address?: string | null;
    phone?: string | null;
  };
  has_pdf: boolean;
  pdf_url: string | null;
  pages: PublicPdfPage[];
}

export const pdfMenuApi = {
  fetch: async (): Promise<PdfMenuInfo> => {
    return djangoFetch<PdfMenuInfo>(apiUrl("/merchants/pdf-menu/"), {
      headers: authHeaders(),
    });
  },

  upload: async (file: File): Promise<PdfMenuInfo> => {
    const form = new FormData();
    form.append("file", file);
    return djangoFetch<PdfMenuInfo>(apiUrl("/merchants/pdf-menu/"), {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
  },

  remove: async (): Promise<PdfMenuInfo> => {
    return djangoFetch<PdfMenuInfo>(apiUrl("/merchants/pdf-menu/"), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  resolve: async (slug: string, token: string): Promise<PublicPdfMenuResolution> => {
    return djangoFetch<PublicPdfMenuResolution>(
      apiUrl(`/merchants/public/${encodeURIComponent(slug)}/pdf-menu/${encodeURIComponent(token)}/`),
    );
  },
};