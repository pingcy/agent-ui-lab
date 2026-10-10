import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/server";

const status = document.querySelector<HTMLElement>("#status")!;
const log = document.querySelector<HTMLElement>("#events")!;
const iframe = document.querySelector<HTMLIFrameElement>("#sandbox")!;

async function main() {
  const response = await fetch("/api/mcp/bootstrap");
  if (!response.ok) throw new Error(await response.text());
  const { html, result, sandboxOrigin, resourceUri } = await response.json();
  log.textContent = `资源：${resourceUri}\n首次工具：review_refund\n`;

  // 浏览器 Host 使用真实 AppBridge；服务端 HTTP API 再代理到真实 MCP Client。
  const bridge = new AppBridge(null, { name: "Refund Local Host", version: "1.0.0" }, { serverTools: {} });
  bridge.oncalltool = async (params) => {
    if (params.name !== "decide_refund") throw new Error("本地 Host 仅允许 decide_refund 工具");
    const call = await fetch("/api/mcp/call", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    if (!call.ok) throw new Error(await call.text());
    const next = await call.json() as CallToolResult;
    log.textContent += `App → Host → MCP decide_refund · ${JSON.stringify(next.structuredContent)}\n`;
    return next;
  };
  bridge.addEventListener("sandboxready", () => {
    void bridge.sendSandboxResourceReady({ html, sandbox: "allow-scripts" });
  });
  bridge.addEventListener("initialized", () => {
    void (async () => {
      await bridge.sendToolInput({ arguments: {} });
      await bridge.sendToolResult(result);
      status.textContent = "App 已初始化 · 首次工具结果已推送";
    })();
  });
  // App SDK 的 ResizeObserver 会报告内容高度，避免窄屏卡片被截断。
  bridge.addEventListener("sizechange", ({ height }) => {
    if (typeof height === "number" && Number.isFinite(height)) {
      iframe.style.height = `${Math.max(200, Math.min(1200, Math.ceil(height)))}px`;
    }
  });
  // 先连接空 iframe 的 WindowProxy，再导航，避免漏掉 sandbox-ready 通知。
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  // setHostContext 会发送通知，因此只能在 transport 已连接后调用。
  bridge.setHostContext({ theme: "light", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } });
  iframe.src = `${sandboxOrigin}/sandbox`;
  window.addEventListener("pagehide", () => { void bridge.close(); });
}

void main().catch(error => { status.textContent = `加载失败：${String(error)}`; });
