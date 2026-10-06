/**
 * Which web app manifest a page should offer.
 *
 * The POS is installed by the people who work the till, and they have no
 * customer account — an icon that opens on the loyalty home screen tells them
 * they are in the wrong place. `/pos` therefore gets its own manifest, whose
 * `start_url` and `scope` are `/pos`, so the installed terminal opens on the
 * till rather than wherever they last were in the app.
 *
 * Matched exactly like the offline allowlist: `/pos` and `/pos/...`, never
 * `/pos` as a bare prefix, or `/posreports` would get the terminal too.
 */

const ROOT_MANIFEST = "/manifest.webmanifest";
const POS_MANIFEST = "/pos/manifest.webmanifest";

export function posManifestFor(pathname: string): string {
  return pathname === "/pos" || pathname.startsWith("/pos/") ? POS_MANIFEST : ROOT_MANIFEST;
}

/**
 * Point an already-rendered document at the right manifest.
 *
 * Done on the server rather than in `__root.tsx` because the root route emits
 * one `<link rel="manifest">` for every page. Adding a second link on the POS
 * routes would leave two in the document, and a browser takes the first — which
 * would be the customer one, making this a no-op.
 */
export function rewriteManifestLink(html: string, pathname: string): string {
  const href = posManifestFor(pathname);
  if (href === ROOT_MANIFEST) return html;
  return html.replace(/<link[^>]*rel="manifest"[^>]*>/, `<link rel="manifest" href="${href}" />`);
}

/**
 * The same swap in the live document, for client-side navigation.
 *
 * The server only rewrites a full page load, so a customer who taps through to
 * the POS without a reload would still be offered the customer manifest. Cheap
 * to keep correct: mutate the one link the root route already rendered rather
 * than adding a second.
 */
export function applyManifestLink(pathname: string): void {
  if (typeof document === "undefined") return;
  const href = posManifestFor(pathname);
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  // No link to reuse (a document rendered without one): create it.
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
