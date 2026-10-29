# 工单中心可信应用接入手册

工单中心以 Portal（统一门户中的业务子页面）接入，宿主运行 `simple-ticket-server-starter:1.0.1`（领域内核 `simple-ticket-server-core:1.0.0`），Web 为 `simple-ticket-admin-web:1.0.0`。管理宿主为 Spring Boot 2.7.9 / Java 8。本手册示例域名 `portal.example.test` 需替换为部署域名，不填写真实密钥到本仓。

## 1. 角色分工

| 系统 | 负责内容 |
| --- | --- |
| IAM | 可信应用登记、Portal 可见性、OAuth Client、权限清单、角色规则、人员准入与投影 |
| 工单 Server | 工单事实（类型/处理组/工单/流转/评价）、API 权限执行、DATA 范围评估（进 SQL）、SLA 扫描 |
| 工单 Web | PKCE 取人员令牌，以 Bearer 调工单 Server 页面 API |
| 机器消费者 | AKP + Idempotency-Key 调 openapi 自动开单/查单，不经浏览器 |

工单 Web 不保存 IAM 会话；人员令牌只存当前浏览器会话。机器消费者凭据不进 Web。

列表页码契约：浏览器请求只带 `page`（1 起）与 `size`（≤100，默认 20），服务端返回 `content/page/size`；时间线留言用 `before` 游标（上一页最早时刻）懒加载，两者不混用。

## 2. IAM 侧注册

使用 IAM 管理台的可信应用创建流程，或调用同等管理 API（`POST /iam/admin/trusted-applications`，创建前先 `GET` 按应用编码查重）。[注册值对照模板](../deploy/iam/portal-registration.example.json) 是登记值的对照，不是批量导入请求体。

| 字段 | 工单基线值 | 规则 |
| --- | --- | --- |
| 应用编码 | `ticket` | IAM 内唯一，与工单 Server 应用授权编码一致 |
| 应用名称 | `工单中心` | 用于 Portal 与授权页面展示 |
| 应用图标 | `message` | IAM 内置图标编码；不填 SVG、CSS 类名或外部 URL |
| Portal entry | `/app/ticket/index.html` | 统一入口下的公共页面路径；必须等于或位于 `routePrefix` 下，不能填写完整 URL |
| Portal apiBase | `/api/ticket` | 浏览器业务路径前缀 |
| routePrefix | `/app/ticket` | IAM 按应用编码自动生成，不在创建请求中填写；Ticket Web 只接受这个固定前缀，OAuth 回调也固定在其下 |
| targetOrigin | `http://ticket-web:80` | 页面和 API 共用的工单自有 Nginx HTTP origin；部署时填 Envoy 可达的工单 Nginx 地址 |
| 初始 Client id | `<PUBLIC_CLIENT_ID>` | 部署管理员登记后经 `VITE_TICKET_PKCE_CLIENT_ID` 构建注入；实际值不写回仓库 |
| 初始 Client 类型 | `PUBLIC` | 浏览器公共客户端，不生成 Secret |
| redirect URI | `https://portal.example.test/app/ticket/oauth-callback` | 协议、域名、端口和路径须精确匹配 |
| grantTypes | `authorization_code` | 授权码流程及 S256 PKCE；当前 Web 未实现 refresh token 续期，不登记未实现能力 |
| authenticationMethods | `none` | 浏览器不持有客户端 Secret |
| scopes | `openid`、`profile` | OAuth 请求范围，不代替 API 权限或 DATA |
| requireConsent | 按组织策略 | 授权确认页配置 |

创建请求可同时携带初始权限清单与门户菜单（`portal.menuTree`），IAM 在创建事务中先登记清单后保存菜单。保存实际返回的 `applicationId`；应用 id、用户 id、角色 id 是运行态值，不写回仓库模板。默认入口创建后经 Portal 配置提交：`{"pageMenuCode":"ticket-my","entryPath":"/"}`。

**登记 API 实测形态（2026-10-14 走查实录，与通用文档差异点）**：

