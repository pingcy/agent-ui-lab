import { refundStyle, refundMarkup } from "./ui-design.js";
import { workbenchStyle, localPickerMarkup } from "./workbench-design.js";

export const style = `
*{box-sizing:border-box}body{margin:0;background:#f4f7f8;color:#183449;font:15px/1.8 system-ui,-apple-system,"PingFang SC",sans-serif}main{max-width:960px;margin:32px auto 60px;padding:0 32px}a{color:#087b71}h1{font-size:30px;line-height:1.4;letter-spacing:-.4px;margin:12px 0}h2{font-size:20px}p{margin:14px 0}.app-bar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 0 22px;border-bottom:1px solid #dce6e7}.brand{display:flex;align-items:center;gap:10px;color:#183449;font-size:13px;font-weight:600;letter-spacing:1.4px}.brand-mark{width:22px;height:22px;display:grid;grid-template-columns:repeat(2,1fr);gap:3px}.brand-mark i{background:#183449;border-radius:2px}.brand-mark i:last-child{background:#087b71}nav{display:flex;flex-wrap:wrap;gap:5px}nav a{color:#647a86;text-decoration:none;padding:6px 12px;border:1px solid transparent;border-radius:8px;font-size:13px;line-height:1.8}nav a:hover{background:#e7eeef}nav a[aria-current="page"]{color:#183449;background:#fff;border-color:#dce6e7;box-shadow:0 1px 3px #203b4708}nav a:focus-visible,summary:focus-visible{outline:3px solid #85c5bb;outline-offset:3px}.page-heading{margin:36px 0 26px}.page-kicker{font:11px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;color:#087b71;letter-spacing:1.5px;margin:0}.note{color:#667b86;font-size:13px}.page-heading .note{margin:10px 0;max-width:650px}.agent-answer{font-size:13px;color:#526f77;padding:12px 16px;border-left:2px solid #91c8b9;background:#edf4f1;border-radius:0 8px 8px 0;min-height:49px}.demo-stage{max-width:700px;margin:0 auto}.stage-label{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 12px;font-size:12px;color:#667b86}.stage-label strong{color:#183449;font-weight:500}.stage-label code{font-size:10px;color:#6b808a}.card{background:white;border:1px solid #dce6e7;border-radius:16px;padding:24px;margin:20px 0}button{background:#087b71;color:white;border:0;border-radius:9px;padding:11px 20px;font-size:15px;min-height:44px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}button:focus-visible{outline:3px solid #85c5bb;outline-offset:3px}button p{margin:0}pre{background:#172b38;color:#dce8ef;padding:20px;border-radius:12px;overflow:auto;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;margin:16px 0 0}.debug-panel{margin:26px 0 0;border:1px solid #dce6e7;border-radius:12px;background:#fff;overflow:hidden}.debug-panel summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:14px 18px;font-size:12px;color:#526c79}.debug-panel summary::-webkit-details-marker{display:none}.debug-panel summary::after{content:"＋";font-size:17px;color:#7a8e96}.debug-panel[open] summary::after{content:"－"}.debug-panel pre{margin:0;border-radius:0}.debug-panel .note{padding:0 18px}.demo-footnote{margin-top:16px;font-size:11px;line-height:1.8;color:#71838c}#surface:empty{min-height:380px;border:1px dashed #cbd9dd;border-radius:16px;background:#fff}#sandbox{display:block;width:100%;height:650px;border:0;background:transparent;border-radius:18px}#status:empty{display:none}@media(max-width:600px){main{margin:22px auto 40px;padding:0 18px}.app-bar{align-items:flex-start;flex-direction:column;gap:17px;padding-bottom:19px}nav{width:100%;gap:3px}nav a{padding:5px 9px;font-size:12px}.page-heading{margin:27px 0 23px}h1{font-size:25px}.stage-label{align-items:flex-start;flex-direction:column;gap:3px}.debug-panel summary{padding:13px 15px}pre{font-size:11px;padding:17px}.card{padding:20px}}${refundStyle}
${workbenchStyle}`;

