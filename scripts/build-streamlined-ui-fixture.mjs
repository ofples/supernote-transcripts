import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const platformArg = process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1] ?? "desktop";
if (platformArg !== "desktop" && platformArg !== "nomad") throw new Error("Use --platform=desktop or --platform=nomad");
const output = resolve("private/ux-streamline/build", platformArg);
await mkdir(output, { recursive: true });
const obsidianMock = `
const extend=(p,n,f)=>{if(!p[n])Object.defineProperty(p,n,{value:f,configurable:true})};
extend(Element.prototype,"createEl",function(tag,opts={}){const n=document.createElement(tag);if(opts.text!==undefined)n.textContent=opts.text;if(opts.cls)n.className=opts.cls;if(opts.type)n.type=opts.type;if(opts.placeholder)n.setAttribute("placeholder",opts.placeholder);if(opts.attr)for(const[k,v]of Object.entries(opts.attr))n.setAttribute(k,String(v));this.appendChild(n);return n});
extend(Element.prototype,"empty",function(){this.replaceChildren()});extend(Element.prototype,"addClass",function(...n){this.classList.add(...n)});extend(Element.prototype,"removeClass",function(...n){this.classList.remove(...n)});extend(Element.prototype,"hasClass",function(n){return this.classList.contains(n)});extend(Element.prototype,"toggleClass",function(n,v){this.classList.toggle(n,v)});
export class Modal{constructor(app){this.app=app;this.modalEl=document.createElement("div");this.modalEl.className="modal-container";this.contentEl=document.createElement("div");this.contentEl.className="modal-content";this.modalEl.appendChild(this.contentEl)}open(){document.body.appendChild(this.modalEl);this.onOpen?.()}close(){this.onClose?.();this.modalEl.remove()}}
export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=document.createElement("div")}}
export class Notice{constructor(message){(window.__streamlinedFixtureNotices||[]).push(String(message))}}
export function setIcon(element,name){element.dataset.icon=name;element.querySelectorAll('[aria-hidden="true"]').forEach(icon=>icon.remove());const icon=document.createElement("span");icon.setAttribute("aria-hidden","true");icon.textContent=name==="x"?"×":name==="pause"?"Ⅱ":name==="play"?"▶":name==="settings"?"⚙":name==="dollar-sign"?"$":name==="arrow-left"?"←":name==="arrow-up-to-line"?"↑":name==="chevron-right"?"›":name==="chevron-down"?"⌄":name==="folder"?"▰":name==="file-text"?"▤":"•";element.appendChild(icon)}
`;
await build({
  entryPoints: ["scripts/streamlined-ui-fixture.ts"], bundle: true, outfile: resolve(output, "fixture.js"),
  platform: "browser", format: "iife", globalName: "StreamlinedFixtureBundle", target: "chrome120", sourcemap: true,
  define: { FIXTURE_PLATFORM: JSON.stringify(platformArg) },
  plugins: [{ name: "obsidian-local-mock", setup(builder) { builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-mock", namespace: "fixture" })); builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: obsidianMock, loader: "js" })); } }],
});
await copyFile("styles.css", resolve(output, "styles.css"));
const hostCss = `:root{--background-primary:#fff;--background-secondary:#f6f6f4;--background-modifier-border:#d4d4d0;--text-normal:#262626;--text-muted:#686868;--text-faint:#858585;--interactive-accent:#3b6f61;--interactive-accent-hover:#335f54;--background-modifier-form-field:#fff;--font-text-size:16px;--font-interface:Inter,Segoe UI,sans-serif}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:var(--font-interface);color:var(--text-normal);background:#ecece8}body{padding:24px}button,input,textarea,select{font:inherit}.modal-container{position:fixed;inset:16px;background:var(--background-primary);border:1px solid var(--background-modifier-border);box-shadow:0 10px 34px #0002;display:flex;overflow:hidden}.modal-content{width:100%;height:100%;display:flex;overflow:hidden}.st-icon-button{font-size:16px}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Streamlined UI fixture (${platformArg})</title><style>${hostCss}</style><link rel="stylesheet" href="styles.css"></head><body><script src="fixture.js"></script><script>new StreamlinedFixtureBundle.default().onload().then(()=>window.__bootStreamlinedFixture())</script></body></html>`;
await writeFile(resolve(output, "index.html"), html);
console.log(JSON.stringify({ platform: platformArg, output, fixture: resolve(output, "fixture.js"), syntheticOnly: true, network: false }));