- 创建请求体的客户端是 **`initialClient` 单数**（非 `clients` 数组），且 `clientId` 显式给定（PUBLIC 无 Secret，响应 `initialClientSecret` 为 null）。
- `dataResources` 每项必须带 **`dimensions` 数组**（可为空；`ticket` 声明 `["ownerSubjectId","assigneeGroup"]`），缺失即 400「dimensions 不能为空」。
- Portal 配置**没有独立 GET 端点**（GET `/portal/configuration` 返回 405）——从 `GET /iam/admin/trusted-applications/{id}` 明细的 `portal` 字段读 `configVersion` 与 `menuTree`，回填后 PUT 提交完整快照。
- 角色的 **`code` 经 API 不可改**（更新请求只有 name/description）——命名一次定对；改码 = 删了重建（未挂用户时零成本，本仓 ticket-agent→ticket-handler 即此通道）。
- 平台数据权限操作符**只有 `IN`**（无 EQ）——提单人本人维度的规则模板与 CRM 同构：`all:true` 无约束，范围收口在工单 Server 进 SQL。
- Git Bash 直接 curl 中文 body 会编码损坏（报「请求体格式错误」假象）——登记脚本中文字段一律 python `json.dump` 落文件再 `--data-binary @file`。

## 3. Portal 菜单与页面权限

菜单绑定页面权限按页面分码（五页各自 PAGE 码，与治理码对应）。GROUP 表示只收纳子节点的目录，不绑定路由和页面权限；工单五页平铺，不设 GROUP（不为只有一个子项的分组建目录）：

| 菜单 code | 名称 | 图标 | 子应用 route | 页面权限 |
| --- | --- | --- | --- | --- |
| `ticket-my` | 我的工单 | `document` | `/` | `ticket.page.my` |
| `ticket-handle` | 处理台 | `workflow` | `/handle` | `ticket.page.handle` |
| `ticket-all` | 全部工单 | `search` | `/handle/all` | `ticket.page.all` |
| `ticket-admin` | 类型与处理组 | `settings` | `/admin` | `ticket.page.admin` |
| `ticket-report` | 统计报表 | `analytics` | `/report` | `ticket.page.report` |

说明：全部工单、治理和统计报表分别使用独立路由与 PAGE 码，避免只具备其中一种页面权限的用户误触另一页接口。所有 PAGE 的 `presentationMode` 为 `STANDARD`、`children` 为空数组、`sortOrder=1..5`；`route` 相对 `/app/ticket`。图标只能使用 IAM 内置编码（`message/workflow/search/settings/analytics` 均在内置清单），未知编码会被拒绝。`/tickets/new` 与 `/tickets/:ticketNo` 是工作路由，不进菜单（从列表与按钮进入）。

更新已有应用时先读当前 Portal 配置再 `PUT /iam/admin/trusted-applications/{applicationId}/portal/configuration` 提交完整快照（含 `enabled`、完整 `menuTree` 与回读的 `configVersion`）；`menus` 与 `menuTree` 不能同时提交。任何菜单调整都必须回读保存后的 `menuTree` 和 `configVersion`，再经正式 Portal 刷新确认。菜单可见不代表具备业务 API 权限，隐藏菜单不能代替服务端拒绝。

## 4. 权限清单

[权限清单模板](../deploy/iam/permission-catalog.json) 声明工单全部权限。声明权限码只说明应用支持该能力，不自动授予用户；实际权限由角色规则和用户投影决定。

| 类型 | 登记值 |
| --- | --- |
| PAGE | `ticket.page.my` `ticket.page.all` `ticket.page.handle` `ticket.page.admin` `ticket.page.report` |
| API 提单人 | `ticket:read` `ticket:create` `ticket:comment` `ticket:withdraw` `ticket:evaluate` `ticket:close` |
| API 处理侧 | `ticket:claim` `ticket:assign` `ticket:transfer` `ticket:resolve` |
| API 治理 | `ticket:group-admin` `ticket:type-admin` `ticket:report` |
| DATA | 资源 `ticket`：`ownerSubjectId`（本人，EQ）/ `assigneeGroup`（组内，IN）/ 全量（admin，`all=true`）；资源 `ticketType`、`ticketGroup`（admin 读写） |

DATA 授权文档须使用 `simple-data-permission` 协议结构：`{"protocol":"simple-data-permission","version":"1.0","grants":[{"resource":"ticket","actions":["read","write"],"all":true,"constraints":[]}]}`。`all=true` 仅适合管理角色；提单人默认本人维度、处理组默认组内维度，按实际范围配置。

