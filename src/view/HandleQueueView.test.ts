import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import HandleQueueView from './HandleQueueView.vue';
import * as api from '../api/ticketApi';

vi.mock('../api/ticketApi', () => ({
  listAllTickets: vi.fn(), listQueue: vi.fn(), claimTicket: vi.fn()
}));
vi.mock('../auth/pkce', () => ({ ticketIdentityEpoch: () => 1 }));

const submitted = {
  ticketNo: 'T-1', typeCode: 'fault', subject: '无法访问', status: 'SUBMITTED',
  priority: 'NORMAL', ownerSubjectId: 'owner-1', ownerName: '提交人',
  assigneeGroup: 'ops', assigneeSubjectId: null, assigneeName: null,
  overdueResponse: false, overdueResolution: false,
  lastActivityAt: '2026-10-15T00:00:00Z', createdAt: '2026-10-15T00:00:00Z'
};

describe('处理台受理入口', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAllTickets).mockResolvedValue({ content: [submitted], page: 1, size: 20 });
    vi.mocked(api.listQueue).mockResolvedValue({ content: [submitted], page: 1, size: 20 });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function open(scope: 'all' | 'queue'): Promise<VueWrapper> {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: HandleQueueView }]
    });
    await router.push('/');
    await router.isReady();
    wrapper = mount(HandleQueueView, { props: { scope }, global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('全量只读列表不把可见性当作受理权限', async () => {
    const view = await open('all');
    expect(view.findAll('button').map(button => button.text())).not.toContain('受理');
    expect(view.findAll('button').map(button => button.text())).toContain('详情');
  });

  it('处理组队列保留受理入口', async () => {
    const view = await open('queue');
    expect(view.findAll('button').map(button => button.text())).toContain('受理');
  });

  it('重置筛选会重新加载并清除已应用关键词', async () => {
    const view = await open('queue');
    const search = view.find('[aria-label="搜索队列"]');
    await search.setValue('旧关键词');
    await view.findAll('button').find(button => button.text() === '查询')?.trigger('click');
    await flushPromises();
    expect(api.listQueue).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ q: '旧关键词' }));

    await view.findAll('button').find(button => button.text() === '重置')?.trigger('click');
    await flushPromises();
    expect(api.listQueue).toHaveBeenCalledTimes(3);
    expect(api.listQueue).toHaveBeenLastCalledWith(1, 20, {
      status: undefined, priority: undefined, overdue: undefined, q: undefined
    });
  });
});
