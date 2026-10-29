/** 工单 API 错误（携带 HTTP 状态码供 401 重授权/409 提示分派）。 */
export class TicketApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(message: string, status: number, code: string | null = null,
              fieldErrors: Readonly<Record<string, string>> = {}) {
    super(message);
    this.name = 'TicketApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** 分页响应（服务端 content+page+size 形态）。 */
export interface TicketPage<T> {
  content: T[];
  page: number;
  size: number;
}

export interface TicketSummary {
  ticketNo: string;
  typeCode: string;
  subject: string;
  status: string;
  priority: string;
  ownerSubjectId: string;
  ownerName: string | null;
  assigneeGroup: string | null;
  assigneeSubjectId: string | null;
  assigneeName: string | null;
  overdueResponse: boolean;
  overdueResolution: boolean;
  lastActivityAt: string;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  description: string | null;
  formAnswers: string | null;
  relatedTicketNo: string | null;
  responseDeadline: string;
  resolutionDeadline: string;
  confirmDeadline: string | null;
  acceptedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  version: number;
}

export interface TicketComment {
  id: number;
  authorRole: string;
  authorName: string | null;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface TicketTransition {
  id: number;
  fromStatus: string;
  toStatus: string;
  action: string;
  actorSubjectId: string | null;
  actorRole: string;
  reasonCode: string | null;
  createdAt: string;
}

export interface TicketAttachment {
  id: number;
  ticketId: number;
  commentId: number | null;
  objectKey: string;
  fileName: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  createdAt: string;
}

export interface TicketTimeline {
  transitions: TicketTransition[];
  comments: TicketComment[];
  attachments: TicketAttachment[];
  nextCursor?: string | null;
}

export interface TicketType {
  id: number;
  code: string;
  name: string;
  formTemplate: string | null;
  defaultGroup: string;
  slaResponseMinutes: number;
  slaResolutionMinutes: number;
  enabled: boolean;
}

export interface TicketGroup {
  id: number;
  code: string;
  name: string;
  memberSubjectIds: string[];
  leaderSubjectId: string | null;
  enabled: boolean;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'textarea';
  required?: boolean;
  options?: string[];
  maxLength?: number;
}

export interface AttachmentItem {
  objectKey: string;
  fileName: string;
  contentType: string;
  size?: number;
}

let unauthorizedHandler: (() => void) | null = null;
let reauthorizationPending = false;

/** 注入 401 重授权处理器（main.ts 挂 PKCE 授权入口）。 */
export function setTicketUnauthorizedHandler(handler: (() => void) | null): void {
  if (handler !== unauthorizedHandler || !handler) reauthorizationPending = false;
  unauthorizedHandler = handler;
}

/** 等待新令牌期间只发起一次授权，页面重挂不能覆盖已发出的 PKCE 请求。 */
function requestTicketReauthorization(revokeToken = false): void {
  const handler = reauthorizationPending ? null : unauthorizedHandler;
  // 先撤销旧令牌再登记授权状态，由 PKCE 流程重新获取本应用令牌。
  if (revokeToken) revokeTokenHook?.();
  if (handler) reauthorizationPending = true;
  if (!handler) return;
  if (handler !== unauthorizedHandler) {
    if (!reauthorizationPending) requestTicketReauthorization();
    return;
  }
  try {
    handler();
  } catch (error) {
    reauthorizationPending = false;
    throw error;
  }
}

let apiBase = '/api/ticket';

/** 注入 API 基路径（门户挂载参数传入；默认同源 /api/ticket，独立调试走 vite 代理）。 */
export function configureTicketApi(base: string): void {
  const normalized = base.replace(/\/$/, '');
  if (!normalized.startsWith('/')) {
    throw new Error('API 基路径必须是同源绝对路径');
  }
  apiBase = normalized;
}

/** 从 pkce 模块延迟取令牌（避免与 auth 层循环依赖）。 */
let accessTokenSource: (() => string | null) | null = null;

/** main.ts 挂令牌读取器。 */
export function configureTicketTokenSource(source: () => string | null): void {
  accessTokenSource = source;
}

let revokeTokenHook: (() => void) | null = null;

/** main.ts 挂令牌撤销器（401 重授权时清除本应用旧令牌）。 */
export function configureTicketTokenRevoker(revoke: () => void): void {
  revokeTokenHook = revoke;
}

let identityEpochSource: (() => number) | null = null;

/** 旧身份请求不得处理迟到响应，尤其不能用旧 401 撤销新令牌。 */
export function configureTicketIdentityEpochSource(source: (() => number) | null): void {
  identityEpochSource = source;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = accessTokenSource?.() ?? null;
  const identityEpoch = identityEpochSource?.();
  if (!token) {
    requestTicketReauthorization();
    throw new TicketApiError('登录已过期', 401);
  }
  reauthorizationPending = false;
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);
  // 浏览器业务请求仅 Bearer，禁止附带 Cookie（接入手册形态）
  const response = await fetch(`${apiBase}${path}`, { ...init, credentials: 'omit', headers });
  if (identityEpochSource && identityEpoch !== identityEpochSource()) {
    throw new Error('登录身份已变化');
  }
  if (response.status === 401) {
    requestTicketReauthorization(true);
    throw new TicketApiError('登录已过期', 401);
  }
  if (!response.ok) {
    let message = `请求失败: ${response.status}`;
    let code: string | null = null;
    let fieldErrors: Record<string, string> = {};
    try {
      const body = (await response.json()) as {
        message?: string;
        code?: string;
        fieldErrors?: Record<string, string> | Array<{ field?: string; message?: string }>;
      };
      if (body?.message) {
        message = body.message;
      }
      code = body?.code ?? null;
      if (Array.isArray(body?.fieldErrors)) {
        fieldErrors = Object.fromEntries(body.fieldErrors
          .filter(item => item.field && item.message)
          .map(item => [item.field as string, item.message as string]));
      } else if (body?.fieldErrors) {
        fieldErrors = body.fieldErrors;
      }
    } catch {
      // 非 JSON 错误体：保留状态码消息
    }
    throw new TicketApiError(message, response.status, code, fieldErrors);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const responseText = await response.text();
  const body = responseText ? JSON.parse(responseText) as T : undefined as T;
  if (identityEpochSource && identityEpoch !== identityEpochSource()) {
    throw new Error('登录身份已变化');
  }
  return body;
}

function query(params: Record<string, string | number | boolean | string[] | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) search.append(key, item);
      }
    } else if (value !== null && value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ==================== portal 面 ====================

export interface TicketListFilters {
  status?: string[];
  typeCode?: string;
  from?: string;
  to?: string;
  q?: string;
}

export function listMyTickets(page: number, size: number, statusOrFilters?: string[] | TicketListFilters,
                              filters: TicketListFilters = {}):
    Promise<TicketPage<TicketSummary>> {
  const options = Array.isArray(statusOrFilters)
    ? { ...filters, status: statusOrFilters }
    : { ...statusOrFilters };
  return request(`/portal/my-tickets${query({ page, size, ...options })}`);
}

export interface CreateTicketPayload {
  typeCode: string;
  subject: string;
  description?: string;
  priority?: string;
  formAnswers?: Record<string, string>;
  attachments?: AttachmentItem[];
  relatedTicketNo?: string;
}

export function createTicket(payload: CreateTicketPayload, idempotencyKey: string): Promise<TicketSummary> {
  return request('/portal/tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': idempotencyKey }
  });
}

