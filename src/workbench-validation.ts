import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { WORKBENCH_CATALOG_ID, WORKBENCH_SURFACE_ID, type WorkbenchUiMessage } from "./workbench.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("uuid", { type: "string", validate: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) });
ajv.addFormat("date-time", { type: "string", validate: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)) });
ajv.addFormat("uri", { type: "string", validate: (value: string) => { try { new URL(value); return true; } catch { return false; } } });
ajv.addSchema(read("common_types.json"));
ajv.addSchema(read("workbench-catalog.json"), "https://a2ui.org/specification/v0_9/catalog.json");
// 外层消息仍使用随上篇保存的官方 v0.9 schema；只替换协商过的本地受控目录。
export const validateWorkbenchServerMessage = ajv.compile(read("server_to_client.json"));
export const validateWorkbenchClientMessage = ajv.compile(read("client_to_server.json"));

export function assertWorkbenchMessages(messages: unknown): asserts messages is WorkbenchUiMessage[] {
  if (!Array.isArray(messages) || !messages.length) throw new Error("工作台 A2UI 操作必须是非空数组。");
  for (const rawMessage of messages) {
    if (!validateWorkbenchServerMessage(rawMessage)) throw new Error(`工作台 A2UI schema 校验失败：${JSON.stringify(validateWorkbenchServerMessage.errors)}`);
    const message = rawMessage as WorkbenchUiMessage;
    const operation = message.createSurface ?? message.updateComponents ?? message.updateDataModel;
    if (operation?.surfaceId !== WORKBENCH_SURFACE_ID) throw new Error("非预期工作台 Surface。");
    if (message.createSurface?.catalogId && message.createSurface.catalogId !== WORKBENCH_CATALOG_ID) throw new Error("非预期工作台目录。");
    if (message.updateComponents) {
      const components = message.updateComponents.components;
      const byId = new Map(components.map(component => [component.id, component]));
      if (byId.size !== components.length || !byId.has("root")) throw new Error("组件 ID 重复或缺少 root。");
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const walk = (id: string) => {
        if (visiting.has(id)) throw new Error("组件树存在循环。");
        if (visited.has(id)) return;
        const component = byId.get(id);
        if (!component) throw new Error(`未知子组件：${id}`);
        visiting.add(id);
        for (const child of component.children ?? []) walk(child);
        if (component.child) walk(component.child);
        visiting.delete(id);
        visited.add(id);
      };
      walk("root");
    }
  }
}
