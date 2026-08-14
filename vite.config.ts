// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// SELF-HOST NOTE: to build for a Node VPS instead of Cloudflare Workers,
// set env `SELF_HOSTED=1` when running `bun run build`. This switches the
// nitro preset to `node-server`, producing `.output/server/index.mjs` you
// can run with `node .output/server/index.mjs` (or PM2).
const selfHosted = process.env.SELF_HOSTED === "1";

// Load ALL env vars (no prefix) into process.env for server-side code only.
// These are NOT injected into the client bundle.
const serverEnv = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

export default defineConfig({
  nitro: selfHosted ? { preset: "node-server" } : undefined,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this.
    server: {
      entry: "server",
    },
  },
  vite: {
    resolve: {
      alias: [
        {
          find: /^entities\/lib\/esm\/(.*)\.js$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/$1.js"),
        },
        {
          find: /^entities\/lib\/(.*)\.js$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/$1.js"),
        },
        {
          find: /^entities\/lib\/esm\/(.*)$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/$1.js"),
        },
        {
          find: /^entities\/lib\/(.*)$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/$1.js"),
        },
        {
          find: /^entities\/(.*)\.js$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/$1.js"),
        },
        {
          find: /^entities\/(.*)$/,
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/$1.js"),
        },
        {
          find: "entities",
          replacement: path.resolve(process.cwd(), "node_modules/entities/lib/esm/index.js"),
        },
      ],
      extensions: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".json"],
    },
  },
});
