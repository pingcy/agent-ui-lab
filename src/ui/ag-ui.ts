import { HttpAgent } from "@ag-ui/client";
import { createRefundView, type Decision } from "./refund-view.js";

const view = createRefundView();
const answer = document.querySelector<HTMLElement>("#answer")!;
const log = document.querySelector<HTMLElement>("#events")!;
const agent = new HttpAgent({ url: "/api/ag-ui", threadId: crypto.randomUUID() });
let running = false;
async function run(decision?: Decision) {
  if (running) return;
  running = true;
  view.setBusy(true, decision);
  answer.textContent = "";
  view.feedback(decision ? "正在提交你的选择…" : "正在核对订单…", "loading");
  try {
    await agent.runAgent({ forwardedProps: decision ? { taskId: view.task!.taskId, decision } : { intent: "prepare" } }, {
      onEvent({ event }) { log.textContent += JSON.stringify(event) + "\n"; },
      onStepStartedEvent({ event }) { view.feedback(`${event.stepName}…`, "loading"); },
      onStateSnapshotEvent({ event }) { view.render(event.snapshot); },
      onTextMessageContentEvent({ event, textMessageBuffer }) { answer.textContent = textMessageBuffer + event.delta; },
    });
    // 本次运行结束时，业务任务可能仍在等待用户确认。
    view.setReady(true);
  } catch (error) { view.feedback(`请求失败，可重试：${String(error)}`, "error"); }
  finally { running = false; view.setBusy(false); }
}
view.onDecision(decision => { void run(decision); });
void run();
