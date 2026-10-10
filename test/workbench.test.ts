import { test } from "node:test";
import assert from "node:assert/strict";
import { EventSchema } from "@ag-ui/core/schemas";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { HttpAgent } from "@ag-ui/client";
import { createRefundStore } from "../src/agent.js";
import { startDemoServer } from "../src/server.js";
import { assertWorkbenchMessages, validateWorkbenchServerMessage } from "../src/workbench-validation.js";
import {
  createWorkbenchStore, runWorkbench, WorkbenchInputSchema, workbenchMessages, workbenchEvents,
  WORKBENCH_CATALOG_ID, WORKBENCH_SURFACE_ID, WORKBENCH_SLOTS, PICKUP_UI_URI, WORKBENCH_UI_URI,
  type WorkbenchTask, type WorkbenchUiMessage,
} from "../src/workbench.js";

test("工作台新任务彼此独立，也不与上篇旧退款 store 共享", () => {
  const store = createWorkbenchStore();
  const first = store.prepare();
  const second = store.prepare();
  assert.notEqual(first.taskId, second.taskId);
  assert.equal(first.version, 1);
  assert.equal(first.status, "awaiting_confirmation");
  assert.equal(first.pickup, undefined);
  assert.equal(first.refund, undefined);
  assert.throws(() => createWorkbenchStore().read(first.taskId), { statusCode: 404 });
  const oldStore = createRefundStore();
  const old = oldStore.prepareRefund();
  assert.throws(() => store.read(old.taskId), { statusCode: 404 });
  assert.throws(() => oldStore.decideRefund(first.taskId, "confirm"), { statusCode: 404 });
});

test("没有有效取件安排不能确认退款，但可以取消", () => {
  const store = createWorkbenchStore();
  const task = store.prepare();
  assert.throws(() => store.decide({ taskId: task.taskId, decision: "confirm", version: task.version }), { statusCode: 409 });
  assert.deepEqual(store.read(task.taskId), task);
  const cancelled = store.decide({ taskId: task.taskId, decision: "cancel", version: task.version });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.version, 2);
  assert.equal(cancelled.refund, undefined);
});

test("保存取件只写取件回执，不提交退款；同一次重试保持幂等", () => {
  const store = createWorkbenchStore();
  const task = store.prepare();
  const input = { taskId: task.taskId, slotId: WORKBENCH_SLOTS[0].id, version: task.version };
  const saved = store.savePickup(input);
  assert.equal(saved.version, 2);
  assert.equal(saved.status, "awaiting_confirmation");
  assert.equal(saved.refund, undefined);
  assert.equal(saved.pickup?.version, 2);
  assert.equal(saved.pickup?.slotId, WORKBENCH_SLOTS[0].id);
  assert.equal(saved.pickup?.label, WORKBENCH_SLOTS[0].label);
  assert.ok(saved.pickup?.arrangementId.startsWith("PK-"));
  assert.deepEqual(store.savePickup(input), saved);
  assert.deepEqual(store.savePickup({ ...input, version: saved.version }), saved);
});

test("取件改选递增版本；并发旧版本、无效时段和非整数版本均拒绝", () => {
  const store = createWorkbenchStore();
  const task = store.prepare();
  const saved = store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 });
  assert.throws(() => store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[1].id, version: 1 }), { statusCode: 409 });
  assert.throws(() => store.savePickup({ taskId: task.taskId, slotId: "made-up", version: 2 }), { statusCode: 400 });
  assert.throws(() => store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[1].id, version: 1.5 }));
  assert.deepEqual(store.read(task.taskId), saved);
  const changed = store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[1].id, version: 2 });
  assert.equal(changed.version, 3);
  assert.notEqual(changed.pickup?.arrangementId, saved.pickup?.arrangementId);
  assert.throws(() => store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 }), { statusCode: 409 });
  assert.deepEqual(store.read(task.taskId), changed);
});

