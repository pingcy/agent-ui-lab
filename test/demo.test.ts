import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefundStore, runRefundAgent, type RefundTask } from "../src/agent.js";
import { refundMessages, CATALOG_ID } from "../src/a2ui.js";
import { validateServerMessage, validateClientMessage } from "../src/validation.js";
import { refundEvents } from "../src/ag-ui.js";
import { EventSchema } from "@ag-ui/core/schemas";
import { HttpAgent } from "@ag-ui/client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startDemoServer } from "../src/server.js";
import { UI_URI } from "../src/mcp.js";

const action = (taskId: string, decision: "confirm" | "cancel") => ({
  version: "v0.9", action: {
    name: decision === "confirm" ? "confirm_refund" : "cancel_refund", surfaceId: "refund",
    sourceComponentId: decision, timestamp: new Date().toISOString(), context: { taskId },
  },
});
const post = (url: string, input: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
const jsonl = async (response: Response) => {
  assert.equal(response.status, 200);
  return (await response.text()).trim().split("\n").map(line => JSON.parse(line));
};
const taskResult = (result: unknown) => (result as { structuredContent: RefundTask }).structuredContent;

test("每次准备退款创建独立任务，确认只模拟提交申请并保持幂等", async () => {
  const store = createRefundStore();
  const first = await runRefundAgent({ intent: "prepare" }, store);
  const second = await runRefundAgent({ intent: "prepare" }, store);
  assert.notEqual(first.taskId, second.taskId);
  assert.equal(first.status, "awaiting_confirmation");
  assert.deepEqual(first.order, {
    orderId: "OD-20260928-10086", orderedAt: "2026-09-28T10:32:00+08:00",
    product: { name: "Mac mini", specification: "M4 · 16GB 统一内存 · 256GB SSD", imageUrl: "/assets/mac-mini.png" },
    quantity: 1, paidAmountCents: 449900, currency: "CNY",
  });
  const confirmed = await runRefundAgent({ taskId: first.taskId, decision: "confirm" }, store);
  assert.equal(confirmed.status, "refund_submitted");
  assert.equal(confirmed.refund?.amountCents, 449900);
  assert.ok(confirmed.refund?.requestId);
  assert.match(confirmed.message, /申请已提交/);
  assert.match(confirmed.message, /未到账/);
  assert.deepEqual(await runRefundAgent({ taskId: first.taskId, decision: "confirm" }, store), confirmed);
  await assert.rejects(runRefundAgent({ taskId: first.taskId, decision: "cancel" }, store), { statusCode: 409 });
  const cancelled = await runRefundAgent({ taskId: second.taskId, decision: "cancel" }, store);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.refund, undefined);
  assert.deepEqual(await runRefundAgent({ taskId: second.taskId, decision: "cancel" }, store), cancelled);
  await assert.rejects(runRefundAgent({ taskId: second.taskId, decision: "confirm" }, store), { statusCode: 409 });
});

test("调用者不能通过修改返回对象或输入金额改变退款；不同内存实例隔离", async () => {
  const store = createRefundStore();
  const task = await runRefundAgent({ intent: "prepare" }, store);
  task.order.paidAmountCents = 1;
  const submitted = await runRefundAgent({ taskId: task.taskId, decision: "confirm" }, store);
  assert.equal(submitted.order.paidAmountCents, 449900);
  assert.equal(submitted.refund?.amountCents, 449900);
  await assert.rejects(runRefundAgent({ taskId: task.taskId, decision: "confirm", amountCents: 1 } as any, store));
  const elsewhere = await runRefundAgent({ intent: "prepare" }, createRefundStore());
  await assert.rejects(runRefundAgent({ taskId: elsewhere.taskId, decision: "confirm" }, store), { statusCode: 404 });
});

