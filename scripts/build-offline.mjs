import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { themeBootstrap } from "../src/lib/theme-bootstrap.js";
const result = await build({
  entryPoints: ["src/offline/dumps.jsx"],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  target: ["es2022"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": "./src" },
});
const css = (
  await Promise.all(
    ["home", "concepts", "dumps", "account", "assistant", "theme", "study-layout"].map((name) =>
      readFile(`src/styles/${name}.css`, "utf8"),
    ),
  )
).join("\n");
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#182b44"><title>SAA-C03 문제집</title><style>${css}</style><script>${themeBootstrap}</script></head><body><div id="offline-root"></div><script id="saved-progress" type="application/json">null</script><script>${script}</script></body></html>`;
await mkdir("public/offline", { recursive: true });
await writeFile("public/offline/dumps.html", html);
console.log("Built standalone progress backup.");
