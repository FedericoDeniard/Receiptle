import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://receiptle.com",
  i18n: {
    locales: ["es", "en"],
    defaultLocale: "es",
    routing: {
      prefixDefaultLocale: false,
    },
  },
  server: {
    port: 4321,
    host: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      // The landing is proxied through the Bun server in dev, and proxies
      // don't carry websockets: the HMR client talks to this port directly.
      hmr: {
        clientPort: 4321,
      },
    },
  },
});
