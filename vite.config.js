import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Config Vite + PWA pour l'app VCDS Database
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "VCDS",
        short_name: "VCDS",
        description: "Guide de procédures VCDS / VAG-COM (VW · Audi · Seat · Skoda)",
        theme_color: "#0a0e1a",
        background_color: "#0a0e1a",
        display: "standalone",
        orientation: "portrait",
        lang: "fr",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Les JSON de données sont volontairement HORS précache : leur
        // fraîcheur est gérée par la couche de sync (src/data/sync.js) +
        // stockage local. NetworkFirst sert le réseau quand il est là,
        // le cache sinon.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        runtimeCaching: [
          {
            urlPattern: /\/data\/[^/]+\.json$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "vcds-data",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8 },
            },
          },
        ],
      },
    }),
  ],
});
