import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { EventEncoder } from "@ag-ui/encoder";
import { RunAgentInputSchema, EventSchema } from "@ag-ui/core/schemas";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createRefundStore, RefundError, RefundInputSchema, runRefundAgent } from "./agent.js";
import { refundEvents } from "./ag-ui.js";
import { refundMessages } from "./a2ui.js";
import { createRefundMcpServer, UI_URI } from "./mcp.js";
import { pages, sandboxPage, style } from "./templates.js";
import { validateClientMessage, validateServerMessage } from "./validation.js";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createWorkbenchStore, runWorkbench, WorkbenchInputSchema, WorkbenchError, WORKBENCH_SLOTS, workbenchEvents, PICKUP_UI_URI, WORKBENCH_UI_URI } from "./workbench.js";
import { registerWorkbenchMcp } from "./workbench-mcp.js";
import { assertWorkbenchMessages, validateWorkbenchClientMessage } from "./workbench-validation.js";

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 128 * 1024) throw new Error("请求过大");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString();
}

function send(res: ServerResponse, code: number, text: string | Buffer, mime = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(text);
}

export async function startDemoServer(port = 3210, sandboxPort = 3211) {
  const store = createRefundStore();
  const workbenchStore = createWorkbenchStore();
  let origin = "";
  let sandboxOrigin = "";
  let clientPromise: Promise<Client> | undefined;
  let workbenchClientPromise: Promise<Client> | undefined;
  const getWorkbenchClient = () => workbenchClientPromise ??= (async () => {
    const client = new Client({ name: "workbench-local-host", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp-workbench`)));
    return client;
  })();
  const getClient = () => clientPromise ??= (async () => {
    const client = new Client({ name: "refund-local-host", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
    return client;
  })();

  const host = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", origin).pathname;
      if (path === "/mcp" || path === "/mcp-workbench") {
        const text = req.method === "POST" ? await body(req) : undefined;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers.set(key, value);
        }
        const request = new Request(`${origin}${path}`, { method: req.method, headers, body: text });
        const server = path === "/mcp" ? createRefundMcpServer(store) : new McpServer({ name: "after-sales-workbench", version: "1.0.0" });
        if (path === "/mcp-workbench") registerWorkbenchMcp(server, workbenchStore);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined, enableJsonResponse: true,
          allowedHosts: [new URL(origin).host], allowedOrigins: [origin],
          enableDnsRebindingProtection: true,
        });
        await server.connect(transport);
        try {
          const response = await transport.handleRequest(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } finally { await server.close(); }
        return;
      }
      if (path.startsWith("/api/workbench/") && req.method === "POST") {
        if ((req.headers.origin && req.headers.origin !== origin) || !req.headers["content-type"]?.startsWith("application/json")) {
          send(res, 403, "工作台只接受本地宿主 JSON 请求"); return;
        }
      }
      if (path === "/api/workbench/slots" && req.method === "GET") {
        send(res, 200, JSON.stringify(WORKBENCH_SLOTS), "application/json; charset=utf-8"); return;
      }
      if (path === "/api/workbench/run" && req.method === "POST") {
        const input = RunAgentInputSchema.parse(JSON.parse(await body(req)));
        let forwarded = input.forwardedProps;
        if (forwarded?.intent === "action") {
          const wrapper = z.object({ intent: z.literal("action"), message: z.unknown() }).strict().parse(forwarded);
          if (!validateWorkbenchClientMessage(wrapper.message)) throw new WorkbenchError("A2UI Action 不符合目录与正式消息格式", 400);
          const action = (wrapper.message as { action: { name: string; sourceComponentId: string; surfaceId: string; context: {taskId:string;version:number} } }).action;
          const decision = action.name === "confirm_refund" ? "confirm" : action.name === "cancel_refund" ? "cancel" : undefined;
          if (!decision || action.sourceComponentId !== decision || action.surfaceId !== "workbench") throw new WorkbenchError("Action 来源不匹配", 400);
          forwarded = { intent: "decide", ...action.context, decision };
        }
        const intent = WorkbenchInputSchema.parse(forwarded);
        const task = await runWorkbench(intent, workbenchStore);
        const events = workbenchEvents(task, input.threadId, input.runId, intent.intent === "prepare" || intent.intent === "resume", intent.intent);
        for (const event of events) {
          const parsed = EventSchema.parse(event);
          if (parsed.type === "ACTIVITY_SNAPSHOT") assertWorkbenchMessages(parsed.content.a2ui_operations);
        }
        const encoder = new EventEncoder({ accept: "text/event-stream" });
        res.writeHead(200, { "Content-Type": encoder.getContentType(), "Cache-Control": "no-cache", "Connection": "keep-alive" }); res.flushHeaders();
        for (const event of events) {
          if (res.destroyed) break;
          res.write(encoder.encode(event));
          if (event.type === "TEXT_MESSAGE_CONTENT") await delay(45);
        }
        res.end(); return;
      }
      if (path === "/api/workbench/bootstrap" && req.method === "POST") {
        const input = z.object({ kind: z.enum(["pickup", "workbench"]), taskId: z.string().uuid().optional() }).strict().parse(JSON.parse(await body(req)));
        if (input.kind === "pickup" && !input.taskId) throw new WorkbenchError("取件面板必须关联任务", 400);
        const client = await getWorkbenchClient();
        const name = input.kind === "pickup" ? "review_pickup" : "view_workbench_app";
        const listed = await client.listTools();
        const tool = listed.tools.find(t => t.name === name);
        const uri = (tool?._meta?.ui as {resourceUri?:string})?.resourceUri;
        if (uri !== (input.kind === "pickup" ? PICKUP_UI_URI : WORKBENCH_UI_URI)) throw new WorkbenchError("工具 UI 资源不匹配", 500);
        const result = await client.callTool({ name, arguments: input.taskId ? { taskId: input.taskId } : {} });
        if (result.isError) throw new WorkbenchError(result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), 400);
        const resource = await client.readResource({ uri });
        const html = resource.contents.find(c => "text" in c);
        if (!html || !("text" in html)) throw new WorkbenchError("缺少 HTML 资源", 500);
        send(res, 200, JSON.stringify({ html: html.text, result, sandboxOrigin, resourceUri: uri }), "application/json; charset=utf-8"); return;
      }
      if (path === "/api/workbench/call" && req.method === "POST") {
        const input = z.object({ name: z.enum(["review_pickup", "save_pickup", "review_workbench_a2ui", "decide_workbench"]), arguments: z.record(z.string(), z.unknown()) }).strict().parse(JSON.parse(await body(req)));
        const client = await getWorkbenchClient();
        const result = await client.callTool(input);
        send(res, 200, JSON.stringify(result), "application/json; charset=utf-8"); return;
      }
      if (path === "/api/ag-ui" && req.method === "POST") {
        const input = RunAgentInputSchema.parse(JSON.parse(await body(req)));
        const intent = RefundInputSchema.parse(input.forwardedProps);
        const task = await runRefundAgent(intent, store);
        const encoder = new EventEncoder({ accept: "text/event-stream" });
        res.writeHead(200, { "Content-Type": encoder.getContentType(), "Cache-Control": "no-cache", "Connection": "keep-alive" });
        res.flushHeaders();
        for (const event of refundEvents(task, input.threadId, input.runId, "intent" in intent ? "prepare" : intent.decision)) {
          EventSchema.parse(event);
          res.write(encoder.encode(event));
          if (event.type === "TEXT_MESSAGE_CONTENT") await delay(12);
        }
        res.end();
        return;
      }
      if (path === "/api/a2ui" && req.method === "POST") {
        const input = JSON.parse(await body(req));
        const action = input?.action;
        let task;
        if (!action) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 0) {
            throw new RefundError("初始化参数必须是空对象。", 400);
          }
          task = await runRefundAgent({ intent: "prepare" }, store);
        } else {
          const decision = action.name === "confirm_refund" ? "confirm" : action.name === "cancel_refund" ? "cancel" : undefined;
          if (!validateClientMessage(input) || !decision || action.surfaceId !== "refund" || action.sourceComponentId !== decision || Object.keys(action.context).length !== 1) {
            throw new RefundError("无效 A2UI 动作或不匹配的 Surface/组件。", 400);
          }
          const intent = RefundInputSchema.parse({ taskId: action.context.taskId, decision });
          task = await runRefundAgent(intent, store);
        }
        const messages = refundMessages(task, !action);
        for (const message of messages) if (!validateServerMessage(message)) throw new Error(JSON.stringify(validateServerMessage.errors));
        send(res, 200, messages.map(message => JSON.stringify(message)).join("\n") + "\n", "application/jsonl; charset=utf-8");
        return;
      }
      if (path === "/api/mcp/bootstrap" && req.method === "GET") {
        const client = await getClient();
        const tools = await client.listTools();
        const tool = tools.tools.find(tool => tool.name === "review_refund");
        const uri = (tool?._meta?.ui as { resourceUri?: string })?.resourceUri;
        if (uri !== UI_URI) throw new Error("工具未关联预期 UI 资源");
        const [result, resource] = await Promise.all([
          client.callTool({ name: "review_refund", arguments: {} }),
          client.readResource({ uri }),
        ]);
        const html = resource.contents.find(content => "text" in content);
        if (!html || !("text" in html)) throw new Error("缺少 HTML 资源");
        send(res, 200, JSON.stringify({ html: html.text, result, sandboxOrigin, resourceUri: uri }), "application/json; charset=utf-8");
        return;
      }
      if (path === "/api/mcp/call" && req.method === "POST") {
        const params = JSON.parse(await body(req));
        if (params.name !== "decide_refund") { send(res, 403, "本地 Host 仅允许 decide_refund"); return; }
        const input = RefundInputSchema.parse(params.arguments);
        if ("intent" in input) throw new RefundError("决定工具必须提供 taskId 与 decision。", 400);
        const client = await getClient();
        const result = await client.callTool({ name: "decide_refund", arguments: input });
        if (result.isError) {
          const detail = (result.structuredContent as { error?: { code?: number; message?: string } } | undefined)?.error;
          send(res, detail?.code ?? 400, detail?.message ?? "退款决定失败。"); return;
        }
        send(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
        return;
      }
      if (path === "/style.css") { send(res, 200, style, "text/css; charset=utf-8"); return; }
      if (path === "/assets/mac-mini.png" && req.method === "GET") {
        send(res, 200, await readFile(new URL("../assets/mac-mini.png", import.meta.url)), "image/png"); return;
      }
      if (/^\/assets\/(ag-ui|a2ui|host|workbench)\.js$/.test(path)) {
        send(res, 200, await readFile(new URL(`../dist${path}`, import.meta.url), "utf8"), "text/javascript; charset=utf-8"); return;
      }
      if (path in pages) {
        res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self'; frame-src ${sandboxOrigin}; connect-src 'self'`);
        send(res, 200, pages[path as keyof typeof pages], "text/html; charset=utf-8"); return;
      }
      send(res, 404, "没有这个入口");
    })().catch(error => {
      if (!res.headersSent) send(res, error instanceof RefundError || error instanceof WorkbenchError ? error.statusCode : error?.name === "ZodError" || error instanceof SyntaxError ? 400 : 500, error instanceof Error ? error.message : String(error));
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    host.once("error", reject); host.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(host.address() as { port: number }).port}`;

  const sandbox = createServer((req, res) => {
    if (req.url !== "/sandbox") { send(res, 404, "Not found"); return; }
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:");
    send(res, 200, sandboxPage(origin), "text/html; charset=utf-8");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      sandbox.once("error", reject); sandbox.listen(sandboxPort, "127.0.0.1", resolve);
    });
  } catch (error) { host.close(); throw error; }
  sandboxOrigin = `http://127.0.0.1:${(sandbox.address() as { port: number }).port}`;

  return {
    origin, sandboxOrigin, workbenchOrigin: `${origin}/mcp-workbench`,
    async close() {
      if (clientPromise) await (await clientPromise).close();
      if (workbenchClientPromise) await (await workbenchClientPromise).close();
      host.closeAllConnections(); sandbox.closeAllConnections();
      await Promise.all([new Promise<void>(resolve => host.close(() => resolve())), new Promise<void>(resolve => sandbox.close(() => resolve()))]);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startDemoServer(Number(process.env.DEMO_PORT ?? 3210), Number(process.env.DEMO_SANDBOX_PORT ?? 3211));
  console.log(`退款协议实验：${app.origin} · Sandbox：${app.sandboxOrigin}`);
  process.on("SIGINT", () => { void app.close().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { void app.close().then(() => process.exit(0)); });
}
