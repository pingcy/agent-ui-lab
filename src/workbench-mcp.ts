import { readFile } from "node:fs/promises";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  PICKUP_UI_URI, WORKBENCH_UI_URI, WORKBENCH_SLOTS, SavePickupSchema, WorkbenchDecisionSchema,
  WorkbenchError, workbenchMessages, type WorkbenchStore, type WorkbenchTask,
} from "./workbench.js";
import { assertWorkbenchMessages } from "./workbench-validation.js";

export { PICKUP_UI_URI, WORKBENCH_UI_URI } from "./workbench.js";
const taskInput = z.object({ taskId: z.string().uuid() }).strict();
const optionalTaskInput = z.object({ taskId: z.string().uuid().optional() }).strict();
const textResult = (task: WorkbenchTask) => ({ type: "text" as const, text: task.message });
const pickupResult = (task: WorkbenchTask): CallToolResult => ({ content: [textResult(task)], structuredContent: { task, slots: WORKBENCH_SLOTS.map(slot => ({ ...slot })) } });
function a2uiResult(task: WorkbenchTask): CallToolResult {
  const messages = workbenchMessages(task, true, false);
  assertWorkbenchMessages(messages);
  return {
    content: [textResult(task), { type: "resource", resource: {
      uri: `a2ui://after-sales/${task.taskId}`, mimeType: "application/a2ui+json", text: JSON.stringify(messages),
    } }],
    structuredContent: { task, messages, slots: WORKBENCH_SLOTS.map(slot => ({ ...slot })) },
  };
}
async function safe(callback: () => CallToolResult | Promise<CallToolResult>): Promise<CallToolResult> {
  try { return await callback(); }
  catch (error) {
    if (!(error instanceof WorkbenchError)) throw error;
    return { isError: true, content: [{ type: "text", text: error.message }], structuredContent: { error: { code: error.statusCode, message: error.message } } };
  }
}

export function registerWorkbenchMcp(server: McpServer, store: WorkbenchStore): void {
  registerAppTool(server, "review_pickup", {
    description: "读取模拟售后任务的取件安排，展示取件面板；不提交退款。",
    inputSchema: taskInput,
    _meta: { ui: { resourceUri: PICKUP_UI_URI, visibility: ["model", "app"] } },
  }, input => safe(() => pickupResult(store.read(input.taskId))));
  registerAppTool(server, "save_pickup", {
    description: "保存用户选择的模拟取件时段，返回业务回执；不会提交退款，也不会实际安排快递。",
    inputSchema: SavePickupSchema,
    _meta: { ui: { resourceUri: PICKUP_UI_URI, visibility: ["app"] } },
  }, input => safe(() => pickupResult(store.savePickup(input))));
  server.registerTool("review_workbench_a2ui", {
    description: "通过普通 MCP 工具返回 A2UI 界面消息。需要能渲染 A2UI 的宿主，不依赖 MCP Apps。",
    inputSchema: optionalTaskInput,
  }, input => safe(() => a2uiResult(input.taskId ? store.read(input.taskId) : store.prepare())));
  registerAppTool(server, "decide_workbench", {
    description: "接收用户明确确认/取消。确认前必须已有取件回执；确认仅模拟提交退款申请，非到账。",
    inputSchema: WorkbenchDecisionSchema,
    _meta: { ui: { resourceUri: WORKBENCH_UI_URI, visibility: ["app"] } },
  }, input => safe(() => a2uiResult(store.decide(input))));
  registerAppTool(server, "view_workbench_app", {
    description: "打开内置 A2UI renderer 的 MCP App，宿主只需要支持 MCP Apps。",
    inputSchema: optionalTaskInput,
    _meta: { ui: { resourceUri: WORKBENCH_UI_URI, visibility: ["model", "app"] } },
  }, input => safe(() => a2uiResult(input.taskId ? store.read(input.taskId) : store.prepare())));
  for (const [name, uri, file] of [
    ["pickup-view", PICKUP_UI_URI, "pickup-app.html"],
    ["workbench-view", WORKBENCH_UI_URI, "workbench-app.html"],
  ]) registerAppResource(server, name, uri, {
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
  }, async () => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE,
    text: await readFile(new URL(`../dist/${file}`, import.meta.url), "utf8"),
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
  }] }));
}
