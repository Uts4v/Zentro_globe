import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  nitro: {
    preset: "node-server",
    publicAssets: [{ dir: "dist" }],
  } as any,
  tanstackStart: {
    server: {
      entry: "server",
    },
  },
  vite: {
    server: {
      allowedHosts: [".devtunnels.ms"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react-dom")) return "vendor-react-dom";
            if (id.includes("node_modules/react/")) return "vendor-react";
            if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
            if (id.includes("node_modules/@tanstack/react-query") || id.includes("node_modules/@tanstack/react-router")) return "vendor-tanstack";
          },
        },
      },
    },
    plugins: [
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "service-worker.ts",
        registerType: "prompt",
        injectRegister: false,

        manifest: {
          id: "/",
          name: "Zentro — Order & Loyalty",
          short_name: "Zentro",
          description:
            "Your memberships, rewards, orders and loyalty points in one place.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
          orientation: "portrait",
          background_color: "#FAF7F2",
          theme_color: "#FA6A4A",
          lang: "en",
          categories: ["shopping", "food", "lifestyle"],
          icons: [
            {
              src: "/icons/pwa-192x192.svg",
              sizes: "192x192",
              type: "image/svg+xml",
              purpose: "any",
            },
            {
              src: "/icons/pwa-512x512.svg",
              sizes: "512x512",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
          shortcuts: [
            {
              name: "My Cards",
              short_name: "Cards",
              url: "/cards?source=shortcut",
              description: "View your membership cards",
            },
            {
              name: "Discover",
              short_name: "Discover",
              url: "/map?source=shortcut",
              description: "Find nearby stores",
            },
            {
              name: "Rewards",
              short_name: "Rewards",
              url: "/rewards?source=shortcut",
              description: "View your rewards",
            },
          ],
          screenshots: [],
        },

        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-cache",
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "gstatic-fonts-cache",
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },

        devOptions: {
          enabled: false,
        },
      }),
    ],
  },
});
