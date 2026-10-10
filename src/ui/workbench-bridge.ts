import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/server";

export async function callWorkbenchTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const response = await fetch("/api/workbench/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function mountWorkbenchApp(container: HTMLElement, options: {
  kind: "pickup" | "workbench";
  taskId?: string;
  log(message: string): void;
  onResult?(name: string, result: CallToolResult): Promise<void> | void;
  onError?(error: unknown): void;
}) {
  let bridge: AppBridge | undefined;
  let disposed = false;
  const iframe = document.createElement("iframe");
  iframe.id = options.kind === "pickup" ? "pickup-sandbox" : "workbench-sandbox";
  iframe.title = options.kind === "pickup" ? "MCP App 取件安排" : "MCP App 内的 A2UI 渲染器";
  iframe.className = "wb-app-frame";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  container.append(iframe);
  const boot = (async () => {
    const response = await fetch("/api/workbench/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: options.kind, ...(options.taskId ? { taskId: options.taskId } : {}) }) });
    if (!response.ok) throw new Error(await response.text());
    const { html, result, sandboxOrigin, resourceUri } = await response.json();
    if (disposed) return;
    options.log(`MCP resource → ${resourceUri}`);
    await options.onResult?.("bootstrap", result);
    if (disposed) return;
    const allowed = options.kind === "pickup" ? ["save_pickup", "review_pickup"] : ["save_pickup", "review_workbench_a2ui", "decide_workbench"];
    bridge = new AppBridge(null, { name: "After-sales Workbench", version: "2.0.0" }, { serverTools: {} });
    bridge.oncalltool = async (params) => {
      if (disposed) throw new Error("App 已关闭");
      if (!allowed.includes(params.name)) throw new Error("当前 App 不允许调用这个工具");
      const args = params.arguments as Record<string, unknown>;
      const scopedTask = options.taskId ?? result.structuredContent?.task?.taskId;
      if (args?.taskId !== scopedTask) throw new Error("工具调用不属于当前 App 任务");
      options.log(`App → AppBridge → MCP Client → ${params.name}`);
      const next = await callWorkbenchTool(params.name, args);
      // 用户可能已新建/恢复任务。旧 App 的业务调用可以完成，但不得回写新界面。
      if (disposed) return next;
      // 先获得真实工具回执。外层联动失败不把已经完成的保存误报为保存失败。
      if (!next.isError) void Promise.resolve().then(async () => {
        if (!disposed) await options.onResult?.(params.name, next);
      }).catch(error => { if (!disposed) { options.log(`业务已保存，外层同步失败：${String(error)}`); options.onError?.(error); } });
      if (!disposed) options.log(`${params.name} ← ${JSON.stringify(next.structuredContent)}`);
      return next;
    };
    bridge.addEventListener("sandboxready", () => { if (!disposed) void bridge?.sendSandboxResourceReady({ html, sandbox: "allow-scripts" }); });
    bridge.addEventListener("initialized", () => { void (async () => {
      if (disposed) return;
      await bridge!.sendToolInput({ arguments: options.taskId ? { taskId: options.taskId } : {} });
      if (disposed) return;
      await bridge!.sendToolResult(result);
      if (!disposed) options.log("App initialized · 初始工具结果已推送");
    })().catch(error => { if (!disposed) options.onError?.(error); }); });
    bridge.addEventListener("sizechange", ({ height }) => {
      if (typeof height === "number" && Number.isFinite(height)) iframe.style.height = `${Math.max(160, Math.min(4000, Math.ceil(height) + 4))}px`;
    });
    await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
    if (disposed) { await bridge.close(); return; }
    bridge.setHostContext({ theme: "light", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } });
    iframe.src = `${sandboxOrigin}/sandbox`;
  })().catch(error => { if (!disposed) { options.onError?.(error); options.log(`App 加载失败：${String(error)}`); } });
  return {
    ready: boot,
    sendResult(result: CallToolResult) { if (bridge && !disposed) void bridge.sendToolResult(result).catch(error => options.onError?.(error)); },
    dispose() { disposed = true; void bridge?.close(); iframe.remove(); },
  };
}
