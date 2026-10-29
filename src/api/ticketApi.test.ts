import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTicketTokenSource,
  configureTicketTokenRevoker,
  configureTicketIdentityEpochSource,
  createTicket,
  deleteGroup,
  getTimeline,
  listAllTickets,
  listMyTickets,
  listQueue,
  claimTicket,
  requestAttachmentPresign,
  setTicketUnauthorizedHandler
} from './ticketApi';

describe('工单列表筛选契约', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    configureTicketTokenSource(() => 'ticket-token');
    configureTicketIdentityEpochSource(null);
    setTicketUnauthorizedHandler(null);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ content: [], page: 1, size: 20 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    configureTicketIdentityEpochSource(null);
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it.each([
    ['本人', listMyTickets, '/portal/my-tickets'],
    ['组队列', listQueue, '/manage/queue'],
    ['全部', listAllTickets, '/manage/all-tickets']
  ] as const)('%s使用可重复的status查询键', async (_name, load, path) => {
    await load(1, 20, ['SUBMITTED', 'PROCESSING']);
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://portal.example.test');
    expect(url.pathname).toBe(`/api/ticket${path}`);
    expect(url.searchParams.getAll('status')).toEqual(['SUBMITTED', 'PROCESSING']);
    expect(url.searchParams.has('status[0]')).toBe(false);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('size')).toBe('20');
  });

  it('空筛选不发送status', async () => {
    await listQueue(2, 20);
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://portal.example.test');
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('页面列表发送类型、日期和关键词筛选', async () => {
    await listMyTickets(1, 20, {
      status: ['PROCESSING'], typeCode: 'fault', from: '2026-10-01', to: '2026-10-17', q: 'TK-1'
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://portal.example.test');
    expect(url.searchParams.get('typeCode')).toBe('fault');
    expect(url.searchParams.get('from')).toBe('2026-10-01');
    expect(url.searchParams.get('to')).toBe('2026-10-17');
    expect(url.searchParams.get('q')).toBe('TK-1');
  });

  it('处理队列发送优先级、超时和关键词筛选', async () => {
    await listQueue(1, 20, {
      status: ['SUBMITTED'], priority: 'URGENT', overdue: true, q: '网络'
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://portal.example.test');
    expect(url.searchParams.get('priority')).toBe('URGENT');
    expect(url.searchParams.get('overdue')).toBe('true');
    expect(url.searchParams.get('q')).toBe('网络');
  });

  it('删除处理组时接受 200 空响应体', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(deleteGroup('grp-ops')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ticket/manage/groups/grp-ops');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('创建工单透传 Idempotency-Key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ticketNo: 'T-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    }));
    await createTicket({ typeCode: 'fault', subject: '无法访问' }, 'idem-ticket-1');
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('idem-ticket-1');
  });

  it('写操作透传 If-Match 版本', async () => {
    await claimTicket('T-1', 7);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get('If-Match')).toBe('"7"');
  });

  it('预签名申请透传文件大小', async () => {
    await requestAttachmentPresign('error.log', 'text/plain', 1024);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      fileName: 'error.log', contentType: 'text/plain', size: 1024
    });
  });

  it('时间线保留服务端 nextCursor', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      transitions: [], comments: [], attachments: [], nextCursor: '2026-10-16T00:00:00Z'
    }), { status: 200 }));
    await expect(getTimeline('T-1')).resolves.toMatchObject({ nextCursor: '2026-10-16T00:00:00Z' });
  });

  it('A→B→A 的旧 401 不撤销当前令牌或重新授权', async () => {
    let epoch = 1;
    let resolveResponse!: (response: Response) => void;
    const deferred = new Promise<Response>(resolve => { resolveResponse = resolve; });
    fetchMock.mockReset().mockReturnValue(deferred);
    configureTicketIdentityEpochSource(() => epoch);
    const revoke = vi.fn();
    const authorize = vi.fn();
    configureTicketTokenRevoker(revoke);
    setTicketUnauthorizedHandler(authorize);
    const pending = listMyTickets(1, 20);
    epoch = 2;
    epoch = 3;
    resolveResponse(new Response('', { status: 401 }));
    await expect(pending).rejects.toThrow('登录身份已变化');
    expect(revoke).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
});