test("Agent 接收回执后重新读取业务状态，拒绝伪造、其他任务及过期回执", async () => {
  const store = createWorkbenchStore();
  const first = await runWorkbench({ intent: "prepare" }, store);
  const second = await runWorkbench({ intent: "prepare" }, store);
  await assert.rejects(runWorkbench({ intent: "pickup_saved", taskId: first.taskId, arrangementId: "PK-fake", version: 1 }, store), { statusCode: 409 });
  const saved = store.savePickup({ taskId: first.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 });
  const receipt = { intent: "pickup_saved" as const, taskId: first.taskId, arrangementId: saved.pickup!.arrangementId, version: saved.pickup!.version };
  assert.deepEqual(await runWorkbench(receipt, store), saved);
  assert.deepEqual(await runWorkbench(receipt, store), saved);
  await assert.rejects(runWorkbench({ ...receipt, arrangementId: "PK-forged" }, store), { statusCode: 409 });
  await assert.rejects(runWorkbench({ ...receipt, taskId: second.taskId }, store), { statusCode: 409 });
  await assert.rejects(runWorkbench({ ...receipt, version: 1 }, store), { statusCode: 409 });
  const changed = store.savePickup({ taskId: first.taskId, slotId: WORKBENCH_SLOTS[1].id, version: saved.version });
  await assert.rejects(runWorkbench(receipt, store), { statusCode: 409 });
  assert.deepEqual(await runWorkbench({ intent: "resume", taskId: first.taskId }, store), changed);
});

test("修改返回副本与额外输入无法篡改金额，退款使用服务器订单并保持决定幂等", async () => {
  const store = createWorkbenchStore();
  const task = store.prepare();
  task.order.paidAmountCents = 1;
  const saved = store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 });
  saved.order.paidAmountCents = 2;
  saved.pickup!.label = "伪造显示值";
  const input = { intent: "decide" as const, taskId: task.taskId, decision: "confirm" as const, version: 2 };
  assert.throws(() => WorkbenchInputSchema.parse({ ...input, amountCents: 1 }));
  const result = await runWorkbench(input, store);
  assert.equal(result.version, 3);
  assert.equal(result.status, "refund_submitted");
  assert.equal(result.order.paidAmountCents, 449900);
  assert.equal(result.refund?.amountCents, 449900);
  assert.equal(result.pickup?.label, WORKBENCH_SLOTS[0].label);
  assert.match(result.message, /尚未到账/);
  assert.deepEqual(await runWorkbench(input, store), result);
  assert.deepEqual(await runWorkbench({ ...input, version: 3 }, store), result);
  await assert.rejects(runWorkbench({ ...input, version: 1 }, store), { statusCode: 409 });
  await assert.rejects(runWorkbench({ ...input, decision: "cancel" }, store), { statusCode: 409 });
  assert.throws(() => store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[1].id, version: 3 }), { statusCode: 409 });
});

test("取消的重复决定幂等，旧快照不能覆盖后来保存的取件", () => {
  const store = createWorkbenchStore();
  const task = store.prepare();
  const saved = store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 });
  assert.throws(() => store.decide({ taskId: task.taskId, decision: "cancel", version: 1 }), { statusCode: 409 });
  const input = { taskId: task.taskId, decision: "cancel" as const, version: saved.version };
  const cancelled = store.decide(input);
  assert.deepEqual(store.decide(input), cancelled);
  assert.equal(cancelled.refund, undefined);
  assert.throws(() => store.decide({ ...input, decision: "confirm" }), { statusCode: 409 });
  assert.throws(() => store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 }), { statusCode: 409 });
});

test("A2UI 工作台保留订单信息、数据绑定、版本化动作和受控 MCPApp 组件", () => {
  const task = createWorkbenchStore().prepare();
  const messages = workbenchMessages(task);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0].createSurface, { surfaceId: WORKBENCH_SURFACE_ID, catalogId: WORKBENCH_CATALOG_ID });
  const components = messages[1].updateComponents!.components;
  const get = (id: string) => { const component = components.find(item => item.id === id); assert.ok(component); return component; };
  assert.deepEqual(get("pickup-summary").text, { path: "/pickupSummary" });
  assert.equal(get("amount-value").text, "¥4,499.00");
  assert.equal(get("image").url, "/assets/mac-mini.png");
  assert.deepEqual(get("pickup-app"), { id: "pickup-app", component: "MCPApp", taskId: task.taskId, resourceUri: PICKUP_UI_URI });
  assert.equal(get("confirm").disabled, true);
  assert.deepEqual(get("confirm").action?.event.context, { taskId: task.taskId, version: 1 });
  assert.equal(get("cancel").disabled, false);
  assert.equal(messages[2].updateDataModel?.value.pickupSummary, "尚未保存取件安排");
  const ids = new Set(components.map(item => item.id));
  assert.equal(ids.size, components.length);
  for (const component of components) {
    for (const child of component.children ?? []) assert.ok(ids.has(child));
    if (component.child) assert.ok(ids.has(component.child));
  }
});

