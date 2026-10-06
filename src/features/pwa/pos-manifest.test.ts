/**
 * A staff member installs the POS from `/pos`, so that page has to offer the
 * terminal's own manifest rather than the customer one. Getting this wrong is
 * quiet: the app installs either way, it just opens on a loyalty screen the
 * employee has no account for.
 *
 * Run with: npm run test:pos-manifest
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManifestLink, posManifestFor, rewriteManifestLink } from "./pos-manifest.ts";

const ROOT = "/manifest.webmanifest";
const POS = "/pos/manifest.webmanifest";

test("the terminal serves its own manifest on every POS screen", () => {
  assert.equal(posManifestFor("/pos"), POS);
  assert.equal(posManifestFor("/pos/"), POS);
  assert.equal(posManifestFor("/pos/orders"), POS);
  assert.equal(posManifestFor("/pos/reports/z-report"), POS);
  assert.equal(posManifestFor("/pos/preparation/3"), POS);
});

test("every other page keeps the customer manifest", () => {
  for (const path of ["/", "/cards", "/rewards", "/map", "/merchant", "/auth"]) {
    assert.equal(posManifestFor(path), ROOT, `${path} must not get the terminal manifest`);
  }
});

test("/pos is matched exactly, never as a bare prefix", () => {
  // The regression this guards: a prefix match would hand the terminal's
  // manifest to unrelated routes that happen to start with those letters.
  assert.equal(posManifestFor("/posreports"), ROOT);
  assert.equal(posManifestFor("/pos-archive"), ROOT);
});

test("the rendered link is swapped, not duplicated", () => {
  const html = `<head><link rel="manifest" href="${ROOT}" /><title>x</title></head>`;
  const out = rewriteManifestLink(html, "/pos");

  assert.equal(out, `<head><link rel="manifest" href="${POS}" /><title>x</title></head>`);
  // Two links would be worse than none: a browser takes the first, which would
  // still be the customer manifest.
  assert.equal(out.match(/rel="manifest"/g)?.length, 1);
  assert.equal(out.includes(`href="${ROOT}"`), false);
});

test("a non-POS page is left byte-for-byte alone", () => {
  const html = `<head><link rel="manifest" href="${ROOT}" /></head>`;
  assert.equal(rewriteManifestLink(html, "/cards"), html);
});

test("the link is swapped regardless of attribute order", () => {
  // React renders the tag; the attribute order is not ours to rely on.
  const html = `<head><link href="${ROOT}" rel="manifest"></head>`;
  const out = rewriteManifestLink(html, "/pos");

  assert.ok(out.includes(`href="${POS}"`));
  assert.equal(out.includes(`href="${ROOT}"`), false);
});

test("a document with no manifest link is not corrupted", () => {
  const html = "<head><title>x</title></head>";
  assert.equal(rewriteManifestLink(html, "/pos"), html);
});

// The client-side swap mutates the live document, so it needs a document to
// mutate. Node has none, so each test installs one as `globalThis.document` —
// and calls the real `applyManifestLink`, not a copy of it.
/** A stand-in for HTMLLinkElement that counts how often `href` is written. */
interface FakeLink {
  rel: string;
  href: string;
  writes: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

function fakeLink(rel: string, href = ""): FakeLink {
  const node = { rel, writes: 0 } as FakeLink;
  let current = href;
  const hrefSetter = (v: string) => {
    node.writes++;
    current = v;
  };
  Object.defineProperty(node, "href", {
    get: () => current,
    set: hrefSetter,
    enumerable: true,
  });
  const attrs: Record<string, string> = { rel, href };
  node.getAttribute = (name) => attrs[name] ?? null;
  node.setAttribute = (name, value) => {
    attrs[name] = value;
    if (name === "href") hrefSetter(value);
  };
  return node;
}

function fakeDocument(existingHref?: string) {
  const links = existingHref === undefined ? [] : [fakeLink("manifest", existingHref)];
  const document = {
    links,
    head: {
      appendChild(node: FakeLink) {
        links.push(node);
      },
    },
    createElement: () => fakeLink(""),
    querySelector: () => links[0] ?? null,
  };
  (globalThis as { document?: unknown }).document = document;
  return document;
}

/** Calls the real function and reports what it did. */
function apply(pathname: string) {
  const doc = globalThis.document as unknown as ReturnType<typeof fakeDocument>;
  const before = doc.links[0]?.writes ?? 0;
  applyManifestLink(pathname);
  return {
    href: doc.links[0]?.href,
    rel: doc.links[0]?.rel,
    count: doc.links.length,
    writes: (doc.links[0]?.writes ?? 0) - before,
  };
}

test("client-side navigation into the POS swaps the live link", () => {
  fakeDocument(ROOT);
  const result = apply("/pos");

  assert.equal(result.href, POS);
  assert.equal(result.count, 1, "no second link may be added");
});

test("navigating back out of the POS restores the customer manifest", () => {
  fakeDocument(ROOT);
  apply("/pos");
  const result = apply("/cards");

  assert.equal(result.href, ROOT);
  assert.equal(result.count, 1);
});

test("a document with no manifest link gets one rather than none", () => {
  fakeDocument();
  const result = apply("/pos");

  assert.equal(result.href, POS);
  assert.equal(result.rel, "manifest");
  assert.equal(result.count, 1);
});

test("the href is only written when it actually changes", () => {
  fakeDocument(POS);
  assert.equal(apply("/pos").writes, 0, "no-op write on an unchanged manifest");

  fakeDocument(ROOT);
  assert.equal(apply("/pos").writes, 1);
});

test("no document means no crash — SSR renders nothing here", () => {
  delete (globalThis as { document?: unknown }).document;
  assert.doesNotThrow(() => applyManifestLink("/pos"));
});
