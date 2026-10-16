import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "browser",
  format: "cjs",
  target: "chrome100",
  external: ["obsidian", "fs", "http", "os", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
  loader: { ".txt": "text" },
  minify: true,
  treeShaking: true,
});
