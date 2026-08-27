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

// Makes the Django API base URL runtime-configurable on the server so deployed
// frontends don't need a build-time bake: set DJANGO_API_BASE_URL (or the
// VITE_DJANGO_API_BASE_URL build var fallback) as a service variable.
async function injectApiBase(response: Response): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    return response;
  }
  const base =
    (typeof process !== "undefined" &&
      (process.env.DJANGO_API_BASE_URL || process.env.VITE_DJANGO_API_BASE_URL)) ||
    "";
  if (!base) return response;

  const html = await response.text();
  const script = `<script>window.__DJANGO_API_BASE__=${JSON.stringify(base.replace(/\/+$/, ""))};</script>`;
  const injected = html.includes("</head>")
    ? html.replace(/<\/head>/, `${script}</head>`)
    : `${html}${script}`;
  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      let response = await handler.fetch(request, env, ctx);
      response = await injectApiBase(response);
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
