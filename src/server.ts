import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Makes runtime config configurable on the server so deployed frontends don't
// require a full rebuild whenever environment variables change: supports
// DJANGO_API_BASE_URL/VITE_DJANGO_API_BASE_URL and VITE_GOOGLE_CLIENT_ID/GOOGLE_OAUTH_CLIENT_IDS.
async function injectRuntimeConfig(response: Response): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    return response;
  }
  const base =
    (typeof process !== "undefined" &&
      (process.env.DJANGO_API_BASE_URL || process.env.VITE_DJANGO_API_BASE_URL)) ||
    "";
  const googleClientId =
    (typeof process !== "undefined" &&
      (process.env.VITE_GOOGLE_CLIENT_ID ||
        process.env.GOOGLE_CLIENT_ID ||
        process.env.GOOGLE_OAUTH_CLIENT_IDS)) ||
    "";

  const headers = new Headers(response.headers);
  // Allow Google OAuth popup window to communicate back with the opener via postMessage
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");

  const html = await response.text();
  let scripts = "";
  if (base) {
    scripts += `<script>window.__DJANGO_API_BASE__=${JSON.stringify(base.replace(/\/+$/, ""))};</script>`;
  }
  if (googleClientId) {
    scripts += `<script>window.__GOOGLE_CLIENT_ID__=${JSON.stringify(googleClientId.trim())};</script>`;
  }

  const injected = html.includes("</head>")
    ? html.replace(/<\/head>/, `${scripts}</head>`)
    : `${html}${scripts}`;
  return new Response(injected, {
    status: response.status,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      let response = await handler.fetch(request, env, ctx);
      response = await injectRuntimeConfig(response);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