HTTP 语义分层：不可见（越权掩蔽）=404；可见但角色不符=403；状态冲突=409；字段校验=400；提交频控（limiter 双窗口：每秒突发+每日配额，人员/凭据维度）=429。错误体统一 `{code,message,fieldErrors[]}`。

## 5. 角色规则与人员准入

按部门、组织或用户组等稳定关系配置应用准入，不逐个人 ID 硬编码。以下三档角色由部署管理员在 IAM 创建并配置规则，权限清单登记不会自动创建角色或授予人员：

| 角色 | 定位 | API 面 | DATA |
| --- | --- | --- | --- |
| `ticket-admin` | 全权限（运维/超管） | API 清单全量（含治理三码） | 全量 `all=true` |
| `ticket-handler` | 处理组坐席 | 提单人面 + 处理侧四码 | 组内（IN 维度，按组配置） |
| `ticket-user` | 全体员工（提单人） | `ticket:read/create/comment/close/withdraw/evaluate` | 本人（EQ ownerSubjectId） |

配置顺序（官方 API 链路；SQL 直插不触发投影重算，禁止）：

1. `POST /iam/admin/roles` 建角色（按角色编码查重后建），保存实际 `roleId`。
2. 按用户 `subjectId` 先读 `GET /iam/admin/users/{subjectId}/application-authorizations/{applicationId}`；无记录先 `PUT` 建 `admitted=true` 准入（空角色/页面/API/DATA 仅限首次）；已有记录调整时必须保留回读的完整内容，不得空权限覆盖。
3. `PUT /iam/admin/roles/{roleId}/authorization-rules/{applicationId}` 提交角色完整规则（pagePermissions/apiPermissions/dataGrantTemplate），触发投影重算；重复配置前先读实际规则避免覆盖。
4. `POST /iam/admin/users/{subjectId}/roles/{roleId}` 分配未关联角色；重复分配不重算，不能当修复投影的操作。
5. 重读用户应用授权核对准入、角色、页面、API 与 DATA 投影。

处理组成员（`assigneeGroup` 维度）在工单 Server 本地组表维护（`/api/ticket/manage/groups`，组长/管理员操作），与 IAM 角色解耦：IAM 授"处理侧 API 码"，工单域授"哪个组"；成员被移出组后名下在途单继续由其处理。机器消费者不是业务角色：持 AKP 仅授 `ticket:create/read/comment/close` 与凭据 DATA，不授 PAGE。

页面动作边界：分派/转派接口已有契约，但 Web 无法从 Portal 的人员主体或“全部工单”读取权限可靠推断 `ticket:assign/transfer` 与组长资格，入口默认隐藏，待按单 capability 契约接入后启用。直接调用接口仍由资源层 API 码与工单域组长/admin 条件共同判定。

## 6. 宿主和网关

管理宿主属性前缀为 `io.github.surezzzzzz.sdk.ticket.server`（默认 `enable=true`）；HTTP 路径固定为 `/api/ticket`，Web `apiBase` 与该路径保持一致。宿主显式安装公共 Resource Server（业务 API 统一验证入口）与人员/机器双 Provider；公共资源链 `protectedPaths` 包含精确 `/api/ticket/**`。

统一入口只保留 IAM/Portal/AKSK 固定路由，并把其他 `/app/**` 页面和 `/api/**` 请求统一交给 Envoy。IAM 不逐个配置 Ticket 的页面或 API，也不直接访问 Ticket Server。Envoy 用 `routePrefix` 匹配 `/app/ticket/**`，用 `apiBase` 匹配 `/api/ticket/**`，两者都转发到同一个 `targetOrigin`；Ticket Nginx 再把页面静态文件和 API 分别交给 Web 构建产物与 Ticket Server。

工单 Nginx 配置：

```nginx
map $http_x_forwarded_host $ticket_forwarded_host {
  default $http_x_forwarded_host;
  "" $http_host;
}
map $http_x_forwarded_proto $ticket_forwarded_proto {
  default $http_x_forwarded_proto;
  "" $scheme;
}

server {
  listen 80;
  location ^~ /app/ticket/ {
    alias /www/ticket/;
    try_files $uri $uri/ /app/ticket/index.html;
  }
  location ^~ /api/ticket/ {
    proxy_pass http://ticket-server:8395;
    proxy_set_header Host $ticket_forwarded_host;
    proxy_set_header X-Forwarded-Host $ticket_forwarded_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $ticket_forwarded_proto;
  }
}
```

