import { randomUUID } from "node:crypto";
import { z } from "zod";

export type RefundDecision = "confirm" | "cancel";
export type RefundTask = {
  taskId: string;
  status: "awaiting_confirmation" | "refund_submitted" | "cancelled";
  order: {
    orderId: string; orderedAt: string;
    product: { name: string; specification: string; imageUrl: string };
    quantity: number; paidAmountCents: number; currency: "CNY";
  };
  refund?: { requestId: string; amountCents: number };
  message: string;
};

export const RefundInputSchema = z.union([
  z.object({ intent: z.literal("prepare") }).strict(),
  z.object({ taskId: z.string().uuid(), decision: z.enum(["confirm", "cancel"]) }).strict(),
]);
export type RefundInput = z.infer<typeof RefundInputSchema>;

export class RefundError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
}

// 每个服务器实例自己的内存闭包。没有模型、支付接口或真实退款操作。
export function createRefundStore() {
  const tasks = new Map<string, RefundTask>();
  return {
    prepareRefund(): RefundTask {
      const task: RefundTask = {
        taskId: randomUUID(), status: "awaiting_confirmation",
        order: {
          orderId: "OD-20260928-10086", orderedAt: "2026-09-28T10:32:00+08:00",
          product: { name: "Mac mini", specification: "M4 · 16GB 统一内存 · 256GB SSD", imageUrl: "/assets/mac-mini.png" },
          quantity: 1, paidAmountCents: 449900, currency: "CNY",
        },
        message: "订单已核对。请确认是否提交全额退款申请，或取消本次操作。",
      };
      tasks.set(task.taskId, task);
      return structuredClone(task);
    },
    decideRefund(taskId: string, decision: RefundDecision): RefundTask {
      const current = tasks.get(taskId);
      if (!current) throw new RefundError("找不到退款任务，请重新打开页面。", 404);
      const nextStatus = decision === "confirm" ? "refund_submitted" : "cancelled";
      if (current.status !== "awaiting_confirmation") {
        if (current.status !== nextStatus) throw new RefundError("任务已经结束，不能更改原来的决定。", 409);
        return structuredClone(current);
      }
      const next: RefundTask = {
        ...current, status: nextStatus,
        ...(decision === "confirm" ? { refund: { requestId: `RF-${randomUUID()}`, amountCents: current.order.paidAmountCents } } : {}),
        message: decision === "confirm"
          ? "模拟退款申请已提交，金额 ¥4,499.00；尚未到账。本演示没有调用支付或退款接口。"
          : "本次退款操作已取消，没有提交退款申请。",
      };
      tasks.set(taskId, next);
      return structuredClone(next);
    },
  };
}
export type RefundStore = ReturnType<typeof createRefundStore>;

export async function runRefundAgent(input: RefundInput, store: RefundStore): Promise<RefundTask> {
  const parsed = RefundInputSchema.parse(input);
  return "intent" in parsed ? store.prepareRefund() : store.decideRefund(parsed.taskId, parsed.decision);
}
