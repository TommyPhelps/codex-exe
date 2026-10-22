// Bundles the UI with esbuild into dist/ (served by Tauri). No dev server is
// needed: `npm run dev` rebuilds on change and Tauri reloads the window.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, process.env.CODEX_OUT || "dist");
const watch = process.argv.includes("--watch");
const preview = process.argv.includes("--preview");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const options = {
  entryPoints: [resolve(root, "src/main.tsx")],
  bundle: true,
  outdir: out,
  format: "esm",
  target: "chrome110",
  jsx: "automatic",
  minify: !watch && !preview,
  sourcemap: watch || preview ? "inline" : false,
  define: { "process.env.NODE_ENV": watch || preview ? '"development"' : '"production"' },
  loader: { ".ttf": "file", ".woff2": "file", ".svg": "file" },
  assetNames: "assets/[name]-[hash]",
  legalComments: "none",
  logLevel: "info",
};

writeFileSync(resolve(out, "index.html"), readFileSync(resolve(root, "index.html"), "utf8"));
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching src/ ...");
} else {
  await esbuild.build(options);
  cpSync(resolve(root, "assets/fonts/LICENSES"), resolve(out, "assets/font-licenses"), { recursive: true });
}
