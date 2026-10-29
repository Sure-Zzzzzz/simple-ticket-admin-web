import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import MyTicketsView from './MyTicketsView.vue';
import * as api from '../api/ticketApi';

vi.mock('../api/ticketApi', () => ({ listMyTickets: vi.fn() }));
vi.mock('../auth/pkce', () => ({ ticketIdentityEpoch: () => 1 }));

const ticket = {
  ticketNo: 'T-1', typeCode: 'fault', subject: '无法访问', status: 'SUBMITTED',
  priority: 'NORMAL', ownerSubjectId: 'person-1', ownerName: '提交人',
  assigneeGroup: null, assigneeSubjectId: null, assigneeName: null,
  overdueResponse: false, overdueResolution: false,
  lastActivityAt: '2026-10-15T00:00:00Z', createdAt: '2026-10-15T00:00:00Z'
};

describe('我的工单筛选', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listMyTickets).mockResolvedValue({ content: [ticket], page: 1, size: 20 });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function open(): Promise<VueWrapper> {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: MyTicketsView }]
    });
    await router.push('/');
    await router.isReady();
    wrapper = mount(MyTicketsView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('重置筛选会重新加载并清除已应用关键词', async () => {
    const view = await open();
    const search = view.find('[aria-label="搜索工单"]');
    await search.setValue('旧关键词');
    await view.findAll('button').find(button => button.text() === '查询')?.trigger('click');
    await flushPromises();
    expect(api.listMyTickets).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ q: '旧关键词' }));

    await view.findAll('button').find(button => button.text() === '重置')?.trigger('click');
    await flushPromises();
    expect(api.listMyTickets).toHaveBeenCalledTimes(3);
    expect(api.listMyTickets).toHaveBeenLastCalledWith(1, 20, {
      status: undefined, typeCode: undefined, from: undefined, to: undefined, q: undefined
    });
  });
});
