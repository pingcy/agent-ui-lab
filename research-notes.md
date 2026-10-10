# 退款演示的一手资料核对

核对日期：2026-10-05。依据本目录安装包、锁文件、官方协议 Schema 与实现源码；以下是教学实现的核验记录，不代表跨宿主兼容认证，也不代替浏览器测试。

实际依赖为 AG-UI core / client 1.0.1、MCP Apps SDK 2.0.3。事件与输入字段核对安装包声明，文字追加顺序核对客户端编译源码；组件字段核对保存在本地的官方 Schema 及退款目录。三条展示路径复用同一业务准备与决定逻辑，但各次准备独立生成任务，不共享浏览器里的某个固定编号。订单时间及商品金额都是演示数据，图片只是帮助辨认商品，不构成真实订单凭证。

- AG-UI 安装包支持 `forwardedProps`、`STATE_SNAPSHOT`、`STEP_STARTED` / `STEP_FINISHED` 与文字分片事件。状态快照整体替换当前状态；步骤以 `stepName` 对应。客户端内容回调发生在追加本次 `delta` 之前，累计文本可写成 `textMessageBuffer + event.delta`。`taskId`、`decision` 是本业务约定，不是协议内置退款字段。一次 Run 结束不等于业务任务结束；当前 SDK 另有 interrupt / resume 能力。[事件说明](https://docs.ag-ui.com/concepts/events) · [客户端源码](https://github.com/ag-ui-protocol/ag-ui/tree/main/sdks/typescript/packages/client) · [中断与恢复](https://docs.ag-ui.com/concepts/interrupts)
- A2UI v0.9 先发送 `createSurface`，再发送 `updateComponents`。按钮定义与点击回传是两种消息；正式客户端 `action` 包含名称、Surface、源组件、时间戳及 `context`。这里将业务 `taskId` 放在 `context`，由服务端校验并办理确认或取消。[服务 Schema](https://a2ui.org/specification/v0_9/server_to_client.json) · [客户端 Schema](https://a2ui.org/specification/v0_9/client_to_server.json)
- 本例仅实现 Column、Text、Image、Button 四组件教学 Catalog。`appearance`、按钮 `secondary`、图片 `alt` 是该目录的受控扩展，不是基础 Catalog 原生字段；官方 Image 使用 `description`。消息合法性须同时按协议与本地目录验证，不能用“通过基础目录验证”概括。[官方基础目录](https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json)
- MCP 工具 `review_refund` 关联 `ui://refund/view.html`，资源 MIME 为 `text/html;profile=mcp-app`；`App.callServerTool()` 调用 `decide_refund`。保留文本结果供无 UI 能力的客户端读取。`visibility: ["app"]` 是宿主侧工具可见性约定，不是服务器鉴权。[MCP Apps 概览](https://modelcontextprotocol.io/extensions/apps/overview) · [App API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html)
- Web Host 采用不同 origin 的 Sandbox 代理及内层 App iframe；`AppBridge` 与 `App` 初始化后传递输入和结果。隔离限制界面能力，不能替代退款授权、任务归属校验或业务幂等。[AppBridge API](https://apps.extensions.modelcontextprotocol.io/api/classes/app-bridge.AppBridge.html) · [Sandbox 规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#sandbox-proxy)

演示金额为 449900 分，全额退款。`refund_submitted` 仅表示模拟申请已提交，未到账、未调用支付接口。任务只保存在进程内 Map；重复同一决定返回已有结果，相反决定报错。这不等于生产级持久化、身份认证或支付幂等，页面和文章均应保留模拟说明。
