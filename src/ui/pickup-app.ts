import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

interface PickupTask {
  taskId: string;
  status: "awaiting_confirmation" | "refund_submitted" | "cancelled";
  version: number;
  pickup?: { arrangementId: string; slotId: string; label: string; version: number };
}
interface Slot { id: string; label: string }
interface PickupData { task: PickupTask; slots: Slot[] }
interface Result { isError?: boolean; structuredContent?: unknown; content?: unknown }

const app = new App({ name: "退货取件安排", version: "1.0.0" }, {});
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const card = document.querySelector<HTMLElement>(".pickup-card")!;
const save = el<HTMLButtonElement>("save-pickup");
const fieldset = el<HTMLFieldSetElement>("pickup-fieldset");
let task: PickupTask | undefined;
let slots: Slot[] = [];
let selectedSlotId = "";
let ready = false;
let busy = false;

function feedback(message: string, state: "loading" | "success" | "error" = "success") {
  el("pickup-status").textContent = message;
  el("pickup-status").dataset.state = state;
}

function syncControls() {
  const editable = ready && !busy && task?.status === "awaiting_confirmation";
  fieldset.disabled = !editable;
  save.disabled = !editable || !slots.some(slot => slot.id === selectedSlotId);
  save.textContent = busy ? "正在保存…" : task && task.status !== "awaiting_confirmation" ? "任务已结束" : "保存取件安排";
  card.setAttribute("aria-busy", String(busy));
}

function parseData(input: unknown): PickupData {
  if (!input || typeof input !== "object") throw new Error("工具未返回取件数据");
  const value = input as Partial<PickupData>;
  const candidate = value.task;
  if (!candidate || typeof candidate.taskId !== "string" || !candidate.taskId || !Number.isInteger(candidate.version) || candidate.version < 0 || !["awaiting_confirmation", "refund_submitted", "cancelled"].includes(candidate.status)) throw new Error("任务数据无效");
  if (!Array.isArray(value.slots) || !value.slots.every(slot => slot && typeof slot.id === "string" && slot.id && typeof slot.label === "string" && slot.label)) throw new Error("可预约时段数据无效");
  if (new Set(value.slots.map(slot => slot.id)).size !== value.slots.length) throw new Error("可预约时段编号重复");
  const pickup = candidate.pickup;
  if (pickup && (typeof pickup.arrangementId !== "string" || typeof pickup.slotId !== "string" || typeof pickup.label !== "string" || !Number.isInteger(pickup.version))) throw new Error("取件回执数据无效");
  return { task: candidate, slots: value.slots };
}

function renderData(data: PickupData) {
  // 较晚送达的旧回执不能把界面回滚；宿主可以随时推送同一任务的新版本。
  if (task?.taskId === data.task.taskId && data.task.version < task.version) return;
  const sameTask = task?.taskId === data.task.taskId;
  const previousSelection = sameTask ? selectedSlotId : "";
  task = data.task;
  slots = data.slots;
  selectedSlotId = slots.some(slot => slot.id === previousSelection) ? previousSelection : slots.some(slot => slot.id === task?.pickup?.slotId) ? task.pickup!.slotId : "";
  el("pickup-task").textContent = `退款任务 · ${task.taskId}`;
  el("pickup-version").textContent = `任务版本 v${task.version}`;
  el("pickup-badge").textContent = task.status === "refund_submitted" ? "退款已提交" : task.status === "cancelled" ? "退款已取消" : task.pickup ? "取件已安排" : "待安排";
  el("pickup-summary").textContent = task.pickup?.label ?? "尚未保存，请选择一个时段。";
  el("pickup-arrangement").hidden = !task.pickup;
  el("pickup-arrangement").textContent = task.pickup ? `回执 ${task.pickup.arrangementId} · v${task.pickup.version}` : "";
  const container = el("pickup-slots");
  container.replaceChildren();
  for (const slot of slots) {
    const label = document.createElement("label");
    label.className = "pickup-slot";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "pickup-slot";
    input.value = slot.id;
    input.dataset.slotId = slot.id;
    input.checked = slot.id === selectedSlotId;
    input.addEventListener("change", () => {
      selectedSlotId = slot.id;
      feedback(task?.pickup?.slotId === slot.id ? "该时段已保存，可在外层确认退款。" : "已选择时段，点击下方按钮保存。", "success");
      syncControls();
    });
    const text = document.createElement("span");
    text.className = "pickup-slot-label";
    text.textContent = slot.label;
    label.append(input, text);
    container.append(label);
  }
  if (!slots.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "pickup-placeholder";
    placeholder.textContent = "当前暂无可预约时段，请稍后重试。";
    container.append(placeholder);
  }
  syncControls();
}