test("保存后的 A2UI 更新无重复 create，绑定摘要更新且确认动作携带新版本", () => {
  const store = createWorkbenchStore();
  const task = store.prepare();
  const saved = store.savePickup({ taskId: task.taskId, slotId: WORKBENCH_SLOTS[2].id, version: task.version });
  const messages = workbenchMessages(saved, false);
  assert.equal(messages.length, 2);
  assert.equal(messages.some(item => item.createSurface), false);
  const confirm = messages[0].updateComponents!.components.find(item => item.id === "confirm")!;
  assert.equal(confirm.disabled, false);
  assert.equal(confirm.action?.event.context.version, saved.version);
  assert.equal(messages[1].updateDataModel?.value.pickupSummary, WORKBENCH_SLOTS[2].label);
  const pure = workbenchMessages(saved, true, false);
  assert.equal(pure[1].updateComponents!.components.some(item => item.component === "MCPApp"), false);
  const decided = store.decide({ taskId: task.taskId, decision: "confirm", version: saved.version });
  const terminal = workbenchMessages(decided, false)[0].updateComponents!.components;
  assert.equal(terminal.some(item => item.component === "Button" || item.component === "MCPApp"), false);
  assert.ok(terminal.some(item => item.id === "request-id"));
});

test("AG-UI 事件通过官方 schema，流包含状态、文字分片与 A2UI Activity Snapshot", () => {
  const task = createWorkbenchStore().prepare();
  const events = workbenchEvents(task, "workbench-test", "workbench-run", true, "prepare");
  for (const event of events) EventSchema.parse(event);
  assert.equal(events[0].type, "RUN_STARTED");
  assert.equal(events.at(-1)?.type, "RUN_FINISHED");
  const state = events.find(event => event.type === "STATE_SNAPSHOT")!;
  assert.deepEqual(state.snapshot, task);
  const text = events.filter(event => event.type === "TEXT_MESSAGE_CONTENT");
  assert.ok(text.length > 1);
  assert.equal(text.map(event => event.delta).join(""), task.message);
  const activity = events.find(event => event.type === "ACTIVITY_SNAPSHOT")!;
  assert.equal(activity.activityType, "a2ui-surface");
  assert.equal(activity.replace, true);
  assert.deepEqual(activity.content, { a2ui_operations: workbenchMessages(task, true) });
  const resumed = workbenchEvents(task, "workbench-test", "run-resume", false, "resume");
  const resumedActivity = resumed.find(event => event.type === "ACTIVITY_SNAPSHOT")!;
  assert.deepEqual(resumedActivity.content, { a2ui_operations: workbenchMessages(task, false) });
});

test("官方 A2UI 外层 schema + 自定义目录拒绝任意组件、样式、路径和不可信 App 资源", () => {
  const task = createWorkbenchStore().prepare();
  const messages = workbenchMessages(task);
  assertWorkbenchMessages(messages);
  assertWorkbenchMessages(workbenchMessages(task, true, false));
  for (const mutate of [
    (list: any[]) => { list[0].style = "position:fixed"; },
    (list: any[]) => { list[0].appearance = "arbitrary-css"; },
    (list: any[]) => { list.find(item => item.id === "pickup-app").resourceUri = "https://evil.invalid/app.html"; },
    (list: any[]) => { list.find(item => item.id === "pickup-summary").text.path = "/__proto__/x"; },
    (list: any[]) => { list.find(item => item.id === "confirm").action.event.context.amountCents = 1; },
    (list: any[]) => { list.find(item => item.id === "image").url = "javascript:alert(1)"; },
    (list: any[]) => { list[0].component = "RawHTML"; },
  ]) {
    const invalid = structuredClone(messages[1]);
    mutate(invalid.updateComponents!.components);
    assert.equal(validateWorkbenchServerMessage(invalid), false);
  }
  const cycle = structuredClone(messages);
  cycle[1].updateComponents!.components[0].children!.push("root");
  assert.throws(() => assertWorkbenchMessages(cycle), /循环/);
  const missing = structuredClone(messages);
  missing[1].updateComponents!.components[0].children!.push("missing-child");
  assert.throws(() => assertWorkbenchMessages(missing), /未知子组件/);
});

