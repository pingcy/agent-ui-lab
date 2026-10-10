import { randomUUID } from "node:crypto";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { z } from "zod";

export const WORKBENCH_CATALOG_ID = "https://refund-demo.local/catalog/workbench-v1";
export const WORKBENCH_SURFACE_ID = "workbench";
export const PICKUP_UI_URI = "ui://after-sales/pickup.html";
export const WORKBENCH_UI_URI = "ui://after-sales/workbench.html";
export const WORKBENCH_SLOTS = [
  { id: "tomorrow-am", label: "明天 09:00–12:00" },
  { id: "tomorrow-pm", label: "明天 14:00–18:00" },
  { id: "day-after-am", label: "后天 09:00–12:00" },
] as const;

export type WorkbenchTask = {
  taskId: string;
  status: "awaiting_confirmation" | "refund_submitted" | "cancelled";
  version: number;
  order: {
    orderId: string; orderedAt: string;
    product: { name: string; specification: string; imageUrl: string };
    quantity: number; paidAmountCents: number; currency: "CNY";
  };
  pickup?: { arrangementId: string; slotId: string; label: string; version: number };
  refund?: { requestId: string; amountCents: number };
  message: string;
};

const taskIdSchema = z.string().uuid();
const versionSchema = z.number().int().positive();
export const SavePickupSchema = z.object({ taskId: taskIdSchema, slotId: z.string().min(1), version: versionSchema }).strict();
export const WorkbenchDecisionSchema = z.object({ taskId: taskIdSchema, decision: z.enum(["confirm", "cancel"]), version: versionSchema }).strict();
export const WorkbenchInputSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("prepare") }).strict(),
  z.object({ intent: z.literal("resume"), taskId: taskIdSchema }).strict(),
  z.object({ intent: z.literal("pickup_saved"), taskId: taskIdSchema, arrangementId: z.string().min(1), version: versionSchema }).strict(),
  WorkbenchDecisionSchema.extend({ intent: z.literal("decide") }).strict(),
]);
export type WorkbenchInput = z.infer<typeof WorkbenchInputSchema>;

export class WorkbenchError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
}

// 此 store 与上篇三个页面完全隔离。模拟业务状态以服务器内存为准，返回值均为副本。
export function createWorkbenchStore() {
  const tasks = new Map<string, WorkbenchTask>();
  const saves = new Map<string, { inputVersion: number; savedVersion: number; slotId: string }>();
  const decisions = new Map<string, { inputVersion: number; decision: "confirm" | "cancel" }>();
  const currentTask = (taskId: string): WorkbenchTask => {
    taskIdSchema.parse(taskId);
    const task = tasks.get(taskId);
    if (!task) throw new WorkbenchError("找不到集成演示任务，请新建任务。", 404);
    return task;
  };
  const assertVersion = (task: WorkbenchTask, version: number) => {
    if (task.version !== version) throw new WorkbenchError("任务版本已变化，请恢复最新任务后再操作。", 409);
  };
  return {
    prepare(): WorkbenchTask {
      const task: WorkbenchTask = {
        taskId: randomUUID(), version: 1, status: "awaiting_confirmation",
        order: {
          orderId: "OD-20260928-10086", orderedAt: "2026-09-28T10:32:00+08:00",
          product: { name: "Mac mini", specification: "M4 · 16GB 统一内存 · 256GB SSD", imageUrl: "/assets/mac-mini.png" },
          quantity: 1, paidAmountCents: 449900, currency: "CNY",
        },
        message: "订单已核对。本例需要退货取件，请先保存取件安排，再确认是否提交退款申请。",
      };
      tasks.set(task.taskId, task);
      return structuredClone(task);
    },
    read(taskId: string): WorkbenchTask { return structuredClone(currentTask(taskId)); },
    savePickup(input: z.infer<typeof SavePickupSchema>): WorkbenchTask {
      const { taskId, slotId, version } = SavePickupSchema.parse(input);
      const task = currentTask(taskId);
      if (task.status !== "awaiting_confirmation") throw new WorkbenchError("任务已经结束，不能修改取件安排。", 409);
      const slot = WORKBENCH_SLOTS.find(item => item.id === slotId);
      if (!slot) throw new WorkbenchError("无效取件时段，请选择提供的三个时段之一。", 400);
      const saved = saves.get(taskId);
      // 只接受最新一次操作的重试；更旧的回执不能覆盖更新后的选择。
      if (saved && saved.savedVersion === task.version && saved.slotId === slotId
        && (version === saved.inputVersion || version === task.version)) return structuredClone(task);
      assertVersion(task, version);
      const nextVersion = task.version + 1;
      const next: WorkbenchTask = {
        ...task, version: nextVersion,
        pickup: { arrangementId: `PK-${randomUUID()}`, slotId, label: slot.label, version: nextVersion },
        message: `取件安排已保存：${slot.label}。这还没有提交退款，请在订单卡上确认或取消。`,
      };
      tasks.set(taskId, next);
      saves.set(taskId, { inputVersion: version, savedVersion: nextVersion, slotId });
      return structuredClone(next);
    },
    decide(input: z.infer<typeof WorkbenchDecisionSchema>): WorkbenchTask {
      const { taskId, decision, version } = WorkbenchDecisionSchema.parse(input);
      const task = currentTask(taskId);
      if (task.status !== "awaiting_confirmation") {
        const previous = decisions.get(taskId);
        if (previous?.decision === decision && (version === previous.inputVersion || version === task.version)) return structuredClone(task);
        throw new WorkbenchError("任务已经结束，不能更改原来的决定或使用旧版本。", 409);
      }
      assertVersion(task, version);
      if (decision === "confirm" && !task.pickup) throw new WorkbenchError("请先保存取件安排，再确认退款。", 409);
      const next: WorkbenchTask = {
        ...task, version: task.version + 1, status: decision === "confirm" ? "refund_submitted" : "cancelled",
        ...(decision === "confirm" ? { refund: { requestId: `RF-${randomUUID()}`, amountCents: task.order.paidAmountCents } } : {}),
        message: decision === "confirm"
          ? "模拟退款申请已提交，金额 ¥4,499.00；尚未到账。本演示没有调用支付接口，也不会产生真实取件。"
          : "本次退款操作已取消，没有提交退款申请，也不会产生真实取件。",
      };
      tasks.set(taskId, next);
      decisions.set(taskId, { inputVersion: version, decision });
      return structuredClone(next);
    },
  };
}
export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;