test("官方 HttpAgent 通过真实 SSE 准备、确认与重复确认，运行结束不替代业务状态", async () => {
  const server = await startDemoServer(0, 0);
  try {
    const agent = new HttpAgent({ url: `${server.origin}/api/ag-ui`, threadId: "refund-http-test" });
    const events: string[] = [];
    let text = "";
    await agent.runAgent({ forwardedProps: { intent: "prepare" } }, {
      onEvent({ event }) { EventSchema.parse(event); events.push(event.type); },
      onTextMessageContentEvent({ event, textMessageBuffer }) { text = textMessageBuffer + event.delta; },
    });
    const prepared = structuredClone(agent.state) as RefundTask;
    assert.equal(prepared.status, "awaiting_confirmation");
    assert.equal(prepared.order.paidAmountCents, 449900);
    assert.equal(events.at(-1), "RUN_FINISHED");
    assert.ok(events.includes("STEP_STARTED"));
    assert.ok(events.filter(type => type === "TEXT_MESSAGE_CONTENT").length > 1);
    assert.equal(text, prepared.message);
    await agent.runAgent({ forwardedProps: { taskId: prepared.taskId, decision: "confirm" } });
    const submitted = structuredClone(agent.state) as RefundTask;
    assert.equal(submitted.status, "refund_submitted");
    await agent.runAgent({ forwardedProps: { taskId: prepared.taskId, decision: "confirm" } });
    assert.deepEqual(agent.state, submitted);
    const rawInput = { threadId: "raw", runId: "raw-run", state: {}, messages: [], tools: [], context: [] };
    const conflict = await post(`${server.origin}/api/ag-ui`, { ...rawInput, forwardedProps: { taskId: prepared.taskId, decision: "cancel" } });
    assert.equal(conflict.status, 409);
    const tampered = await post(`${server.origin}/api/ag-ui`, { ...rawInput, forwardedProps: { taskId: prepared.taskId, decision: "confirm", amountCents: 1 } });
    assert.equal(tampered.status, 400);
  } finally { await server.close(); }
});

test("A2UI HTTP 正式 Action 确认/取消幂等，金额与动作来源受约束", async () => {
  const server = await startDemoServer(0, 0);
  try {
    const first = await jsonl(await post(`${server.origin}/api/a2ui`, {}));
    const second = await jsonl(await post(`${server.origin}/api/a2ui`, {}));
    const taskId = first[1].updateComponents.components.find((item: any) => item.id === "confirm").action.event.context.taskId;
    const otherId = second[1].updateComponents.components.find((item: any) => item.id === "confirm").action.event.context.taskId;
    assert.notEqual(taskId, otherId);
    const input = action(taskId, "confirm");
    assert.equal(validateClientMessage(input), true, JSON.stringify(validateClientMessage.errors));
    const submitted = await jsonl(await post(`${server.origin}/api/a2ui`, input));
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].createSurface, undefined);
    assert.ok(submitted[0].updateComponents.components.some((item: any) => item.id === "result-title" && item.text === "模拟退款申请已提交"));
    assert.deepEqual(await jsonl(await post(`${server.origin}/api/a2ui`, input)), submitted);
    assert.equal((await post(`${server.origin}/api/a2ui`, action(taskId, "cancel"))).status, 409);
    const cancelled = await jsonl(await post(`${server.origin}/api/a2ui`, action(otherId, "cancel")));
    assert.ok(cancelled[0].updateComponents.components.some((item: any) => item.id === "result-title" && item.text === "本次操作已取消"));
    assert.equal((await post(`${server.origin}/api/a2ui`, { ...input, action: { ...input.action, context: { taskId, amountCents: 1 } } })).status, 400);
    assert.equal((await post(`${server.origin}/api/a2ui`, { ...input, action: { ...input.action, sourceComponentId: "cancel" } })).status, 400);
    assert.equal((await post(`${server.origin}/api/a2ui`, { ...input, action: { ...input.action, timestamp: "not-a-time" } })).status, 400);
    assert.equal(validateClientMessage({ action: { event: { name: "confirm_refund" } } }), false);
  } finally { await server.close(); }
});