test("真实 MCP HTTP 验证三种承载：普通 A2UI、取件 App、内置 A2UI renderer 的 App", async () => {
  const server = await startDemoServer(0, 0);
  const client = new Client({ name: "workbench-integration", version: "1.0.0" });
  const data = (result: unknown) => (result as { structuredContent: { task: WorkbenchTask; messages?: WorkbenchUiMessage[]; slots?: { id: string; label: string }[] } }).structuredContent;
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp-workbench`)));
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), ["decide_workbench", "review_pickup", "review_workbench_a2ui", "save_pickup", "view_workbench_app"]);
    const uiMeta = (name: string) => tools.find(tool => tool.name === name)!._meta?.ui as { resourceUri?: string; visibility?: string[] } | undefined;
    assert.equal(uiMeta("review_workbench_a2ui"), undefined, "普通 A2UI over MCP 不应关联 MCP App HTML");
    assert.equal(uiMeta("review_pickup")?.resourceUri, PICKUP_UI_URI);
    assert.equal(uiMeta("view_workbench_app")?.resourceUri, WORKBENCH_UI_URI);
    assert.deepEqual(uiMeta("save_pickup")?.visibility, ["app"]);
    for (const uri of [PICKUP_UI_URI, WORKBENCH_UI_URI]) {
      const resource = await client.readResource({ uri });
      const content = resource.contents[0];
      assert.equal(content.mimeType, "text/html;profile=mcp-app");
      assert.ok("text" in content);
      const html = content.text as string;
      assert.match(html, /<script/);
      assert.equal(/<script[^>]+src=/.test(html), false, "MCP App必须单文件，无外部脚本");
    }
    const review = await client.callTool({ name: "review_workbench_a2ui", arguments: {} });
    const first = data(review).task;
    assert.equal(first.version, 1);
    assert.equal(first.pickup, undefined);
    const embedded = review.content!.find(item => item.type === "resource");
    assert.ok(embedded?.type === "resource");
    assert.equal(embedded.resource.mimeType, "application/a2ui+json");
    assert.ok("text" in embedded.resource);
    const messages = JSON.parse(embedded.resource.text as string) as WorkbenchUiMessage[];
    assert.deepEqual(messages, data(review).messages!);
    assertWorkbenchMessages(messages);
    assert.equal(messages[1].updateComponents!.components.some(component => component.component === "MCPApp"), false);
    const pickupReview = await client.callTool({ name: "review_pickup", arguments: { taskId: first.taskId } });
    assert.equal(data(pickupReview).task.taskId, first.taskId);
    assert.deepEqual(data(pickupReview).slots, WORKBENCH_SLOTS);
    const missingPickup = await client.callTool({ name: "decide_workbench", arguments: { taskId: first.taskId, decision: "confirm", version: 1 } });
    assert.equal(missingPickup.isError, true);
    assert.equal((missingPickup.structuredContent as any).error.code, 409);
    const saveInput = { taskId: first.taskId, slotId: WORKBENCH_SLOTS[0].id, version: 1 };
    const save = await client.callTool({ name: "save_pickup", arguments: saveInput });
    const saved = data(save).task;
    assert.equal(saved.version, 2);
    assert.equal(saved.status, "awaiting_confirmation");
    assert.equal(saved.refund, undefined);
    assert.deepEqual(await client.callTool({ name: "save_pickup", arguments: saveInput }), save);
    const conflict = await client.callTool({ name: "save_pickup", arguments: { ...saveInput, slotId: WORKBENCH_SLOTS[1].id } });
    assert.equal(conflict.isError, true);
    assert.equal((conflict.structuredContent as any).error.code, 409);
    const app = await client.callTool({ name: "view_workbench_app", arguments: { taskId: first.taskId } });
    assert.deepEqual(data(app).task, saved);
    assertWorkbenchMessages(data(app).messages!);
    const decideInput = { taskId: first.taskId, decision: "confirm", version: saved.version };
    const submitted = await client.callTool({ name: "decide_workbench", arguments: decideInput });
    assert.equal(data(submitted).task.status, "refund_submitted");
    assert.equal(data(submitted).task.refund?.amountCents, 449900);
    assert.deepEqual(await client.callTool({ name: "decide_workbench", arguments: decideInput }), submitted);
    assert.equal((await client.callTool({ name: "decide_workbench", arguments: { ...decideInput, decision: "cancel" } })).isError, true);
    const another = await client.callTool({ name: "review_workbench_a2ui", arguments: {} });
    assert.notEqual(data(another).task.taskId, first.taskId);
  } finally { await client.close(); await server.close(); }
});

test("真实 AG-UI SSE 与 MCP 工具协作：回执触发新运行、绑定摘要更新、正式 Action 确认", async () => {
  const server = await startDemoServer(0, 0);
  const client = new Client({ name: "workbench-cross-protocol", version: "1.0.0" });
  const rawInput = { threadId: "workbench-raw", runId: "raw-run", state: {}, messages: [], tools: [], context: [] };
  const postRun = (forwardedProps: unknown) => fetch(`${server.origin}/api/workbench/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rawInput, forwardedProps }),
  });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/mcp-workbench`)));
    const agent = new HttpAgent({ url: `${server.origin}/api/workbench/run`, threadId: "workbench-cross-test" });
    let initialMessages: WorkbenchUiMessage[] = [];
    await agent.runAgent({ forwardedProps: { intent: "prepare" } }, {
      onEvent({ event }) { EventSchema.parse(event); },
      onActivitySnapshotEvent({ event }) { initialMessages = event.content.a2ui_operations as WorkbenchUiMessage[]; },
    });
    const prepared = structuredClone(agent.state) as WorkbenchTask;
    assert.equal(prepared.version, 1);
    assert.ok(initialMessages[0].createSurface);
    assertWorkbenchMessages(initialMessages);
    const result = await client.callTool({ name: "save_pickup", arguments: { taskId: prepared.taskId, slotId: WORKBENCH_SLOTS[1].id, version: 1 } });
    const saved = (result.structuredContent as { task: WorkbenchTask }).task;
    assert.equal(saved.version, 2);
    assert.equal((agent.state as WorkbenchTask).version, 1, "MCP保存不能神奇地自动修改Agent客户端状态");
    assert.equal((await postRun({ intent: "pickup_saved", taskId: prepared.taskId, arrangementId: "PK-fake", version: 2 })).status, 409);
    let updatedMessages: WorkbenchUiMessage[] = [];
    await agent.runAgent({ forwardedProps: { intent: "pickup_saved", taskId: prepared.taskId, arrangementId: saved.pickup!.arrangementId, version: saved.version } }, {
      onEvent({ event }) { EventSchema.parse(event); },
      onActivitySnapshotEvent({ event }) { updatedMessages = event.content.a2ui_operations as WorkbenchUiMessage[]; },
    });
    assert.deepEqual(agent.state, saved);
    assertWorkbenchMessages(updatedMessages);
    assert.equal(updatedMessages.some(message => message.createSurface), false);
    assert.equal(updatedMessages.find(message => message.updateDataModel)?.updateDataModel?.value.pickupSummary, WORKBENCH_SLOTS[1].label);
    const action = {
      version: "v0.9", action: {
        name: "confirm_refund", surfaceId: WORKBENCH_SURFACE_ID, sourceComponentId: "confirm",
        timestamp: new Date().toISOString(), context: { taskId: prepared.taskId, version: saved.version },
      },
    };
    assert.equal((await postRun({ intent: "action", message: { ...action, action: { ...action.action, sourceComponentId: "cancel" } } })).status, 400);
    assert.equal((await postRun({ intent: "action", message: { ...action, action: { ...action.action, context: { ...action.action.context, amountCents: 1 } } } })).status, 400);
    await agent.runAgent({ forwardedProps: { intent: "action", message: action } });
    const submitted = structuredClone(agent.state) as WorkbenchTask;
    assert.equal(submitted.status, "refund_submitted");
    assert.equal(submitted.refund?.amountCents, 449900);
    await agent.runAgent({ forwardedProps: { intent: "action", message: action } });
    assert.deepEqual(agent.state, submitted);
    assert.equal((await postRun({ intent: "pickup_saved", taskId: prepared.taskId, arrangementId: saved.pickup!.arrangementId, version: saved.version })).status, 409);
    let restoredMessages: WorkbenchUiMessage[] = [];
    await agent.runAgent({ forwardedProps: { intent: "resume", taskId: prepared.taskId } }, {
      onActivitySnapshotEvent({ event }) { restoredMessages = event.content.a2ui_operations as WorkbenchUiMessage[]; },
    });
    assert.deepEqual(agent.state, submitted);
    assert.ok(restoredMessages[0].createSurface, "重新加载页面恢复时需重新创建Surface");
  } finally { await client.close(); await server.close(); }
});
