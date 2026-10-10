// 本例组件目录的最小渲染器。不是全量 A2UI renderer，不接受任意 HTML/CSS/脚本。
import type { WorkbenchUiMessage, WorkbenchComponent } from "../workbench.js";

export type UiAction = {
  version: "v0.9";
  action: { name: string; surfaceId: string; sourceComponentId: string; timestamp: string; context: Record<string, unknown> };
};
type Mount = { element: HTMLElement; dispose(): void };
const columns: Record<string, string> = {
  "refund-card": "refund-card", "card-heading": "refund-heading", "product-row": "refund-product",
  "product-info": "refund-product-info", "order-details": "refund-details", "detail-item": "refund-detail",
  "refund-amount": "refund-amount", "card-actions": "refund-actions", "result-panel": "refund-result",
  "pickup-section": "wb-pickup-section", "workbench": "wb-surface", "summary": "wb-summary",
};
const texts: Record<string, string> = {
  eyebrow: "refund-eyebrow", "card-title": "refund-title", subtitle: "refund-subtitle",
  "status-badge": "refund-badge", "product-title": "refund-product-title", "product-spec": "refund-spec",
  "product-quantity": "refund-quantity", "detail-label": "refund-label", "detail-value": "refund-detail-value",
  "amount-label": "refund-amount-label", "amount-value": "refund-amount-value", caption: "refund-caption",
  "result-title": "refund-result-title", "result-message": "refund-result-message",
  "pickup-summary": "wb-pickup-summary", "section-title": "wb-section-title",
};
function appearance(name: string | undefined, choices: Record<string, string>) {
  if (!name) return "";
  if (!Object.hasOwn(choices, name)) throw new Error(`组件目录不支持外观：${name}`);
  return choices[name];
}

export function createWorkbenchRenderer(root: HTMLElement, options: {
  onAction(action: UiAction): void;
  imageUrl?: string;
  mountApp?(component: WorkbenchComponent): Mount;
}) {
  let created = false;
  let model: Record<string, unknown> = {};
  let busy = false;
  const components = new Map<string, WorkbenchComponent>();
  const nodes = new Map<string, HTMLElement>();
  const mounts = new Map<string, Mount>();
  const atPath = (path: string) => {
    if (!/^\/[A-Za-z0-9_/-]+$/.test(path)) throw new Error("不支持的数据绑定路径");
    return path.slice(1).split("/").reduce<unknown>((value, key) => value && typeof value === "object" && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, model);
  };
  const label = (c: WorkbenchComponent) => {
    const value = typeof c.text === "string" ? c.text : c.text ? atPath(c.text.path) : "";
    return value == null ? "" : String(value);
  };
  function render() {
    const active = new Set<string>();
    const visiting = new Set<string>();
    function draw(id: string): HTMLElement {
      const c = components.get(id);
      if (!c || visiting.has(id) || active.has(id)) throw new Error(`组件缺失、重复或循环引用：${id}`);
      visiting.add(id); active.add(id);
      let node = nodes.get(id);
      if (node && node.dataset.componentType !== c.component) {
        mounts.get(id)?.dispose(); mounts.delete(id); node.remove(); nodes.delete(id); node = undefined;
      }
      if (!node) {
        if (c.component === "MCPApp") {
          if (!options.mountApp) throw new Error("此渲染器没有注册 MCPApp 包装组件");
          const mount = options.mountApp(c); mounts.set(id, mount); node = mount.element;
        } else node = document.createElement(c.component === "Button" ? "button" : c.component === "Image" ? "img" : c.component === "Text" ? "p" : "section");
        nodes.set(id, node); node.dataset.componentType = c.component; node.dataset.componentId = id;
      }
      if (c.component === "Column") {
        node.className = appearance(c.appearance, columns);
        const children = (c.children ?? []).map(draw);
        // 按 keyed 节点原位更新，数据更新不能移走 iframe，否则浏览器会重启 App。
        for (let i = 0; i < children.length; i++) if (node.children[i] !== children[i]) node.insertBefore(children[i], node.children[i] ?? null);
        for (const child of Array.from(node.children)) if (!children.includes(child as HTMLElement)) child.remove();
      } else if (c.component === "Text") {
        node.className = appearance(c.appearance, texts); node.textContent = label(c);
      } else if (c.component === "Image") {
        if (c.url !== "/assets/mac-mini.png") throw new Error("图片不在允许目录中");
        const img = node as HTMLImageElement;
        img.src = options.imageUrl ?? c.url; img.alt = c.alt ?? "Mac mini 示意图"; img.className = "refund-image";
        img.width = 130; img.height = 104;
      } else if (c.component === "Button") {
        const button = node as HTMLButtonElement;
        if (!["primary", "secondary"].includes(c.variant ?? "")) throw new Error("按钮样式不在目录中");
        const child = components.get(c.child ?? "");
        if (child?.component !== "Text" || !c.action?.event) throw new Error("按钮缺少 Text 或 Action");
        button.textContent = label(child); button.className = `refund-button ${c.variant}`;
        button.disabled = busy || c.disabled === true;
        button.onclick = () => {
          if (busy || button.disabled) return;
          const event = c.action!.event;
          options.onAction({ version: "v0.9", action: { ...event, context: { ...event.context }, surfaceId: "workbench", sourceComponentId: id, timestamp: new Date().toISOString() } });
        };
      } else if (c.component !== "MCPApp") throw new Error("组件不在本地目录");
      visiting.delete(id); return node;
    }
    const top = draw("root");
    if (root.firstElementChild !== top) root.replaceChildren(top);
    for (const [id, node] of nodes) if (!active.has(id)) { mounts.get(id)?.dispose(); mounts.delete(id); node.remove(); nodes.delete(id); }
  }
  return {
    apply(messages: WorkbenchUiMessage[]) {
      for (const message of messages) {
        if (message.version !== "v0.9") throw new Error("不匹配的 A2UI 版本");
        if (message.createSurface) {
          if (created || message.createSurface.surfaceId !== "workbench" || message.createSurface.catalogId !== "https://refund-demo.local/catalog/workbench-v1") throw new Error("Surface / Catalog 不匹配或重复创建");
          created = true;
        }
        if (message.updateComponents) {
          if (!created || message.updateComponents.surfaceId !== "workbench") throw new Error("先创建 Surface 再更新");
          for (const c of message.updateComponents.components) components.set(c.id, c);
        }
        if (message.updateDataModel) {
          if (!created || message.updateDataModel.surfaceId !== "workbench" || ![undefined, "/"].includes(message.updateDataModel.path)) throw new Error("本例只实现根数据更新");
          model = message.updateDataModel.value as Record<string, unknown>;
        }
      }
      if (components.has("root")) render();
    },
    setBusy(value: boolean) { busy = value; if (components.has("root")) render(); },
    reset() { for (const m of mounts.values()) m.dispose(); mounts.clear(); nodes.clear(); components.clear(); root.replaceChildren(); model = {}; created = false; },
  };
}
