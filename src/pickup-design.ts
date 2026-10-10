export const pickupStyle = `
:root{--pickup-ink:var(--color-text-primary,#263343);--pickup-muted:var(--color-text-secondary,#788392);--pickup-surface:var(--color-background-primary,#fff);--pickup-soft:var(--color-background-secondary,#f7f8fb);--pickup-line:var(--color-border-primary,#e5e8f0);--pickup-accent:#7352b5;--pickup-tint:#f5f0ff}
[data-theme="dark"]{--pickup-ink:var(--color-text-primary,#e9e8f2);--pickup-muted:var(--color-text-secondary,#abb0c5);--pickup-surface:var(--color-background-primary,#202331);--pickup-soft:var(--color-background-secondary,#292d40);--pickup-line:var(--color-border-primary,#41445e);--pickup-accent:#b49ae9;--pickup-tint:#312941}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--pickup-ink);font:14px/1.65 var(--font-sans,system-ui,-apple-system,"PingFang SC",sans-serif)}
.pickup-card{position:relative;width:100%;min-width:0;padding:25px;background:var(--pickup-surface);border:1px solid var(--pickup-line);border-radius:17px;overflow:hidden;box-shadow:0 8px 26px #20284108}
.pickup-card:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--pickup-accent)}
.pickup-card p,.pickup-card h2{margin:0}.pickup-eyebrow{display:flex;align-items:center;gap:7px;font-size:10px;letter-spacing:1.25px;font-weight:600;color:var(--pickup-accent)}
.pickup-dot{width:6px;height:6px;border-radius:50%;background:var(--pickup-accent)}
.pickup-header{display:flex;align-items:center;gap:13px;margin-top:16px}.pickup-symbol{display:grid;place-items:center;flex:none;width:43px;height:43px;border:1px solid var(--pickup-line);border-radius:12px;background:var(--pickup-tint);color:var(--pickup-accent)}.pickup-symbol svg{width:25px;height:25px}
.pickup-title{font-size:21px;font-weight:600;line-height:1.4;letter-spacing:-.3px}.pickup-subtitle{font-size:12px;color:var(--pickup-muted);margin-top:3px!important}
.pickup-context{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 0 17px;margin-top:7px;font-size:11px;color:var(--pickup-muted);border-bottom:1px solid var(--pickup-line)}.pickup-context span:first-child{overflow-wrap:anywhere}.pickup-badge{flex:none;background:var(--pickup-tint);color:var(--pickup-accent);padding:3px 9px;border-radius:20px;font-size:10px;white-space:nowrap}
.pickup-fieldset{border:0;padding:0;margin:18px 0 0;min-width:0}.pickup-legend{padding:0;margin-bottom:10px;font-size:12px;font-weight:500}.pickup-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pickup-slot{display:flex;align-items:flex-start;gap:9px;min-height:72px;padding:11px 10px;border:1px solid var(--pickup-line);border-radius:10px;background:var(--pickup-surface);cursor:pointer;transition:border-color .15s,background .15s}.pickup-slot:has(input:checked){border-color:var(--pickup-accent);background:var(--pickup-tint)}.pickup-slot:has(input:disabled){cursor:default;opacity:.65}.pickup-slot:has(input:focus-visible){outline:3px solid #c9b8ed;outline-offset:2px}.pickup-slot input{margin:3px 0 0;accent-color:var(--pickup-accent);width:14px;height:14px;flex:none}.pickup-slot-label{font-size:12px;line-height:1.85;overflow-wrap:anywhere}
.pickup-placeholder{grid-column:1/-1;border:1px dashed var(--pickup-line);border-radius:10px;padding:14px;font-size:12px;color:var(--pickup-muted)}
.pickup-summary{display:flex;gap:10px;align-items:flex-start;margin-top:16px;padding:12px 14px;border:1px solid var(--pickup-line);border-radius:10px;background:var(--pickup-soft)}.pickup-summary-mark{flex:none;font-size:14px;color:var(--pickup-accent);line-height:1.75}.pickup-summary-label{font-size:10px;color:var(--pickup-muted);margin-bottom:3px!important}.pickup-summary-text{font-size:12px;line-height:1.8;overflow-wrap:anywhere}.pickup-summary-id{font:10px/1.8 var(--font-mono,ui-monospace,SFMono-Regular,monospace);color:var(--pickup-muted);overflow-wrap:anywhere;margin-top:4px!important}
.pickup-save{width:100%;min-height:43px;margin-top:18px;border:1px solid #7352b5;border-radius:10px;background:#7352b5;color:#fff;font-size:13px;font-weight:500;line-height:1.6;font-family:inherit;cursor:pointer;transition:background .15s,opacity .15s}.pickup-save:hover:not(:disabled){background:#604298}.pickup-save:focus-visible{outline:3px solid #c9b8ed;outline-offset:3px}.pickup-save:disabled{opacity:.5;cursor:default}
.pickup-note{margin-top:9px!important;font-size:10px;line-height:1.8;text-align:center;color:var(--pickup-muted)}
.pickup-footer{display:flex;align-items:flex-start;justify-content:space-between;gap:13px;border-top:1px solid var(--pickup-line);padding-top:12px;margin-top:17px;font-size:10px;color:var(--pickup-muted)}.pickup-status{min-width:0;overflow-wrap:anywhere}.pickup-status[data-state="error"]{color:#b4493b}.pickup-status[data-state="success"]{color:var(--pickup-accent)}.pickup-version{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
[hidden]{display:none!important}
@media(max-width:480px){.pickup-card{padding:21px 18px}.pickup-title{font-size:20px}.pickup-slots{grid-template-columns:1fr}.pickup-slot{min-height:47px;align-items:center;padding:9px 12px}.pickup-slot input{margin:0}.pickup-context{flex-wrap:wrap}.pickup-footer{gap:8px}.pickup-note{font-size:10px}}
@media(prefers-reduced-motion:reduce){.pickup-slot,.pickup-save{transition:none}}
`;