test("MCP HTTP 工具关联退款单文件视图，UI决定、幂等与Host错误码真实往返", async () => {
  const server = await startDemoServer(0, 0);
  const client = new Client({ name: "refund-test-client", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp`)));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(item => item.name).sort(), ["decide_refund", "review_refund"]);
    assert.equal((tools.tools.find(item => item.name === "review_refund")!._meta?.ui as any).resourceUri, UI_URI);
    assert.deepEqual((tools.tools.find(item => item.name === "decide_refund")!._meta?.ui as any).visibility, ["app"]);
    const prepared = taskResult(await client.callTool({ name: "review_refund", arguments: {} }));
    const resource = await client.readResource({ uri: UI_URI });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    const html = (resource.contents[0] as any).text as string;
    for (const id of ["confirm", "cancel", "task-badge", "result-title"]) assert.ok(new RegExp(`\\bid="${id}"`).test(html), `MCP HTML缺少 ${id}`);
    assert.ok(/data:image\/png;base64,/.test(html), "MCP图片应内联为data URI");
    assert.equal(/<script[^>]+src=/.test(html), false, "MCP App不应依赖外部脚本");
    const decided = await client.callTool({ name: "decide_refund", arguments: { taskId: prepared.taskId, decision: "confirm" } });
    assert.equal(taskResult(decided).refund?.amountCents, 449900);
    assert.deepEqual(await client.callTool({ name: "decide_refund", arguments: { taskId: prepared.taskId, decision: "confirm" } }), decided);
    const conflict = await client.callTool({ name: "decide_refund", arguments: { taskId: prepared.taskId, decision: "cancel" } });
    assert.equal(conflict.isError, true);
    assert.equal((conflict.structuredContent as any).error.code, 409);
    const first = await fetch(`${server.origin}/api/mcp/bootstrap`).then(response => response.json());
    const second = await fetch(`${server.origin}/api/mcp/bootstrap`).then(response => response.json());
    assert.notEqual(first.result.structuredContent.taskId, second.result.structuredContent.taskId);
    assert.notEqual(new URL(first.sandboxOrigin).origin, server.origin);
    const sandbox = await fetch(`${server.sandboxOrigin}/sandbox`);
    assert.match(sandbox.headers.get("content-security-policy") ?? "", /(?:^|;)\s*img-src data:\s*(?:;|$)/);
    const input = { name: "decide_refund", arguments: { taskId: first.result.structuredContent.taskId, decision: "cancel" } };
    const cancelled = await post(`${server.origin}/api/mcp/call`, input).then(response => response.json());
    assert.equal(cancelled.structuredContent.status, "cancelled");
    assert.equal((await post(`${server.origin}/api/mcp/call`, { ...input, arguments: { ...input.arguments, decision: "confirm" } })).status, 409);
    assert.equal((await post(`${server.origin}/api/mcp/call`, { ...input, arguments: { ...input.arguments, amountCents: 1 } })).status, 400);
    assert.equal((await post(`${server.origin}/api/mcp/call`, { name: "review_refund", arguments: {} })).status, 403);
    const image = await fetch(`${server.origin}/assets/mac-mini.png`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally { await client.close(); await server.close(); }
});

test("同一任务可跨协议延续，但另一次初始加载不复用任务", async () => {
  const server = await startDemoServer(0, 0);
  try {
    const agent = new HttpAgent({ url: `${server.origin}/api/ag-ui`, threadId: "cross-protocol" });
    await agent.runAgent({ forwardedProps: { intent: "prepare" } });
    const prepared = structuredClone(agent.state) as RefundTask;
    const result = await post(`${server.origin}/api/mcp/call`, { name: "decide_refund", arguments: { taskId: prepared.taskId, decision: "confirm" } }).then(response => response.json());
    assert.equal(result.structuredContent.taskId, prepared.taskId);
    assert.equal(result.structuredContent.status, "refund_submitted");
    await agent.runAgent({ forwardedProps: { taskId: prepared.taskId, decision: "confirm" } });
    assert.deepEqual(agent.state, result.structuredContent);
    assert.equal((await post(`${server.origin}/api/a2ui`, action(prepared.taskId, "cancel"))).status, 409);
    const fresh = await jsonl(await post(`${server.origin}/api/a2ui`, {}));
    const context = fresh[1].updateComponents.components.find((item: any) => item.id === "confirm").action.event.context;
    assert.notEqual(context.taskId, prepared.taskId);
  } finally { await server.close(); }
});

test("AG-UI 返回整个退款任务、步骤事件和分片文字", async () => {
  const task = await runRefundAgent({ intent: "prepare" }, createRefundStore());
  const events = refundEvents(task, "thread-refund", "run-refund", "prepare");
  for (const event of events) EventSchema.parse(event);
  assert.equal(events[0].type, "RUN_STARTED");
  assert.equal(events.at(-1)?.type, "RUN_FINISHED");
  assert.deepEqual((events.find(event => event.type === "STATE_SNAPSHOT") as any).snapshot, task);
  assert.ok(events.some(event => event.type === "STEP_STARTED"));
  assert.ok(events.some(event => event.type === "STEP_FINISHED"));
  const fragments = events.filter(event => event.type === "TEXT_MESSAGE_CONTENT");
  assert.ok(fragments.length > 1);
  assert.equal(fragments.map(event => (event as any).delta).join(""), task.message);
});

test("A2UI 受控目录提供订单、图片、金额与任务绑定动作，终态替换操作区", async () => {
  const store = createRefundStore();
  const task = await runRefundAgent({ intent: "prepare" }, store);
  const messages = refundMessages(task);
  for (const message of messages) assert.equal(validateServerMessage(message), true, JSON.stringify(validateServerMessage.errors));
  assert.equal(messages[0].createSurface?.surfaceId, "refund");
  assert.equal(messages[0].createSurface?.catalogId, CATALOG_ID);
  const components = messages[1].updateComponents!.components;
  const component = (id: string) => { const found = components.find(item => item.id === id); assert.ok(found); return found; };
  assert.equal(component("image").component, "Image");
  assert.equal(component("image").url, "/assets/mac-mini.png");
  assert.equal(component("image").alt, "Mac mini 产品示意图");
  assert.equal(component("amount-value").text, "¥4,499.00");
  assert.deepEqual(component("confirm").action, { event: { name: "confirm_refund", context: { taskId: task.taskId } } });
  assert.deepEqual(component("cancel").action, { event: { name: "cancel_refund", context: { taskId: task.taskId } } });
  const ids = new Set(components.map(item => item.id));
  assert.equal(ids.size, components.length);
  for (const item of components) {
    for (const child of item.children ?? []) assert.ok(ids.has(child));
    if (item.child) assert.ok(ids.has(item.child));
  }
  const invalid = structuredClone(messages[1]);
  Object.assign(invalid.updateComponents!.components[0], { style: "position:fixed" });
  assert.equal(validateServerMessage(invalid), false);
  const unknown = structuredClone(messages[1]);
  Object.assign(unknown.updateComponents!.components[0], { appearance: "unknown-css" });
  assert.equal(validateServerMessage(unknown), false);
  const terminal = refundMessages(await runRefundAgent({ taskId: task.taskId, decision: "confirm" }, store), false);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].createSurface, undefined);
  for (const message of terminal) assert.equal(validateServerMessage(message), true, JSON.stringify(validateServerMessage.errors));
  assert.ok(terminal[0].updateComponents!.components.some(item => item.id === "result-title"));
  assert.ok(!terminal[0].updateComponents!.components.some(item => item.component === "Button"));
});
