export const refundStyle = `
:root{--ink:var(--color-text-primary,#173744);--muted:var(--color-text-secondary,#6b8087);--surface:var(--color-background-primary,#fff);--soft:var(--color-background-secondary,#f5f8f7);--line:var(--color-border-primary,#e2e9e7);--accent:#087e70}
[data-theme="dark"]{--ink:var(--color-text-primary,#e8f3f2);--muted:var(--color-text-secondary,#a0b5bb);--surface:var(--color-background-primary,#162830);--soft:var(--color-background-secondary,#20363c);--line:var(--color-border-primary,#38515a);--accent:#64d7bd}
.refund-card{position:relative;width:100%;min-width:0;padding:32px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:22px;box-shadow:0 12px 40px #163d4210;overflow:hidden}
.refund-card::before{content:"";position:absolute;left:32px;top:0;width:40px;height:3px;background:var(--accent);border-radius:0 0 4px 4px}
.refund-card p,.refund-card h2,.refund-card h3{margin:0}
.refund-eyebrow{font:500 10px/1.8 system-ui,sans-serif;letter-spacing:2px;color:var(--accent);margin-bottom:17px!important}
.refund-heading{display:flex;flex-direction:column;gap:7px;padding-right:85px}
.refund-title{font-size:25px;line-height:1.4;font-weight:600;letter-spacing:-.3px}
.refund-subtitle{font-size:13px;line-height:1.8;color:var(--muted)}
.refund-badge{position:absolute;top:71px;right:32px;font-size:11px;line-height:1.8;color:var(--accent);border:1px solid #cce4db;background:var(--soft);border-radius:30px;padding:3px 9px;white-space:nowrap}
.refund-product{display:flex;align-items:center;gap:24px;margin:25px 0;padding:20px;background:var(--soft);border:1px solid var(--line);border-radius:15px}
.refund-image{display:block;flex:none;width:130px;height:104px;object-fit:contain;border-radius:10px;background:#f2f5f4}
.refund-product-info{display:flex;flex-direction:column;gap:5px;min-width:0}
.refund-product-title{font-size:21px;line-height:1.5;font-weight:600}
.refund-spec{font-size:12px;line-height:1.9;color:var(--muted);overflow-wrap:anywhere}
.refund-quantity{font-size:11px;line-height:1.8;color:var(--muted);margin-top:6px!important}
.refund-details{display:grid;grid-template-columns:1.15fr 1fr;gap:20px;padding:0 1px 23px}
.refund-detail{display:flex;flex-direction:column;gap:6px;min-width:0}
.refund-label{color:var(--muted);font-size:11px;line-height:1.8}
.refund-detail-value{font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.refund-amount{display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--line);padding-top:21px}
.refund-amount-label{font-size:12px;color:var(--muted);line-height:1.8}
.refund-amount-value{font:500 36px/1.3 system-ui,sans-serif;letter-spacing:-1.3px;color:var(--ink);font-variant-numeric:tabular-nums}
.refund-caption{font-size:11px;line-height:1.8;color:var(--muted);margin-top:8px!important}
.refund-actions{display:flex;gap:10px;margin-top:24px}
.refund-button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:12px 22px;background:#087e70;color:#fff;border:1px solid #087e70;border-radius:10px;font:500 13px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;cursor:pointer;transition:background .16s,box-shadow .16s}
.refund-button.primary{flex:1}
.refund-button.secondary{background:transparent;color:var(--muted);border-color:var(--line);min-width:105px}
.refund-button:hover:not(:disabled){box-shadow:0 3px 10px #087e7022;background:#08695e}
.refund-button.secondary:hover:not(:disabled){background:var(--soft);box-shadow:none}
.refund-button:focus-visible{outline:3px solid #8bcebb;outline-offset:3px}
.refund-button:disabled{opacity:.5;cursor:wait}
.refund-result{border:1px solid #cde5db;border-left:3px solid var(--accent);border-radius:10px;background:var(--soft);padding:16px 18px;margin-top:23px}
.refund-result-title{font-size:16px;line-height:1.7;font-weight:600;color:var(--accent)}
.refund-result:focus-visible{outline:2px solid #8bcebb;outline-offset:3px}
.refund-result-message{font-size:12px;line-height:1.9;color:var(--muted);margin-top:4px!important;overflow-wrap:anywhere}
.refund-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:14px;margin-top:22px;font-size:10px;line-height:1.8;color:var(--muted)}
.refund-feedback{min-width:0;overflow-wrap:anywhere}
.refund-feedback[data-state="error"]{color:#b44736}
.refund-received{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums}
[hidden]{display:none!important}
@media(max-width:520px){.refund-card{padding:23px 21px;border-radius:17px}.refund-card::before{left:21px}.refund-heading{padding-right:0}.refund-title{font-size:23px}.refund-badge{position:static;width:fit-content;margin-top:12px!important}.refund-product{gap:14px;padding:13px;margin:20px 0}.refund-image{width:90px;height:90px}.refund-product-title{font-size:19px}.refund-spec{font-size:11px}.refund-details{grid-template-columns:1fr;gap:15px;padding-bottom:20px}.refund-detail{flex-direction:row;align-items:baseline;justify-content:space-between;gap:10px}.refund-label{flex:none}.refund-detail-value{text-align:right;font-size:11px}.refund-amount-value{font-size:33px}.refund-actions{gap:8px;margin-top:21px}.refund-button{padding:12px 15px}.refund-button.secondary{min-width:85px}.refund-meta{align-items:flex-start;flex-direction:column;gap:3px}.refund-eyebrow{font-size:9px}}
@media(prefers-reduced-motion:reduce){.refund-button{transition:none}}
`;
export function refundMarkup(imageUrl: string) {
  return `<section class="refund-card" aria-label="订单退款确认" aria-busy="false">
  <p class="refund-eyebrow">CUSTOMER SERVICE / 订单售后</p>
  <div class="refund-heading"><h2 class="refund-title">确认这笔订单的退款</h2><p class="refund-subtitle">请核对订单信息，再决定是否继续。</p></div>
  <p class="refund-badge" id="task-badge">读取订单中</p>
  <div class="refund-product"><img class="refund-image" src="${imageUrl}" alt="Mac mini 产品示意图" width="130" height="104"><div class="refund-product-info"><h3 class="refund-product-title" id="product-name">—</h3><p class="refund-spec" id="product-spec">—</p><p class="refund-quantity" id="product-quantity">—</p></div></div>
  <div class="refund-details"><div class="refund-detail"><p class="refund-label">订单编号</p><p class="refund-detail-value" id="order-id">—</p></div><div class="refund-detail"><p class="refund-label">下单时间</p><p class="refund-detail-value" id="order-time">—</p></div></div>
  <div class="refund-amount"><p class="refund-amount-label">实付款 / 本次申请退款金额</p><p class="refund-amount-value" id="paid-amount">—</p></div>
  <p class="refund-caption">确认后提交退款申请，处理结果会显示在这里。</p>
  <div class="refund-actions" id="actions"><button class="refund-button primary" id="confirm" disabled>确认退款</button><button class="refund-button secondary" id="cancel" disabled>取消</button></div>
  <div class="refund-result" id="result" role="status" tabindex="-1" hidden><p class="refund-result-title" id="result-title"></p><p class="refund-result-message" id="result-message"></p></div>
  <p class="refund-caption">演示订单 · 产品示意图 · 不会发起真实退款</p>
  <div class="refund-meta"><p class="refund-feedback" id="status" role="status" aria-live="polite">正在核对订单…</p><time class="refund-received" id="received">本次接收 —</time></div>
  </section>`;
}