export function pickupMarkup(): string {
  return `<section class="pickup-card" aria-label="MCP App 取件安排" aria-busy="false">
  <p class="pickup-eyebrow"><span class="pickup-dot" aria-hidden="true"></span>MCP APPS / 退货物流工具</p>
  <div class="pickup-header"><div class="pickup-symbol" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l10-5 10 5v12l-10 5-10-5V8Z"/><path d="M4 8l10 5 10-5M14 13v12M9 5.5l10 5v5"/></svg></div><div><h2 class="pickup-title">安排上门取件</h2><p class="pickup-subtitle">选择方便的时间，准备寄回退货商品。</p></div></div>
  <div class="pickup-context"><span id="pickup-task">等待宿主载入退款任务</span><span class="pickup-badge" id="pickup-badge">待连接</span></div>
  <fieldset class="pickup-fieldset" id="pickup-fieldset" disabled><legend class="pickup-legend">可预约时段</legend><div class="pickup-slots" id="pickup-slots"><p class="pickup-placeholder">正在读取可预约时间…</p></div></fieldset>
  <div class="pickup-summary"><span class="pickup-summary-mark" aria-hidden="true">↳</span><div><p class="pickup-summary-label">已保存的取件安排</p><p class="pickup-summary-text" id="pickup-summary">尚未保存，请选择一个时段。</p><p class="pickup-summary-id" id="pickup-arrangement" hidden></p></div></div>
  <button class="pickup-save" id="save-pickup" type="button" disabled>保存取件安排</button>
  <p class="pickup-note">仅保存取件安排，不会提交退款。退款需在外层订单卡片再次确认。</p>
  <div class="pickup-footer"><p class="pickup-status" id="pickup-status" role="status" aria-live="polite">正在连接宿主…</p><span class="pickup-version" id="pickup-version">任务版本 —</span></div>
  </section>`;
}
