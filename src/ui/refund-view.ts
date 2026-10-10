import type { RefundTask } from "../agent.js";

export type Decision = "confirm" | "cancel";
export function createRefundView() {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const card = document.querySelector<HTMLElement>(".refund-card")!;
  let current: RefundTask | undefined;
  let busy = false;
  let ready = false;
  const buttons = [el<HTMLButtonElement>("confirm"), el<HTMLButtonElement>("cancel")];
  function syncButtons() { buttons.forEach(button => { button.disabled = busy || !ready || current?.status !== "awaiting_confirmation"; }); }
  return {
    get task() { return current; },
    onDecision(handler: (decision: Decision) => void) {
      buttons[0].onclick = () => handler("confirm");
      buttons[1].onclick = () => handler("cancel");
    },
    setReady(value: boolean) { ready = value; syncButtons(); },
    setBusy(value: boolean, decision?: Decision) {
      busy = value; card.setAttribute("aria-busy", String(value));
      buttons[0].textContent = value && decision === "confirm" ? "正在提交…" : "确认退款";
      buttons[1].textContent = value && decision === "cancel" ? "正在取消…" : "取消";
      syncButtons();
    },
    feedback(message: string, state = "success") { el("status").textContent = message; el("status").dataset.state = state; },
    render(input: unknown) {
      const task = input as RefundTask;
      if (!task || typeof task.taskId !== "string" || !["awaiting_confirmation", "refund_submitted", "cancelled"].includes(task.status) || !task.order || typeof task.order.product?.name !== "string" || !Number.isFinite(task.order.paidAmountCents)) throw new Error("服务未返回有效的订单数据");
      const prior = current?.status;
      current = task;
      el("product-name").textContent = task.order.product.name;
      el("product-spec").textContent = task.order.product.specification;
      el("product-quantity").textContent = `数量 × ${task.order.quantity}`;
      el("order-id").textContent = task.order.orderId;
      el("order-time").textContent = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(task.order.orderedAt));
      el("paid-amount").textContent = `¥${(task.order.paidAmountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const waiting = task.status === "awaiting_confirmation";
      document.querySelector<HTMLElement>(".refund-title")!.textContent = waiting ? "确认这笔订单的退款" : "退款处理结果";
      document.querySelector<HTMLElement>(".refund-subtitle")!.textContent = waiting ? "请核对订单信息，再决定是否继续。" : "你的选择已保存，订单信息保留在下方。";
      document.querySelector<HTMLElement>(".refund-amount + .refund-caption")!.hidden = !waiting;
      el("task-badge").textContent = waiting ? "等待确认" : task.status === "refund_submitted" ? "已提交" : "已取消";
      el("actions").hidden = !waiting;
      el("result").hidden = waiting;
      el("result-title").textContent = task.status === "refund_submitted" ? "退款申请已提交" : "本次退款已取消";
      el("result-message").textContent = task.refund ? `模拟退款单号：${task.refund.requestId}。未进行真实资金操作。` : "订单保持不变，未提交退款申请。";
      el("status").textContent = task.message;
      el("status").dataset.state = "success";
      const now = new Date();
      el<HTMLTimeElement>("received").dateTime = now.toISOString();
      el("received").textContent = `本次接收 ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
      syncButtons();
      if (prior === "awaiting_confirmation" && !waiting) el("result").focus({ preventScroll: true });
    },
  };
}
