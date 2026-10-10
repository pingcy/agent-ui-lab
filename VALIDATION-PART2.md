# 下篇文章与可运行 demo 对照

日期：2026-10-10。目标是把下篇的架构片段接成能操作、能查看协议记录的本地应用，不把示意代码说成生产系统。

## 已实现与自动测试

| 文章观点 | 可检查的实现 | 验证方式 |
| --- | --- | --- |
| AG-UI 同时传递文字、状态与 A2UI | `/workbench` 中的状态快照、文字分片、`ACTIVITY_SNAPSHOT` | 官方 HttpAgent 与事件 Schema，真实 SSE |
| A2UI 控件动作返回后端 | 确认/取消生成正式 v0.9 Action，宿主映射到任务输入 | 官方消息外壳 + 自定义目录；来源 Surface/组件、版本和参数约束 |
| A2UI over MCP 不要求 MCP Apps | `/a2ui-over-mcp` 没有 iframe，宿主渲染 embedded resource | 真实 MCP Client；资源 MIME 与界面消息检查 |
| A2UI 可嵌入独立 App | `/workbench` 的自定义 `MCPApp` 组件 | 真实 App/AppBridge + 主站、异源代理、受限内层 iframe |
| A2UI renderer 可放在 App 内 | `/a2ui-in-app` | 宿主 DOM 无 A2UI 组件；iframe 内有组件与交互 |
| 工具保存不自动更新其他 UI | `save_pickup` 先保存，宿主回执适配启动 `pickup_saved` 新运行 | 后端重新读取并核对 arrangementId/version；伪造及过期回执拒绝 |
| 保存取件不等于退款 | 保存产生 PK 回执，确认才产生 RF 申请 | 保存前禁止确认；保存后 status 仍 awaiting_confirmation，无 refund |
| 业务服务才是记录依据 | 服务端保存时段、金额和版本 | 返回副本隔离、金额注入拒绝、并发版本冲突、重复决定幂等 |
| 恢复不应该重做业务 | 带 taskId 刷新/恢复只查询 | 已结束状态恢复；不新增取件/退款写入 |

当前服务端测试总计 21 项：原 demo 8 项、新增 13 项，全部通过。新增测试中含 2 项真正的 HTTP/MCP/SSE 集成测试，不是网络 mock。类型检查通过。

浏览器实测 20/20 通过：375px 与 1100px 下，三种新组合完整流程、两个标签页的真实版本冲突及恢复、旧三个入口确认/取消回归。无未处理脚本异常，无失败网络请求；首次访问的两条非 API 资源 404 不影响业务（MCP 版本冲突使用预期的 `isError/code:409` 工具结果）。每项结果由 `workbench-browser-results.json` 记录，截图位于 `browser-artifacts/`。其中测试任务都是本机内存中的虚构数据。

## 没有声称验证的内容

- 没有接入真实 LLM 或业务系统；流式文字是预设文字分片。
- 组件目录为 A2UI v0.9 自定义五组件教学子集，不是完整 A2UI SDK 或全量目录。
- 活动快照字段采用官方 middleware 的当前映射思路，应用自行实现分发；没有引入完整 CopilotKit。
- 普通 MCP 示例采用 embedded resource，不是另一套通用 A2UI 扩展的正式互操作认证。
- 只验证本地 Host，不能推断全部外部 MCP Apps 宿主都兼容。
- 重启后内存消失；没有数据库、身份权限、真实长期任务、中断续传或退款到账。
- `updateModelContext()` 的语义解释保留在文章中，demo 的业务回执不使用它；也不声称演示了该方法。

## 一手文档

- [Google：三种 A2UI / MCP Apps 组合](https://developers.googleblog.com/a2ui-and-mcp-apps/)
- [AG-UI 官方 A2UI middleware 源码](https://github.com/ag-ui-protocol/ag-ui/blob/main/middlewares/a2ui-middleware/src/index.ts)
- [MCP Apps AppBridge API](https://apps.extensions.modelcontextprotocol.io/api/classes/app-bridge.AppBridge.html)
- 依赖沿用项目锁定版本，以 `package-lock.json` 为准；未为演示无关目的升级依赖。
