# simple-ticket-admin-web

工单中心（独立前端仓）：统一工单平台的页面入口——提交与跟踪工单（提单人）、受理与流转（处理组）、类型/处理组治理与统计（管理员）。

## 形态

- Vue 3 + Vite + TypeScript；qiankun 子应用（独立运行亦可用），固定挂载前缀 `/app/ticket/`。
- 认证：浏览器 PKCE 人员令牌（IAM），令牌不跨服务转发；工单 Server API 经代理 `/api` 访问。独立开发时同源 `/oauth2` 由 Vite 转到本地 IAM（8180），部署构建通过 `VITE_TICKET_PKCE_ISSUER` 指定实际身份入口。
- 页面：我的工单（列表+筛选+加载更多）、工单详情（状态流转步进+时间线与本人/处理侧动作）、提交工单（类型表单模板 JSON 动态渲染）、处理台（组队列+受理+超时标红）、全部工单、类型与处理组治理、统计报表（状态分布与满意度）。

工单受理"人对组织的请求"（咨询/故障报修/权限申请等），不是审批流。状态机五态固定：已提交→处理中⇄待补充→已解决→已关闭（另有已撤销终态）；办结时限在待补充期间暂停计时，确认超时（默认 7 天）由服务端自动关闭。开放接口的机器自动开单不经本 Web，走工单 openapi + AKSK 客户端件。

列表页码契约：请求 `page`（1 起）与 `size`，响应 `content/page/size`（加载更多形态，无 total）；时间线留言走 `before` 游标懒加载。后端 wire 详情见 normal-sdks `sdk/ticket/DESIGN.1.0.0.md`；服务端使用 `simple-ticket-server-starter:1.0.1`。

## 开发

```bash
npm install
npm run dev        # 5179，/api 代理到 localhost:8395（工单 Server runtime）
npm run build      # 产物 dist/（base /app/ticket/）
npm run type-check && npm run lint && npm run test:run
```

构建期配置：`VITE_TICKET_PKCE_CLIENT_ID` / `VITE_TICKET_PKCE_ISSUER` 由 CI 凭据注入（机密与 client_id 不进仓），仓库只留使用形态不保留值。

## 可信应用接入

IAM 侧注册值、三权登记、宿主网关与完整验收见 [docs/TRUSTED_APPLICATION_ONBOARDING.md](docs/TRUSTED_APPLICATION_ONBOARDING.md)。

## 边界

- 浏览器不接触数据库与基础设施凭据；全部数据经工单 Server REST API。
- 页面可见性、接口操作权限与数据范围各自校验：PAGE 由 IAM 裁菜单，API 码由公共资源层把守，DATA（本人/组内/全量）由工单 Server 进 SQL 收口；越权访问已存在工单返回 404（不泄露存在性）。
- 分派/转派 API 已对接，但页面入口等待服务端提供按单 capability 后启用；不能用“全部工单可读”推断写权限。当前 UI 仅按稳定主体归属展示提单人与当前处理人动作，服务端仍逐次鉴权。
- 机器消费方不经过本 Web：走 `/api/ticket/openapi/**` + AKP（Idempotency-Key 必填），凭据边界=本凭据创建的单。
- 通知（受理/待补充/办结等十类）经 IAM 站内信投递，本 Web 不自建角标。
- Web 的 OAuth 回调固定为 `/app/ticket/oauth-callback`；运行时会拒绝其他 `routePrefix`，避免入口与回调登记不一致。