function errorMessage(result: Result) {
  if (Array.isArray(result.content)) {
    const text = result.content.find(item => item?.type === "text" && typeof item.text === "string");
    if (text) return text.text as string;
  }
  return "取件工具返回错误";
}

function receiveResult(result: Result) {
  if (result.isError) {
    // { error } 也是合法错误载荷，不能让快照校验覆盖工具的原始报错。
    // 如错误回执同时附带当前任务，则尽力同步版本；失败仍保留原选择与原报错。
    const candidate = result.structuredContent;
    if (candidate && typeof candidate === "object" && "task" in candidate && candidate.task) {
      try {
        const data = parseData(candidate);
        if (!task || data.task.taskId === task.taskId) renderData(data);
      } catch { /* 错误载荷中的快照不是必填，保留已有界面即可重试。 */ }
    }
    throw new Error(errorMessage(result));
  }
  if (!result.structuredContent) throw new Error("工具未返回取件数据");
  renderData(parseData(result.structuredContent));
}

function applyContext(context: McpUiHostContext) {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.safeAreaInsets) {
    const { top, right, bottom, left } = context.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

// 在 connect 前注册全部回调，接收首次结果与宿主之后主动推送的任务快照。
app.addEventListener("toolresult", result => {
  try {
    receiveResult(result);
    feedback(task?.status === "awaiting_confirmation" ? task.pickup ? "取件回执已同步，退款仍需再次确认。" : "请选择方便的上门取件时间。" : "任务已结束，取件安排不再可修改。");
  } catch (error) { feedback(`加载失败，可重试：${error instanceof Error ? error.message : String(error)}`, "error"); }
});
app.addEventListener("hostcontextchanged", applyContext);
app.onteardown = async () => { ready = false; syncControls(); return {}; };

save.addEventListener("click", async () => {
  if (busy || !ready || !task || task.status !== "awaiting_confirmation" || !slots.some(slot => slot.id === selectedSlotId)) return;
  const requestedTaskId = task.taskId;
  busy = true;
  syncControls();
  feedback("通过宿主调用取件工具…", "loading");
  try {
    const result = await app.callServerTool({ name: "save_pickup", arguments: { taskId: task.taskId, slotId: selectedSlotId, version: task.version } });
    if (task?.taskId !== requestedTaskId) return;
    if (!result.isError && result.structuredContent && parseData(result.structuredContent).task.taskId !== requestedTaskId) throw new Error("返回的任务编号不一致，请重试");
    receiveResult(result);
    feedback(task.status === "awaiting_confirmation" ? "取件安排已保存，退款仍需在外层确认。" : "任务状态已更新，取件安排不再可修改。");
  } catch (error) {
    feedback(`保存失败，可重试：${error instanceof Error ? error.message : String(error)}`, "error");
  } finally { busy = false; syncControls(); }
});

try {
  await app.connect();
  const context = app.getHostContext();
  if (context) applyContext(context);
  ready = true;
  syncControls();
  if (!task) feedback("宿主已连接，等待取件数据…", "loading");
} catch (error) { feedback(`连接失败：${error instanceof Error ? error.message : String(error)}`, "error"); }
