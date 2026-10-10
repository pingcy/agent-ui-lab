import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { createRefundView } from "./refund-view.js";

const app = new App({ name: "订单退款确认", version: "2.1.0" }, {});
const view = createRefundView();
function render(result: { isError?: boolean; structuredContent?: unknown }) {
  if (result.isError) throw new Error("退款工具返回错误，请重试");
  view.render(result.structuredContent);
}
function applyContext(context: McpUiHostContext) {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.safeAreaInsets) {
    const { top, right, bottom, left } = context.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}
// 所有回调先注册，避免丢失宿主推送的首次工具结果。
app.ontoolresult = result => { try { render(result); } catch (error) { view.feedback(`加载失败：${String(error)}`, "error"); } };
app.addEventListener("hostcontextchanged", applyContext);
app.onteardown = async () => { view.setReady(false); return {}; };
view.onDecision(async decision => {
  if (!view.task) return;
  view.setBusy(true, decision);
  view.feedback("正在通过宿主提交你的选择…", "loading");
  try {
    const result = await app.callServerTool({ name: "decide_refund", arguments: { taskId: view.task.taskId, decision } });
    render(result);
  } catch (error) { view.feedback(`提交失败，可重试：${String(error)}`, "error"); }
  finally { view.setBusy(false); }
});
try {
  await app.connect();
  const context = app.getHostContext();
  if (context) applyContext(context);
  view.setReady(true);
  if (!view.task) view.feedback("宿主已连接，等待订单…", "loading");
} catch (error) { view.feedback(`连接失败：${String(error)}`, "error"); }
