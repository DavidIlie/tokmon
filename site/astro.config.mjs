import { defineConfig } from "astro/config";

// Static marketing site. `output: "static"` emits plain HTML/CSS/JS into
// dist/, deployable to any static host (Vercel included). PORT lets the dev
// and preview servers honour a caller-supplied port for CI smoke checks.
export default defineConfig({
  output: "static",
  server: {
    port: Number(process.env.PORT ?? 4321),
    host: false,
  },
});
