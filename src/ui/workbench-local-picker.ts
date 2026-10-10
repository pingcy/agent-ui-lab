import type { WorkbenchTask } from "../workbench.js";
export function createLocalPicker(root: ParentNode, onSave: (slotId: string) => void) {
  const select = root.querySelector<HTMLSelectElement>("#local-slot")!;
  const button = root.querySelector<HTMLButtonElement>("#save-local-pickup")!;
  let busy = true; let task: WorkbenchTask | undefined;
  const update = () => { select.disabled = busy || task?.status !== "awaiting_confirmation"; button.disabled = select.disabled || !select.value; };
  select.onchange = update;
  button.onclick = () => { if (!button.disabled) onSave(select.value); };
  return {
    setSlots(slots: { id: string; label: string }[]) {
      for (const slot of slots) { const o = document.createElement("option"); o.value = slot.id; o.textContent = slot.label; select.append(o); }
    },
    setTask(next: WorkbenchTask) { const changed = task?.taskId !== next.taskId; task = next; if (next.pickup) select.value = next.pickup.slotId; else if (changed) select.value = ""; update(); },
    setBusy(next: boolean) { busy = next; update(); },
  };
}
