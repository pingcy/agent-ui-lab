import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { RefundError, runRefundAgent, type RefundStore } from "./agent.js";

export const UI_URI = "ui://refund/view.html";

export function createRefundMcpServer(store: RefundStore) {
  const server = new McpServer({ name: "refund-demo", version: "1.0.0" });
  registerAppTool(server, "review_refund", {
    description: "准备独立的订单退款确认任务，展示商品、订单和全额退款金额；不提交退款",
    inputSchema: z.object({}).strict(),
    _meta: { ui: { resourceUri: UI_URI, visibility: ["model", "app"] } },
  }, async () => {
    const task = await runRefundAgent({ intent: "prepare" }, store);
    return { content: [{ type: "text", text: task.message }], structuredContent: task };
  });
  registerAppTool(server, "decide_refund", {
    description: "接收用户对退款任务的确认或取消；确认仅模拟提交申请，非到账",
    inputSchema: z.object({ taskId: z.string().uuid(), decision: z.enum(["confirm", "cancel"]) }).strict(),
    _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
  }, async (input) => {
    try {
      const task = await runRefundAgent(input, store);
      return { content: [{ type: "text", text: task.message }], structuredContent: task };
    } catch (error) {
      if (!(error instanceof RefundError)) throw error;
      return {
        isError: true, content: [{ type: "text", text: error.message }],
        structuredContent: { error: { code: error.statusCode, message: error.message } },
      };
    }
  });
  registerAppResource(server, "refund-view", UI_URI, {
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
  }, async () => ({
    contents: [{
      uri: UI_URI, mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(new URL("../dist/refund-app.html", import.meta.url), "utf8"),
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
    }],
  }));
  return server;
}
