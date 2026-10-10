import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { refundStyle, refundMarkup } from "../src/ui-design.js";
import { pickupStyle, pickupMarkup } from "../src/pickup-design.js";
import { workbenchStyle, localPickerMarkup } from "../src/workbench-design.js";

await mkdir(new URL("../dist/assets/", import.meta.url), { recursive: true });
await build({ entryPoints: ["src/ui/ag-ui.ts", "src/ui/a2ui.ts", "src/ui/host.ts", "src/ui/workbench.ts"], outdir: "dist/assets", bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true });
const app = await build({ entryPoints: ["src/ui/app.ts"], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false, minify: true });
const productImage = `data:image/png;base64,${(await readFile("assets/mac-mini.png")).toString("base64")}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><style>*{box-sizing:border-box}body{margin:0;padding:0;background:transparent;font:15px/1.8 system-ui,-apple-system,"PingFang SC",sans-serif}${refundStyle}</style></head><body>${refundMarkup(productImage)}<script type="module">${app.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile("dist/refund-app.html", html);
for (const [entry, filename, css, markup] of [
  ["src/ui/pickup-app.ts", "pickup-app.html", pickupStyle, pickupMarkup()],
  ["src/ui/workbench-app.ts", "workbench-app.html", `${refundStyle}${workbenchStyle}`, `<main class="wb-inner"><p class="wb-app-label">MCP APP · A2UI RENDERER INSIDE</p>${localPickerMarkup}<section id="surface"></section><p id="status" class="wb-feedback" role="status">等待宿主提供任务…</p><img id="product-data" src="${productImage}" alt="" hidden></main>`],
]) {
  const bundle = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false, minify: true });
  const singlefile = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><style>*{box-sizing:border-box}body{margin:0;background:transparent;font:14px/1.8 system-ui,-apple-system,"PingFang SC",sans-serif;color:#183449}[hidden]{display:none!important}${css}</style></head><body>${markup}<script type="module">${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await writeFile(`dist/${filename}`, singlefile);
}
console.log("已生成原三页与下篇协作入口、三个单文件 MCP Apps");