export function getTicket(ticketNo: string): Promise<TicketDetail> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}`);
}

/** 管理面详情：按组内/全量 DATA 读取，不走 Portal 本人归属范围。 */
export function getManageTicket(ticketNo: string): Promise<TicketDetail> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}`);
}

export function getTimeline(ticketNo: string, before?: string, size = 50):
    Promise<TicketTimeline> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/timeline${query({ before, size })}`);
}

/** 管理面时间线：处理人可看到内部留言。 */
export function getManageTimeline(ticketNo: string, before?: string, size = 50):
    Promise<TicketTimeline> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/timeline${query({ before, size })}`);
}

export function addComment(ticketNo: string, body: string, version?: number): Promise<TicketComment> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }), headers: versionHeaders(version)
  });
}

/** 管理面留言，internal=false 时也必须走管理 DATA 链路。 */
export function addManageComment(ticketNo: string, body: string, internal: boolean,
                                 version?: number): Promise<TicketComment> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, internal }), headers: versionHeaders(version)
  });
}

export function supplyTicket(ticketNo: string, body: string, version?: number): Promise<TicketSummary> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/supply`, {
    method: 'POST',
    body: JSON.stringify({ body }), headers: versionHeaders(version)
  });
}

export function confirmTicket(ticketNo: string, version?: number): Promise<TicketSummary> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/confirm`, {
    method: 'POST', headers: versionHeaders(version)
  });
}

export function rejectTicket(ticketNo: string, version?: number): Promise<TicketSummary> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/reject`, {
    method: 'POST', headers: versionHeaders(version)
  });
}

export function withdrawTicket(ticketNo: string, version?: number): Promise<TicketSummary> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/withdraw`, {
    method: 'POST', headers: versionHeaders(version)
  });
}

