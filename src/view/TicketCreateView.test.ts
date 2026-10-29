import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import TicketCreateView from './TicketCreateView.vue';
import * as api from '../api/ticketApi';

vi.mock('../api/ticketApi', () => ({
  listPortalTypes: vi.fn(),
  createTicket: vi.fn()
}));

const identity = vi.hoisted(() => ({ epoch: 1 }));
vi.mock('../auth/pkce', () => ({ ticketIdentityEpoch: () => identity.epoch }));

describe('提单模板', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPortalTypes).mockResolvedValue([{
      id: 1, code: 'fault', name: '故障报修', defaultGroup: 'ops',
      formTemplate: JSON.stringify([{ key: 'impact', label: '影响范围', type: 'text', required: true }]),
      slaResponseMinutes: 60, slaResolutionMinutes: 480, enabled: true
    }]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('必填模板字段未填时不能提交', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/tickets/new', component: TicketCreateView }]
    });
    await router.push('/tickets/new');
    await router.isReady();
    wrapper = mount(TicketCreateView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('input[placeholder="一句话描述问题"]').setValue('无法访问系统');
    const submit = wrapper.findAll('button').find(button => button.text() === '提交工单');
    expect(submit?.attributes('disabled')).toBeDefined();
    await wrapper.get('input[maxlength="2000"]').setValue('单系统');
    expect(submit?.attributes('disabled')).toBeUndefined();
  });

  it('身份切换后迟到的旧类型不会覆盖新页面', async () => {
    let resolveOld!: (value: typeof activeType[]) => void;
    const activeType = {
      id: 1, code: 'fault', name: '旧类型', defaultGroup: 'ops', formTemplate: '[]',
      slaResponseMinutes: 60, slaResolutionMinutes: 480, enabled: true
    };
    const newType = { ...activeType, code: 'access', name: '新类型' };
    const oldTypes = new Promise<typeof activeType[]>(resolve => { resolveOld = resolve; });
    vi.mocked(api.listPortalTypes).mockReset()
      .mockReturnValueOnce(oldTypes)
      .mockResolvedValueOnce([newType]);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/tickets/new', component: TicketCreateView }]
    });
    await router.push('/tickets/new');
    await router.isReady();

    const first = mount(TicketCreateView, { global: { plugins: [router] } });
    first.unmount();
    identity.epoch = 2;
    wrapper = mount(TicketCreateView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('新类型');

    resolveOld([activeType]);
    await flushPromises();
    expect(wrapper.text()).toContain('新类型');
    expect(wrapper.text()).not.toContain('旧类型');
  });
});
