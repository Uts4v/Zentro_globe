// Cache names shared by the service worker (which serves from them) and the
// POS (which fills them ahead of time so it can be reopened offline).
export const STATIC_CACHE = "zentro-static-v1";
export const NAVIGATION_CACHE = "zentro-navigations-v1";