export function evaluateTicket(ticketNo: string, star: number, comment?: string, version?: number):
    Promise<{ evaluated: boolean; star: number }> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/evaluation`, {
    method: 'POST',
    body: JSON.stringify({ star, comment }), headers: versionHeaders(version)
  });
}

export interface AttachmentPresign {
  objectKey: string;
  uploadUrl: string;
  uploadedBy?: string;
}

export function requestAttachmentPresign(fileName: string, contentType: string, size: number):
    Promise<AttachmentPresign> {
  return request('/portal/attachments/presign', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType, size })
  });
}

/** 预签名上传不带业务 Bearer，避免将人员令牌泄露到对象存储。 */
export async function uploadAttachment(file: File): Promise<AttachmentItem> {
  const presign = await requestAttachmentPresign(file.name, file.type || 'application/octet-stream', file.size);
  const target = new URL(presign.uploadUrl, window.location.href);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new TicketApiError('附件上传地址无效', 400);
  }
  const response = await fetch(target.href, {
    method: 'PUT',
    credentials: 'omit',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
  if (!response.ok) {
    throw new TicketApiError(`附件上传失败: ${response.status}`, response.status);
  }
  return {
    objectKey: presign.objectKey,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size
  };
}

export function getAttachmentDownloadUrl(ticketNo: string, attachmentId: number):
    Promise<{ downloadUrl: string }> {
  return request(`/portal/tickets/${encodeURIComponent(ticketNo)}/attachments/${attachmentId}/download-url`);
}

export function getManageAttachmentDownloadUrl(ticketNo: string, attachmentId: number):
    Promise<{ downloadUrl: string }> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/attachments/${attachmentId}/download-url`);
}

export function listPortalTypes(): Promise<TicketType[]> {
  return request('/portal/types');
}

// ==================== manage 面 ====================

export interface QueueFilters {
  status?: string[];
  priority?: string;
  overdue?: boolean;
  q?: string;
}

export function listQueue(page: number, size: number, statusOrFilters?: string[] | QueueFilters,
                          filters: QueueFilters = {}):
    Promise<TicketPage<TicketSummary>> {
  const options = Array.isArray(statusOrFilters)
    ? { ...filters, status: statusOrFilters }
    : { ...statusOrFilters };
  return request(`/manage/queue${query({ page, size, ...options })}`);
}

export function listAllTickets(page: number, size: number, status?: string[]):
    Promise<TicketPage<TicketSummary>> {
  return request(`/manage/all-tickets${query({ page, size, status })}`);
}

function versionHeaders(version?: number): HeadersInit | undefined {
  return version === undefined ? undefined : { 'If-Match': `"${version}"` };
}

export function claimTicket(ticketNo: string, version?: number): Promise<TicketSummary> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/claim`, {
    method: 'POST', headers: versionHeaders(version)
  });
}

export function assignTicket(ticketNo: string, groupCode: string, assigneeSubjectId: string,
                             version?: number):
    Promise<TicketSummary> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/assign`, {
    method: 'POST',
    body: JSON.stringify({ groupCode, assigneeSubjectId }), headers: versionHeaders(version)
  });
}

export function transferTicket(ticketNo: string, groupCode: string, assigneeSubjectId: string,
                               version?: number):
    Promise<TicketSummary> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ groupCode, assigneeSubjectId }), headers: versionHeaders(version)
  });
}

export function requestInfoTicket(ticketNo: string, reason: string, version?: number): Promise<TicketSummary> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/request-info`, {
    method: 'POST',
    body: JSON.stringify({ reason }), headers: versionHeaders(version)
  });
}

export function resolveTicket(ticketNo: string, version?: number): Promise<TicketSummary> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/resolve`, {
    method: 'POST', headers: versionHeaders(version)
  });
}

export function addInternalComment(ticketNo: string, body: string, version?: number): Promise<TicketComment> {
  return request(`/manage/tickets/${encodeURIComponent(ticketNo)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, internal: true }), headers: versionHeaders(version)
  });
}

// ==================== admin 面 ====================

export function listTypes(): Promise<TicketType[]> {
  return request('/manage/types');
}

export function saveType(type: Partial<TicketType>): Promise<TicketType> {
  return request('/manage/types', { method: 'POST', body: JSON.stringify(type) });
}

export function listGroups(): Promise<TicketGroup[]> {
  return request('/manage/groups');
}

export function saveGroup(group: Partial<TicketGroup>): Promise<TicketGroup> {
  return request('/manage/groups', { method: 'POST', body: JSON.stringify(group) });
}

export function deleteGroup(code: string): Promise<void> {
  return request(`/manage/groups/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

export interface TicketReport {
  from: string | null;
  to: string | null;
  byStatus: Array<{ key: string; count: number; status?: string }>;
  byType: Array<{ key: string; count: number; status?: string }>;
  byGroup: Array<{ key: string; count: number; status?: string }>;
  responseSlaRate: number;
  resolutionSlaRate: number;
  overdueRate: number;
  averageResponseMinutes: number;
  averageResolutionMinutes: number;
  satisfaction: {
    averageStar: number;
    evaluated: number;
    resolved: number;
    participationRate: number;
    /** 旧服务端字段兼容读取；新服务端使用 averageStar。 */
    avgStar?: number;
  };
}

export function getReport(from?: string, to?: string): Promise<TicketReport> {
  return request(`/manage/report${query({ from, to })}`);
}