export async function runWorkbench(input: WorkbenchInput, store: WorkbenchStore): Promise<WorkbenchTask> {
  const parsed = WorkbenchInputSchema.parse(input);
  if (parsed.intent === "prepare") return store.prepare();
  if (parsed.intent === "decide") {
    return store.decide({ taskId: parsed.taskId, decision: parsed.decision, version: parsed.version });
  }
  const task = store.read(parsed.taskId);
  if (parsed.intent === "pickup_saved") {
    // 宿主上报的回执只是查询线索，不能当业务真相：必须在后端重新读取并校验。
    if (task.status !== "awaiting_confirmation" || !task.pickup
      || task.pickup.arrangementId !== parsed.arrangementId
      || task.pickup.version !== parsed.version || task.version !== parsed.version) {
      throw new WorkbenchError("取件回执无效或已过期，请恢复最新任务。", 409);
    }
  }
  return task;
}

export type WorkbenchComponent = {
  id: string; component: "Column" | "Text" | "Image" | "Button" | "MCPApp";
  appearance?: string; children?: string[]; text?: string | { path: string };
  url?: string; alt?: string; child?: string; variant?: "primary" | "secondary";
  disabled?: boolean; taskId?: string; resourceUri?: string;
  action?: { event: { name: string; context: { taskId: string; version: number } } };
};
export type WorkbenchUiMessage = {
  version: "v0.9";
  createSurface?: { surfaceId: string; catalogId: string };
  updateComponents?: { surfaceId: string; components: WorkbenchComponent[] };
  updateDataModel?: { surfaceId: string; path: string; value: Record<string, unknown> };
};

