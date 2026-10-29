import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import TicketDetailView from './TicketDetailView.vue';
import * as api from '../api/ticketApi';

const identity = vi.hoisted(() => ({ subjectId: 'owner-1' }));

vi.mock('../auth/pkce', () => ({
  ticketCurrentSubjectId: () => identity.subjectId,
  ticketIdentityEpoch: () => 1
}));

vi.mock('../api/ticketApi', () => ({
  getTicket: vi.fn(), getTimeline: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  addComment: vi.fn(), addInternalComment: vi.fn(), assignTicket: vi.fn(), transferTicket: vi.fn(),
  requestInfoTicket: vi.fn(), resolveTicket: vi.fn(), supplyTicket: vi.fn(),
  confirmTicket: vi.fn(), rejectTicket: vi.fn(), withdrawTicket: vi.fn(), evaluateTicket: vi.fn()
}));

const detail = {
  ticketNo: 'T-1', typeCode: 'fault', subject: '无法访问', status: 'PROCESSING',
  priority: 'NORMAL', ownerSubjectId: 'owner-1', ownerName: '提交人',
  assigneeGroup: 'ops', assigneeSubjectId: 'handler-1', assigneeName: '处理人',
  overdueResponse: false, overdueResolution: false, lastActivityAt: '', createdAt: '',
  description: '现象', formAnswers: null, relatedTicketNo: null,
  responseDeadline: '', resolutionDeadline: '', confirmDeadline: null,
  acceptedAt: null, resolvedAt: null, closedAt: null, version: 1
};

describe('工单详情角色动作', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    identity.subjectId = 'owner-1';
    vi.mocked(api.getTicket).mockResolvedValue({ ...detail });
    vi.mocked(api.getTimeline).mockResolvedValue({ transitions: [], comments: [], attachments: [] });
    vi.mocked(api.requestInfoTicket).mockResolvedValue({ ...detail, status: 'PENDING_INFO' });
    vi.mocked(api.assignTicket).mockResolvedValue({ ...detail });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  async function open(from: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/tickets/:ticketNo', component: TicketDetailView }]
    });
    await router.push(`/tickets/T-1?from=${from}`);
    await router.isReady();
    wrapper = mount(TicketDetailView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('提单人只看到本人动作，不出现处理侧动作', async () => {
    const view = await open('handle');
    expect(view.text()).toContain('撤销工单');
    expect(view.text()).not.toContain('请求补充');
    expect(view.text()).not.toContain('办结');
    expect(view.text()).not.toContain('分派');
  });

  it('当前处理人可请求补充与办结，不能执行提单人动作', async () => {
    identity.subjectId = 'handler-1';
    const view = await open('handle');
    expect(view.text()).toContain('请求补充');
    expect(view.text()).toContain('办结');
    expect(view.text()).not.toContain('撤销工单');
    const button = view.findAll('button').find(item => item.text() === '请求补充');
    await button?.trigger('click');
    await flushPromises();
    expect(api.requestInfoTicket).toHaveBeenCalledWith('T-1', 'AWAIT_MATERIAL', 1);
  });

  it('全量列表上下文不等于分派权限，默认不展示写动作', async () => {
    identity.subjectId = 'admin-1';
    vi.mocked(api.getTicket).mockResolvedValue({ ...detail, status: 'SUBMITTED' });
    const view = await open('all');
    expect(view.findAll('button').some(item => item.text() === '分派')).toBe(false);
    expect(view.findAll('button').some(item => item.text() === '转派')).toBe(false);
    expect(view.findAll('button').some(item => item.text() === '办结')).toBe(false);
  });

  it('详情加载失败提供错误与重试', async () => {
    vi.mocked(api.getTicket).mockRejectedValueOnce(new Error('连接失败'));
    const view = await open('handle');
    expect(view.find('[role="alert"]').text()).toContain('连接失败');
    await view.find('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(api.getTicket).toHaveBeenCalledTimes(2);
    expect(view.text()).toContain('无法访问');
  });

  it('处理人姓名缺失时显示处理人主体标识', async () => {
    vi.mocked(api.getTicket).mockResolvedValue({ ...detail, assigneeName: null });
    const view = await open('handle');
    expect(view.text()).toContain('handler-1');
    expect(view.text()).not.toContain('待受理');
  });

  it('同一秒内有无小数位的事件按真实时间排序', async () => {
    vi.mocked(api.getTimeline).mockResolvedValue({
      transitions: [{
        id: 1, fromStatus: 'SUBMITTED', toStatus: 'PROCESSING', action: 'CLAIM',
        actorSubjectId: 'handler-1', actorRole: 'ASSIGNEE', reasonCode: null,
        createdAt: '2026-10-15T00:00:00Z'
      }],
      comments: [{
        id: 2, authorRole: 'OWNER', authorName: '提交人', body: '后续留言', internal: false,
        createdAt: '2026-10-15T00:00:00.500Z'
      }],
      attachments: []
    });
    const view = await open('handle');
    const titles = view.findAll('.timeline-title').map(item => item.text());
    expect(titles[0]).toContain('留言');
    expect(titles[1]).toContain('受理工单');
  });

  it('展示附件并通过受保护接口获取下载地址', async () => {
    vi.mocked(api.getTimeline).mockResolvedValue({
      transitions: [], comments: [],
      attachments: [{
        id: 7, ticketId: 1, commentId: null, objectKey: 'ticket/T-1/a.txt', fileName: '记录.txt',
        size: 1024, contentType: 'text/plain', uploadedBy: 'owner-1', createdAt: '2026-10-15T00:00:00Z'
      }]
    });
    vi.mocked(api.getAttachmentDownloadUrl).mockResolvedValue({
      downloadUrl: 'https://files.example.test/ticket/a.txt'
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const view = await open('handle');
    expect(view.text()).toContain('记录.txt');
    expect(view.text()).toContain('1.0 KB');
    await view.find('button[aria-label="下载附件 记录.txt"]').trigger('click');
    await flushPromises();
    expect(api.getAttachmentDownloadUrl).toHaveBeenCalledWith('T-1', 7);
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(link.href).toBe('https://files.example.test/ticket/a.txt');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('按 nextCursor 加载更早的时间线记录', async () => {
    vi.mocked(api.getTimeline)
      .mockResolvedValueOnce({ transitions: [], comments: [], attachments: [], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ transitions: [], comments: [], attachments: [], nextCursor: null });
    const view = await open('handle');
    await view.findAll('button').find(item => item.text() === '加载更早记录')?.trigger('click');
    await flushPromises();
    expect(api.getTimeline).toHaveBeenCalledWith('T-1', 'cursor-1');
    expect(view.text()).not.toContain('加载更早记录');
  });

  it('关闭后提单人可以提交一次评价并携带版本', async () => {
    vi.mocked(api.getTicket).mockResolvedValue({ ...detail, status: 'CLOSED' });
    vi.mocked(api.evaluateTicket).mockResolvedValue({ evaluated: true, star: 5 });
    const view = await open('handle');
    expect(view.text()).toContain('评价处理结果');
    await view.findAll('button').find(item => item.text() === '提交评价')?.trigger('click');
    await flushPromises();
    expect(api.evaluateTicket).toHaveBeenCalledWith('T-1', 5, undefined, 1);
    expect(view.text()).not.toContain('评价处理结果');
  });
});
