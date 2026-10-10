import { HttpAgent } from "@ag-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { WorkbenchTask, WorkbenchUiMessage, WorkbenchInput } from "../workbench.js";
import { createWorkbenchRenderer, type UiAction } from "./workbench-renderer.js";
import { mountWorkbenchApp, callWorkbenchTool } from "./workbench-bridge.js";
import { createLocalPicker } from "./workbench-local-picker.js";

const mode = location.pathname === "/a2ui-over-mcp" ? "over-mcp" : location.pathname === "/a2ui-in-app" ? "in-app" : "combined";
const status = document.querySelector<HTMLElement>("#status")!;
const logNode = document.querySelector<HTMLElement>("#events")!;
const answer = document.querySelector<HTMLElement>("#answer")!;
const surface = document.querySelector<HTMLElement>("#surface")!;
const taskMeta = document.querySelector<HTMLElement>("#task-meta")!;
const log = (text: string) => { logNode.textContent += `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${text}\n`; logNode.scrollTop = logNode.scrollHeight; };
let task: WorkbenchTask | undefined;
let busy = false;
let outerApp: ReturnType<typeof mountWorkbenchApp> | undefined;
let pickupApp: ReturnType<typeof mountWorkbenchApp> | undefined;
const feedback = (message: string, error = false) => { status.textContent = message; status.dataset.error = String(error); };
function saveTask(next: WorkbenchTask) {
  task = next;
  const url = new URL(location.href); url.searchParams.set("taskId", task.taskId); history.replaceState(null, "", url);
  taskMeta.textContent = `任务 ${task.taskId}\n业务版本 v${task.version} · ${task.status}`;
  taskMeta.dataset.version = String(task.version); taskMeta.dataset.taskId = task.taskId; taskMeta.dataset.status = task.status;
  const done = [true, !!task.pickup, task.status !== "awaiting_confirmation"];
  document.querySelectorAll<HTMLElement>(".wb-steps li").forEach((node, i) => node.dataset.done = String(done[i]));
}
function unwrap(result: CallToolResult) {
  if (result.isError) {
    const detail = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    throw new Error(detail || "工具处理失败");
  }
  const data = result.structuredContent as { task: WorkbenchTask; slots?: {id:string;label:string}[] };
  if (!data?.task?.taskId || !Number.isInteger(data.task.version)) throw new Error("工具缺少有效任务回执");
  return data;
}
const agent = new HttpAgent({ url: "/api/workbench/run", threadId: crypto.randomUUID() });
const renderer = createWorkbenchRenderer(surface, {
  onAction(action) { log(`A2UI Action → ${JSON.stringify(action)}`); if (mode === "combined") void run({ intent: "action", message: action }); else void decideViaMcp(action); },
  mountApp(component) {
    if (component.resourceUri !== "ui://after-sales/pickup.html" || component.taskId !== task?.taskId) throw new Error("MCP App 资源或任务不在允许范围");
    const element = document.createElement("section"); element.className = "wb-app-wrapper";
    const label = document.createElement("p"); label.className = "wb-app-label"; label.textContent = "MCP APPS · 物流工具的隔离交互视图"; element.append(label);
    pickupApp = mountWorkbenchApp(element, { kind: "pickup", taskId: component.taskId, log,
      onError: error => feedback(`外层同步未完成，可点击“恢复最新”：${String(error)}`, true),
      async onResult(name, result) {
        if (name !== "save_pickup") return;
        const next = unwrap(result).task;
        if (!next.pickup) throw new Error("保存结果缺少取件回执");
        log("宿主适配器 → 用真实回执启动后续 Agent 运行（不是沿 SSE 反向发送）");
        await run({ intent: "pickup_saved", taskId: next.taskId, arrangementId: next.pickup.arrangementId, version: next.version }, true);
      },
    });
    return { element, dispose() { pickupApp?.dispose(); pickupApp = undefined; } };
  },
});
const picker = mode === "over-mcp" ? createLocalPicker(document, slotId => { void saveViaMcp(slotId); }) : undefined;
function setBusy(next: boolean) {
  busy = next; renderer.setBusy(next); picker?.setBusy(next);
  document.querySelectorAll<HTMLButtonElement>("#new-task,#resume-task").forEach(b => b.disabled = next);
}
type Input = WorkbenchInput | { intent: "action"; message: UiAction };
async function run(input: Input, propagate = false) {
  if (busy) { if (propagate) throw new Error("当前运行尚未完成，请恢复最新任务"); return; }
  setBusy(true); answer.textContent = ""; feedback("Agent 正在处理…");
  try {
    if (input.intent === "prepare" || input.intent === "resume") renderer.reset();
    log(`HTTP POST → ${JSON.stringify(input)}`);
    await agent.runAgent({ forwardedProps: input }, {
      onEvent({ event }) { log(`SSE ← ${JSON.stringify(event)}`); },
      onStepStartedEvent({ event }) { feedback(`执行步骤：${event.stepName}`); },
      onStateSnapshotEvent({ event }) { saveTask(event.snapshot as WorkbenchTask); },
      onTextMessageContentEvent({ event, textMessageBuffer }) { answer.textContent = textMessageBuffer + event.delta; },
      onActivitySnapshotEvent({ event }) {
        if (event.activityType !== "a2ui-surface") return;
        const operations = event.content.a2ui_operations;
        if (!Array.isArray(operations)) throw new Error("活动快照缺少 A2UI 操作");
        renderer.apply(operations as WorkbenchUiMessage[]);
      },
    });
    feedback(task?.status === "awaiting_confirmation" ? "本轮运行结束，等待你的操作。" : "任务结果已保存；刷新只查询，不重复提交。");
  } catch (error) { feedback(`操作未完成：${String(error)}。可恢复最新任务后重试。`, true); if (propagate) throw error; }
  finally { setBusy(false); }
}
function renderMcpResult(result: CallToolResult) {
  const data = unwrap(result);
  const resource = result.content.find(c => c.type === "resource" && c.resource.mimeType === "application/a2ui+json");
  if (!resource || resource.type !== "resource" || !("text" in resource.resource)) throw new Error("缺少 application/a2ui+json 资源");
  const messages = JSON.parse(resource.resource.text) as WorkbenchUiMessage[];
  log(`MCP embedded resource → 宿主 A2UI renderer（没有 iframe）\n${JSON.stringify(messages)}`);
  saveTask(data.task); renderer.reset(); renderer.apply(messages); picker?.setTask(data.task); answer.textContent = data.task.message;
}
async function loadMcp(taskId?: string) {
  if (busy) return; setBusy(true);
  try { renderMcpResult(await callWorkbenchTool("review_workbench_a2ui", taskId ? { taskId } : {})); feedback("MCP 结果已由宿主组件渲染。"); }
  catch (error) { feedback(`读取失败：${String(error)}`, true); }
  finally { setBusy(false); }
}
async function saveViaMcp(slotId: string) {
  if (busy || !task) return; setBusy(true);
  try {
    log(`宿主本地控件 → MCP save_pickup · ${slotId}`);
    const saved = unwrap(await callWorkbenchTool("save_pickup", { taskId: task.taskId, slotId, version: task.version }));
    renderMcpResult(await callWorkbenchTool("review_workbench_a2ui", { taskId: saved.task.taskId }));
    feedback("取件已保存，A2UI 描述已重新读取；尚未退款。");
  } catch (error) { feedback(`保存或刷新失败：${String(error)}，可恢复最新后重试。`, true); }
  finally { setBusy(false); }
}
async function decideViaMcp(action: UiAction) {
  if (busy || !task) return; setBusy(true);
  try {
    const decision = action.action.name === "confirm_refund" ? "confirm" : "cancel";
    log(`宿主 Action → MCP decide_workbench · ${decision}`);
    renderMcpResult(await callWorkbenchTool("decide_workbench", { ...action.action.context, decision })); feedback("业务结果已返回。");
  } catch (error) { feedback(String(error), true); }
  finally { setBusy(false); }
}
function loadApp(taskId?: string) {
  outerApp?.dispose(); surface.replaceChildren();
  outerApp = mountWorkbenchApp(surface, { kind: "workbench", taskId, log,
    onError: error => feedback(String(error), true),
    onResult(_name, result) { const next = unwrap(result).task; saveTask(next); answer.textContent = next.message; feedback("宿主只负责 MCP Apps；A2UI 在 App 内渲染。"); },
  });
}
function load(taskId?: string) {
  if (mode === "combined") void run(taskId ? { intent: "resume", taskId } : { intent: "prepare" });
  else if (mode === "over-mcp") void loadMcp(taskId);
  else loadApp(taskId);
}
document.querySelector<HTMLButtonElement>("#new-task")!.onclick = () => { task = undefined; load(); };
document.querySelector<HTMLButtonElement>("#resume-task")!.onclick = () => load(task?.taskId ?? new URL(location.href).searchParams.get("taskId") ?? undefined);
window.addEventListener("pagehide", () => { renderer.reset(); outerApp?.dispose(); });
async function main() {
  if (picker) { const response = await fetch("/api/workbench/slots"); if (!response.ok) throw new Error(await response.text()); picker.setSlots(await response.json()); }
  load(new URL(location.href).searchParams.get("taskId") ?? undefined);
}
void main().catch(error => feedback(String(error), true));