export function workbenchMessages(task: WorkbenchTask, create = true, includeApp = true): WorkbenchUiMessage[] {
  const pending = task.status === "awaiting_confirmation";
  const column = (id: string, appearance: string, children: string[]): WorkbenchComponent => ({ id, component: "Column", appearance, children });
  const text = (id: string, appearance: string, value: string | { path: string }): WorkbenchComponent => ({ id, component: "Text", appearance, text: value });
  const components: WorkbenchComponent[] = [
    column("root", "refund-card", ["eyebrow", "heading", "status-badge", "product", "details", "amount", "pickup-summary-block", ...(includeApp && pending ? ["pickup-app"] : []), pending ? "actions" : "result", "footer"]),
    text("eyebrow", "eyebrow", "AFTER-SALES WORKBENCH / 售后协作"),
    column("heading", "card-heading", ["title", "subtitle"]),
    text("title", "card-title", pending ? "核对订单，安排退货" : "退款处理结果"),
    text("subtitle", "subtitle", "订单卡由 A2UI 描述；取件安排保存后，需要再次确认退款。"),
    text("status-badge", "status-badge", { path: "/statusLabel" }),
    column("product", "product-row", ["image", "product-info"]),
    { id: "image", component: "Image", url: task.order.product.imageUrl, alt: "Mac mini 产品示意图" },
    column("product-info", "product-info", ["product-name", "product-spec", "product-quantity"]),
    text("product-name", "product-title", task.order.product.name),
    text("product-spec", "product-spec", task.order.product.specification),
    text("product-quantity", "product-quantity", `数量 × ${task.order.quantity}`),
    column("details", "order-details", ["order-detail", "time-detail"]),
    column("order-detail", "detail-item", ["order-label", "order-no"]),
    text("order-label", "detail-label", "订单编号"),
    text("order-no", "detail-value", task.order.orderId),
    column("time-detail", "detail-item", ["time-label", "ordered-at"]),
    text("time-label", "detail-label", "下单时间"),
    text("ordered-at", "detail-value", "2026-09-28 10:32（北京时间）"),
    column("amount", "refund-amount", ["amount-label", "amount-value"]),
    text("amount-label", "amount-label", "实付款 / 本次申请退款金额"),
    text("amount-value", "amount-value", `¥${(task.order.paidAmountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
    column("pickup-summary-block", "result-panel", ["pickup-label", "pickup-summary", "receipt-label"]),
    text("pickup-label", "detail-label", "取件安排 · 绑定 /pickupSummary"),
    text("pickup-summary", "detail-value", { path: "/pickupSummary" }),
    text("receipt-label", "caption", { path: "/receiptLabel" }),
    text("footer", "caption", "纯模拟：没有真实退款或取件。保存取件 ≠ 提交退款 ≠ 退款到账。"),
  ];
  if (includeApp && pending) components.push({ id: "pickup-app", component: "MCPApp", taskId: task.taskId, resourceUri: PICKUP_UI_URI });
  if (pending) components.push(
    column("actions", "card-actions", ["confirm", "cancel"]),
    text("confirm-label", "caption", "确认退款"), text("cancel-label", "caption", "取消"),
    { id: "confirm", component: "Button", variant: "primary", child: "confirm-label", disabled: !task.pickup, action: { event: { name: "confirm_refund", context: { taskId: task.taskId, version: task.version } } } },
    { id: "cancel", component: "Button", variant: "secondary", child: "cancel-label", disabled: false, action: { event: { name: "cancel_refund", context: { taskId: task.taskId, version: task.version } } } },
  );
  else components.push(
    column("result", "result-panel", ["result-title", "result-message", ...(task.refund ? ["request-id"] : [])]),
    text("result-title", "result-title", task.status === "refund_submitted" ? "模拟退款申请已提交" : "本次操作已取消"),
    text("result-message", "result-message", { path: "/message" }),
    ...(task.refund ? [text("request-id", "caption", `申请编号 · ${task.refund.requestId}`)] : []),
  );
  return [
    ...(create ? [{ version: "v0.9" as const, createSurface: { surfaceId: WORKBENCH_SURFACE_ID, catalogId: WORKBENCH_CATALOG_ID } }] : []),
    { version: "v0.9", updateComponents: { surfaceId: WORKBENCH_SURFACE_ID, components } },
    { version: "v0.9", updateDataModel: { surfaceId: WORKBENCH_SURFACE_ID, path: "/", value: {
      taskId: task.taskId, version: task.version, status: task.status, message: task.message,
      statusLabel: pending ? (task.pickup ? "取件已保存 · 待确认" : "待安排取件") : task.status === "refund_submitted" ? "申请已提交" : "已取消",
      pickupSummary: task.pickup ? task.pickup.label : "尚未保存取件安排",
      receiptLabel: task.pickup ? `业务回执 ${task.pickup.arrangementId} · v${task.pickup.version}` : "在下方工具界面选择时段并保存。",
    } } },
  ];
}

// a2ui-surface / a2ui_operations 是当前官方 middleware 的映射约定，不是 AG-UI 核心新增事件。
export function workbenchEvents(task: WorkbenchTask, threadId: string, runId: string, init: boolean, intent: WorkbenchInput["intent"]): BaseEvent[] {
  const messageId = `message-${runId}`;
  const stepName = intent === "prepare" ? "review_order" : intent === "pickup_saved" ? "verify_pickup_receipt" : intent === "resume" ? "restore_task" : "save_refund_decision";
  const fragments = Array.from(task.message);
  const contentEvents: BaseEvent[] = [];
  for (let start = 0; start < fragments.length; start += 12) contentEvents.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: fragments.slice(start, start + 12).join("") });
  return [
    { type: EventType.RUN_STARTED, threadId, runId },
    { type: EventType.STEP_STARTED, stepName },
    { type: EventType.STATE_SNAPSHOT, snapshot: task },
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
    ...contentEvents,
    { type: EventType.TEXT_MESSAGE_END, messageId },
    { type: EventType.ACTIVITY_SNAPSHOT, messageId: `a2ui-${task.taskId}`, activityType: "a2ui-surface", content: { a2ui_operations: workbenchMessages(task, init) }, replace: true },
    { type: EventType.STEP_FINISHED, stepName },
    { type: EventType.RUN_FINISHED, threadId, runId },
  ];
}
