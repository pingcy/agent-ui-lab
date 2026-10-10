import type { RefundComponent } from "../a2ui.js";

const surface = document.querySelector<HTMLElement>("#surface")!;
const log = document.querySelector<HTMLElement>("#messages")!;
const status = document.querySelector<HTMLElement>("#status")!;
let surfaceId: string | undefined;
let loading = false;
const catalogId = "https://refund-demo.local/catalog/v1";
const received = document.createElement("time");
received.id = "received";
received.className = "refund-received";
received.textContent = "本次接收 —";
const columnClasses: Record<string, string> = {
  "refund-card": "refund-card", "card-heading": "refund-heading", "product-row": "refund-product",
  "product-info": "refund-product-info", "order-details": "refund-details", "detail-item": "refund-detail",
  "refund-amount": "refund-amount", "card-actions": "refund-actions", "result-panel": "refund-result",
};
const textClasses: Record<string, string> = {
  eyebrow: "refund-eyebrow", "card-title": "refund-title", subtitle: "refund-subtitle",
  "status-badge": "refund-badge", "product-title": "refund-product-title", "product-spec": "refund-spec",
  "product-quantity": "refund-quantity", "detail-label": "refund-label", "detail-value": "refund-detail-value",
  "amount-label": "refund-amount-label", "amount-value": "refund-amount-value", caption: "refund-caption",
  "result-title": "refund-result-title", "result-message": "refund-result-message",
};
function appearanceClass(value: string | undefined, choices: Record<string, string>) {
  if (!value) return "";
  if (!Object.hasOwn(choices, value)) throw new Error(`不支持的外观 ${value}`);
  return choices[value];
}
// 教学渲染器仅实现本地 Catalog 的四个组件，不代表支持完整标准 Catalog。
function render(components: RefundComponent[]) {
  const byId = new Map(components.map(component => [component.id, component]));
  const drawing = new Set<string>();
  const draw = (id: string): HTMLElement => {
    const component = byId.get(id);
    if (!component || drawing.has(id)) throw new Error(`缺失组件或出现循环引用：${id}`);
    drawing.add(id);
    let node: HTMLElement;
    if (component.component === "Column") {
      node = document.createElement("section");
      node.className = appearanceClass(component.appearance, columnClasses);
      for (const child of component.children ?? []) node.append(draw(child));
      if (component.appearance === "refund-card") {
        node.setAttribute("aria-busy", "false");
        const meta = document.createElement("div");
        meta.className = "refund-meta";
        status.className = "refund-feedback";
        meta.append(status, received);
        node.append(meta);
      }
      if (component.appearance === "result-panel") {
        node.setAttribute("role", "status");
        node.tabIndex = -1;
      }
    } else if (component.component === "Text") {
      node = document.createElement(component.appearance === "card-title" ? "h2" : component.appearance === "product-title" ? "h3" : "p");
      node.className = appearanceClass(component.appearance, textClasses);
      node.textContent = component.text ?? "";
    } else if (component.component === "Image") {
      if (component.url !== "/assets/mac-mini.png") throw new Error("图片不在本地教学目录允许范围");
      const image = document.createElement("img");
      image.className = "refund-image";
      image.src = component.url;
      image.alt = component.alt ?? "产品示意图";
      image.width = 130; image.height = 104;
      node = image;
    } else if (component.component === "Button") {
      const button = document.createElement("button");
      if (!["primary", "secondary"].includes(component.variant ?? "")) throw new Error("不支持的按钮样式");
      button.className = `refund-button ${component.variant}`;
      const label = byId.get(component.child ?? "");
      if (label?.component !== "Text") throw new Error("教学按钮需要 Text 标签");
      button.textContent = label.text ?? "";
      button.dataset.label = label.text ?? "";
      const event = component.action?.event;
      if (!event) throw new Error("按钮缺少动作");
      button.onclick = () => load({ ...event, sourceComponentId: component.id });
      node = button;
    } else throw new Error("不支持的组件");
    node.dataset.componentId = id;
    drawing.delete(id);
    return node;
  };
  const restoreFocus = surface.contains(document.activeElement);
  surface.replaceChildren(draw("root"));
  if (restoreFocus) (surface.querySelector<HTMLElement>(".refund-result") ?? surface.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
}
function setBusy(busy: boolean, source?: string) {
  surface.querySelector(".refund-card")?.setAttribute("aria-busy", String(busy));
  for (const button of surface.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = busy;
    button.textContent = busy && button.dataset.componentId === source ? "正在提交…" : button.dataset.label!;
  }
}
type Action = { name: string; sourceComponentId: string; context: { taskId: string } };
async function load(action?: Action) {
  if (loading) return;
  loading = true; setBusy(true, action?.sourceComponentId);
  status.dataset.state = "loading";
  status.textContent = action ? "正在提交你的选择…" : "接收界面描述…";
  try {
    const response = await fetch("/api/a2ui", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action ? { version: "v0.9", action: { ...action, surfaceId, timestamp: new Date().toISOString() } } : {}),
    });
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    const messages = text.trim().split("\n").map(line => JSON.parse(line));
    log.textContent = text;
    for (const message of messages) {
      if (message.version !== "v0.9") throw new Error("不支持的 A2UI 版本");
      if (message.createSurface) {
        if (surfaceId) throw new Error("不能重复创建 Surface");
        if (message.createSurface.catalogId !== catalogId) throw new Error("不匹配的组件目录");
        surfaceId = message.createSurface.surfaceId;
      }
      if (message.updateComponents) {
        if (!surfaceId || message.updateComponents.surfaceId !== surfaceId) throw new Error("Surface 尚未创建或不匹配");
        render(message.updateComponents.components);
      }
    }
    const now = new Date();
    received.dateTime = now.toISOString();
    received.textContent = `本次接收 ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
    status.dataset.state = "success";
    status.textContent = action ? "已收到处理结果" : "订单已核对，等待你的选择";
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = `${action ? "提交失败，可重试" : "加载失败，请刷新页面"}：${String(error)}`;
  } finally { loading = false; setBusy(false); }
}
void load();
