import { EventType, type BaseEvent } from "@ag-ui/core";
import type { RefundTask } from "./agent.js";

export function refundEvents(task: RefundTask, threadId: string, runId: string, intent: "prepare" | "confirm" | "cancel"): BaseEvent[] {
  const messageId = `message-${runId}`;
  const stepName = intent === "prepare" ? "review_order" : intent === "confirm" ? "submit_refund" : "cancel_refund";
  const fragments = Array.from(task.message);
  const contents: BaseEvent[] = [];
  for (let start = 0; start < fragments.length; start += 14) {
    contents.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: fragments.slice(start, start + 14).join("") } as BaseEvent);
  }
  return [
    { type: EventType.RUN_STARTED, threadId, runId },
    { type: EventType.STEP_STARTED, stepName },
    { type: EventType.STEP_FINISHED, stepName },
    { type: EventType.STATE_SNAPSHOT, snapshot: task },
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
    ...contents,
    { type: EventType.TEXT_MESSAGE_END, messageId },
    { type: EventType.RUN_FINISHED, threadId, runId },
  ] as BaseEvent[];
}