function nav(active?: string) {
  return `<nav aria-label="示例导航">${[["", "总览"], ["ag-ui", "AG-UI"], ["a2ui", "A2UI"], ["mcp-apps", "MCP Apps"], ["workbench", "下篇 · 协作工作台"]].map(([route, label]) => `<a href="/${route}"${route === (active === "host" ? "mcp-apps" : active ?? "") ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}
export function page(title: string, body: string, script?: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body><main><div class="app-bar"><div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>AGENT UI LAB</div>${nav(script)}</div><header class="page-heading"><p class="page-kicker">ONE AGENT · THREE UI PATHS</p><h1>${title}</h1><p class="note">同一个客服 Agent，三种前端接法。固定示例数据，无外部模型或 API Key。</p></header>${body}</main>${script ? `<script src="/assets/${script}.js" defer></script>` : ""}</body></html>`;
}

export const pages = {
  "/workbench": workbenchPage("combined"),
  "/a2ui-over-mcp": workbenchPage("over-mcp"),
  "/a2ui-in-app": workbenchPage("in-app"),
  "/": page("同一笔订单退款，三种前端接法", `<section class="card"><h2>客服 Agent 已找到订单，等待你确认</h2><p>三个页面使用同一份虚构 Mac mini 订单，分别通过 AG-UI、A2UI 与 MCP Apps 展示订单、接收确认或取消，再返回处理结果。</p><p>每次打开页面会创建一个独立演示任务。确认只会生成模拟退款单，不会触发真实付款或退款。</p><p><a href="/ag-ui">查看运行事件</a> · <a href="/a2ui">查看描述生成的界面</a> · <a href="/mcp-apps">查看工具提供的界面</a></p></section>`),
  "/ag-ui": page("AG-UI：跟随退款任务的进展", `<section class="demo-stage"><div class="stage-label"><strong>客户端固定组件 + 事件状态</strong><code>Agent → SSE → UI</code></div><p class="agent-answer" id="answer" role="status">客服 Agent 正在核对订单…</p>${refundMarkup("/assets/mac-mini.png")}<p class="demo-footnote">本次运行结束后等待确认；点击按钮，以同一个 taskId 发起下一次运行。刷新页面可重新演示。</p><details class="debug-panel"><summary>查看收到的 AG-UI 事件</summary><pre id="events"></pre></details></section>`, "ag-ui"),
  "/a2ui": page("A2UI：按需生成退款确认界面", `<section class="demo-stage"><div class="stage-label"><strong>客户端组件渲染</strong><code>Column / Text / Image / Button</code></div><p class="note" id="status" role="status" aria-live="polite">加载界面描述…</p><section id="surface" aria-label="A2UI 订单退款界面"></section><p class="demo-footnote">卡片由 A2UI 描述生成；确认或取消作为 action 回到同一任务。刷新页面可重新演示。</p><details class="debug-panel"><summary>查看收到的 A2UI 消息</summary><pre id="messages"></pre></details></section>`, "a2ui"),
  "/mcp-apps": page("MCP Apps：工具提供退款确认视图", `<section class="demo-stage"><div class="stage-label"><strong>工具自带界面</strong><code>App → Host → decide_refund</code></div><iframe id="sandbox" title="退款 MCP App 隔离代理" sandbox="allow-scripts allow-same-origin"></iframe><p class="demo-footnote">工具通过单文件 HTML 提供卡片，宿主负责加载、隔离与工具桥接。刷新页面可重新演示。</p><details class="debug-panel"><summary>查看宿主连接与工具记录</summary><p class="note" id="status" role="status">连接本地 MCP 服务…</p><pre id="events"></pre></details></section>`, "host"),
};

function workbenchPage(mode: "combined" | "over-mcp" | "in-app") {
  const title = mode === "combined" ? "一笔退款，三个协议协作" : mode === "over-mcp" ? "A2UI over MCP：宿主绘制界面" : "A2UI in MCP Apps：在 App 内绘制界面";
  const intro = mode === "combined" ? "AG-UI 传回复和状态，A2UI 组织订单卡，MCP App 提供取件面板。保存取件回执后，再由后续 Agent 运行更新外层摘要。" : mode === "over-mcp" ? "普通 MCP 工具返回 A2UI 消息，本地宿主按组件目录绘制。这个入口没有 iframe，也不依赖 MCP Apps。" : "宿主只加载 MCP App。App 自带 A2UI 组件目录与渲染器，经 AppBridge 调用 MCP 工具，界面在隔离视图内部生成。";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body><main class="wb-main"><div class="app-bar"><div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>AGENT UI LAB</div>${nav("workbench")}</div><header class="page-heading"><p class="page-kicker">PART 02 · PROTOCOL COMPOSITION</p><h1>${title}</h1><p class="wb-lede">${intro}</p><div class="wb-mode-nav">${[["combined", "/workbench", "三者协作"], ["over-mcp", "/a2ui-over-mcp", "A2UI over MCP"], ["in-app", "/a2ui-in-app", "A2UI in MCP Apps"]].map(([key, url, label]) => `<a href="${url}"${key === mode ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</div></header><div class="wb-layout"><aside class="wb-side"><span class="wb-chip">${mode === "combined" ? "AG-UI · LIVE RUN" : "MCP · TOOL RESULT"}</span><h2>这笔售后的处理进度</h2><ol class="wb-steps"><li>核对订单</li><li>保存取件安排</li><li>确认或取消</li></ol><p id="answer" class="wb-answer" aria-live="polite">正在读取演示订单…</p><p id="task-meta" class="wb-task">任务尚未创建</p><div class="wb-toolbar"><button id="new-task">新建任务</button><button id="resume-task" class="secondary">恢复最新</button></div><p class="wb-note">任务只保存在本机服务内存。刷新按 taskId 查询，服务重启后请新建。没有大模型、真实付款或快递下单。</p></aside><section><div class="wb-protocol-row"><span>${mode === "in-app" ? "MCP Apps 宿主" : "A2UI · 受控组件目录"}</span><span>${mode === "combined" ? "MCP Apps · 外部取件面板" : mode === "over-mcp" ? "普通 MCP · 无 iframe" : "Renderer 位于 App 内"}</span></div>${mode === "over-mcp" ? localPickerMarkup : ""}<section id="surface" aria-label="售后工作台"></section><p id="status" class="wb-feedback" role="status" aria-live="polite"></p><details class="debug-panel"><summary>查看协议与业务调用记录</summary><pre id="events" class="wb-debug"></pre></details><p class="wb-note">“明天／后天”为固定模拟时段标签，不会创建实际预约。选择只改变本地输入，保存才改变业务记录；退款申请还需另行确认。</p></section></div></main><script src="/assets/workbench.js" defer></script></body></html>`;
}

export function sandboxPage(hostOrigin: string) {
  return `<!doctype html><html><meta charset="utf-8"><style>html,body,iframe{border:0;margin:0;width:100%;height:100%}</style><body><script>
const HOST_ORIGIN=${JSON.stringify(hostOrigin)};
let view;
window.addEventListener("message",event=>{
  const message=event.data;
  if(!message || message.jsonrpc!=="2.0") return;
  if(event.source===window.parent && event.origin===HOST_ORIGIN){
    if(message.method==="ui/notifications/sandbox-resource-ready"){
      if(view) return;
      view=document.createElement("iframe");
      view.title="订单退款工具视图";
      view.setAttribute("sandbox","allow-scripts");
      view.srcdoc=message.params.html;
      document.body.append(view);
    }else if(view) view.contentWindow.postMessage(message,"*");
  }else if(view && event.source===view.contentWindow){
    window.parent.postMessage(message,HOST_ORIGIN);
  }
});
window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}},HOST_ORIGIN);
</script></body></html>`;
}
