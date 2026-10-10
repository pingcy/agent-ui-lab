import type { RefundTask } from "./agent.js";

export const CATALOG_ID = "https://refund-demo.local/catalog/v1";
export const SURFACE_ID = "refund";
export type RefundComponent = {
  id: string; component: "Column" | "Text" | "Image" | "Button";
  appearance?: string; children?: string[]; text?: string;
  url?: string; alt?: string; child?: string; variant?: "primary" | "secondary";
  action?: { event: { name: string; context: { taskId: string } } };
};
export type RefundUiMessage = {
  version: "v0.9";
  createSurface?: { surfaceId: string; catalogId: string };
  updateComponents?: { surfaceId: string; components: RefundComponent[] };
};

export function refundMessages(task: RefundTask, createSurface = true): RefundUiMessage[] {
  const pending = task.status === "awaiting_confirmation";
  const column = (id: string, appearance: string, children: string[]): RefundComponent => ({ id, component: "Column", appearance, children });
  const text = (id: string, appearance: string, value: string): RefundComponent => ({ id, component: "Text", appearance, text: value });
  const amount = `¥${(task.order.paidAmountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const orderedAt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(task.order.orderedAt));
  const components: RefundComponent[] = [
    column("root", "refund-card", ["eyebrow", "heading", "status-badge", "product", "details", "amount", "labelhint", pending ? "actions" : "result", "footer"]),
    text("eyebrow", "eyebrow", "REFUND REVIEW / 退款确认"),
    column("heading", "card-heading", ["title", "subtitle"]),
    text("title", "card-title", pending ? "请核对退款信息" : "退款处理结果"),
    text("subtitle", "subtitle", pending ? "核对订单与金额，再决定是否提交申请。" : "你的选择已保存，订单信息保留在下方。"),
    text("status-badge", "status-badge", pending ? "待确认" : task.status === "refund_submitted" ? "申请已提交" : "已取消"),
    column("product", "product-row", ["image", "product-info"]),
    { id: "image", component: "Image", url: task.order.product.imageUrl, alt: `${task.order.product.name} 产品示意图` },
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
    text("ordered-at", "detail-value", `${orderedAt}（北京时间）`),
    column("amount", "refund-amount", ["amount-label", "amount-value"]),
    text("amount-label", "amount-label", "实付款 / 本次申请退款金额"),
    text("amount-value", "amount-value", amount),
    text("labelhint", "caption", "全额退款；金额以服务器保存的订单为准。"),
    text("footer", "caption", "教学演示：没有真实订单查询、支付接口或退款到账。"),
  ];
  if (pending) components.push(
    column("actions", "card-actions", ["confirm", "cancel"]),
    text("confirm-label", "caption", "确认退款"),
    text("cancel-label", "caption", "取消"),
    { id: "confirm", component: "Button", variant: "primary", child: "confirm-label", action: { event: { name: "confirm_refund", context: { taskId: task.taskId } } } },
    { id: "cancel", component: "Button", variant: "secondary", child: "cancel-label", action: { event: { name: "cancel_refund", context: { taskId: task.taskId } } } },
  );
  else components.push(
    column("result", "result-panel", ["result-title", "result-message", ...(task.refund ? ["request-id"] : [])]),
    text("result-title", "result-title", task.status === "refund_submitted" ? "模拟退款申请已提交" : "本次操作已取消"),
    text("result-message", "result-message", task.message),
    ...(task.refund ? [text("request-id", "caption", `申请编号 · ${task.refund.requestId}`)] : []),
  );
  const update: RefundUiMessage = { version: "v0.9", updateComponents: { surfaceId: SURFACE_ID, components } };
  return createSurface
    ? [{ version: "v0.9", createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } }, update]
    : [update];
}
