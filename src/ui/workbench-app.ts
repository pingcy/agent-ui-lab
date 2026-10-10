import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { WorkbenchTask, WorkbenchUiMessage } from "../workbench.js";
import { createWorkbenchRenderer, type UiAction } from "./workbench-renderer.js";
import { createLocalPicker } from "./workbench-local-picker.js";

const app = new App({ name: "A2UI Inside After-sales App", version: "1.0.0" });
const status = document.querySelector<HTMLElement>("#status")!;
const image = document.querySelector<HTMLImageElement>("#product-data")!.src;
let task: WorkbenchTask | undefined;
let busy = true;
let initializedSlots = false;
const renderer = createWorkbenchRenderer(document.querySelector<HTMLElement>("#surface")!, {
  imageUrl: image,
  onAction(action: UiAction) { void perform(async () => {
    const result = await app.callServerTool({ name: "decide_workbench", arguments: { ...action.action.context, decision: action.action.name === "confirm_refund" ? "confirm" : "cancel" } });
    render(result);
  }); },
});
const picker = createLocalPicker(document, slotId => { void perform(async () => {
  const saved = await app.callServerTool({ name: "save_pickup", arguments: { taskId: task!.taskId, slotId, version: task!.version } });
  const data = read(saved);
  // 保存工具不提供界面描述。明确读取新的 A2UI，而不是让 App 猜测外层数据。
  render(await app.callServerTool({ name: "review_workbench_a2ui", arguments: { taskId: data.task.taskId } }));
}); });
function setBusy(value: boolean) { busy = value; renderer.setBusy(value); picker.setBusy(value); }
function read(result: CallToolResult) {
  if (result.isError) throw new Error(result.content.filter(x => x.type === "text").map(x => x.text).join("\n") || "工具失败");
  const data = result.structuredContent as { task: WorkbenchTask; slots?: { id: string; label: string }[] };
  if (!data?.task?.taskId || !Number.isInteger(data.task.version)) throw new Error("缺少合法任务回执");
  return data;
}
function render(result: CallToolResult) {
  const data = read(result);
  if (task?.taskId === data.task.taskId && task.version > data.task.version) return;
  const resource = result.content.find(c => c.type === "resource" && c.resource.mimeType === "application/a2ui+json");
  if (!resource || resource.type !== "resource" || !("text" in resource.resource)) throw new Error("缺少 A2UI 界面资源");
  task = data.task;
  if (!initializedSlots && data.slots) { picker.setSlots(data.slots); initializedSlots = true; }
  renderer.reset(); renderer.apply(JSON.parse(resource.resource.text) as WorkbenchUiMessage[]);
  picker.setTask(task);
  status.textContent = `App 内渲染 · 业务版本 v${task.version} · ${task.message}`;
  status.dataset.version = String(task.version); status.dataset.taskId = task.taskId;
}
async function perform(action: () => Promise<void>) {
  if (busy || !task) return; setBusy(true); status.textContent = "正在通过宿主调用 MCP 工具…";
  try { await action(); }
  catch (error) { status.textContent = `操作未完成，可重试或在宿主恢复最新：${String(error)}`; }
  finally { setBusy(false); }
}
app.addEventListener("toolresult", result => { try { render(result); setBusy(false); } catch (error) { status.textContent = String(error); } });
app.addEventListener("hostcontextchanged", context => {
  if (context.theme) { applyDocumentTheme(context.theme); document.documentElement.dataset.theme = context.theme; }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.safeAreaInsets) { const s = context.safeAreaInsets; document.body.style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`; }
});
try { await app.connect(); }
catch (error) { status.textContent = `宿主连接失败：${String(error)}`; }