Ticket Nginx 需要加入业务运行网络以访问 `ticket-server`，并加入 Gateway 上游网络（供 Envoy 通过服务名访问业务 Nginx）以接受 Envoy 转发；部署时先创建 Gateway 上游网络，再启动 Ticket Web。IAM Nginx 通过 Gateway 入站网络连接 Envoy，并仍使用 IAM 自有网络访问 IAM/AKSK；它不加入 Gateway 上游网络，也不配置 Ticket Nginx 或 Ticket Server 的逐应用路由。身份授权与令牌交换 `/oauth2/authorize`、`/oauth2/token` 仍由 IAM 固定路径处理，不改写为业务路径。

**宿主资源验证客户端登记（第 4 件，缺它则页面 API 全 401）**：宿主验证人员令牌走 IAM 的 `POST /iam/resource/tokens/verify`，该端点要求 Basic 认证的资源验证客户端。登记：`POST /iam/admin/trusted-applications/{applicationId}/resource-verification-clients`，body `{"clientId":"ticket-server-verify"}`，secret 服务端生成且响应中一次性返回（201）；登记后写入宿主 env `TICKET_VERIFY_CLIENT_ID` / `TICKET_VERIFY_SECRET`。实测：secret 未登记或错值时，宿主侧验证调用收 401 → 页面 API 全 401（与未认证同形，排障先查此项）。网关容器互访一律容器内口（如 aksk 内口 8080 / 宿主映射 8280）。

## 7. 完整验收

1. 人员从门户进入"我的工单"，列表只覆盖本人 DATA 范围；空列表与加载更多形态正常。
2. 提单：选类型→模板动态字段渲染（必填/选项/长度服务端同校验）→提交回单号；受理超 SLA 后处理台"已超时"标红。
3. 处理组：队列按优先级降序+创建升序；受理→留言（内部备注提单人不可见）→待补充（办结计时暂停，恢复后累计）→办结→提单人确认/重开。
4. 撤销入口仅非终态可见；确认超时（可配短时限实测）服务端自动关闭且不邀请评价。
5. 评价 CLOSED 后一次不可改；评价走站内信通知处理人。
6. 机器消费者持 AKP 携 Idempotency-Key 自动开单：同键同体返回原单（200）、异体 409；append/close 限本凭据创建的单。
7. 越权访问已存在工单返回 404（掩蔽）；可见但角色不符返回 403；两类不能互串。
8. 切换身份、令牌失效或卸载页面时清空旧结果；旧响应与旧 401 不能影响当前身份。
9. 通知到达：提单/受理/办结后提单人与处理人的 IAM 站内信收到对应通知（标题含单号+动作）；通知 AKP 未登记时工单流转仍 200（降级不阻塞），但站内信无信——排障查通知适配器形态。
10. 机器面回归：`GET /api/ticket/openapi/tickets` 空列表 200；用他凭据 AKP 查本凭据单 = 404；`POST /api/ticket/openapi/tickets` 缺 Idempotency-Key = 400。

## 8. 常见错误

| 现象 | 优先检查 |
| --- | --- |
| Portal 看不到工单中心 | Portal 集成是否开启、用户应用准入及页面权限是否已投影 |
| 子应用挂载空白无报错 | entry 是否指向 `/app/ticket/index.html`；不要把 Portal 壳的目录入口登记为子应用 entry |
| PKCE 回调失败 | PUBLIC Client id 与 `VITE_TICKET_PKCE_CLIENT_ID` 一致、S256、redirect URI 精确匹配 |
| 清单已登记但 API 仍 403 | 角色规则和用户投影是否实际授予；申报清单不等于授予 |
| 组队列看不到新单 | 处理组成员是否在工单 Server 组表内（组内维度是工单本地数据，非 IAM 投影） |
| 能看页面但写操作 404 | DATA 归属校验：提单人仅能操作本人单（安全 not-found）；分派/转派需组长或 admin |
| 提交返回 429 | limiter 双窗口（每秒突发+每日配额）触发；确认 KeyProvider 维度与规则窗口 |
| 通知收不到 | 站内信适配是否聚形态装配（IAM 客户端链+AKP 授 `iam:message:api`）；散形态为日志降级 |
