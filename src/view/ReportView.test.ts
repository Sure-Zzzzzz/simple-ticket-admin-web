import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ReportView from './ReportView.vue';
import * as api from '../api/ticketApi';
import type { TicketReport } from '../api/ticketApi';

vi.mock('../api/ticketApi', () => ({ getReport: vi.fn() }));

const identity = vi.hoisted(() => ({ epoch: 1 }));
vi.mock('../auth/pkce', () => ({ ticketIdentityEpoch: () => identity.epoch }));

function report(type: string): TicketReport {
  return {
    from: null, to: null,
    byStatus: [{ key: 'SUBMITTED', count: 1 }],
    byType: [{ key: type, count: 1 }],
    byGroup: [{ key: 'ops', count: 1 }],
    responseSlaRate: 1, resolutionSlaRate: 1, overdueRate: 0,
    averageResponseMinutes: 1, averageResolutionMinutes: 2,
    satisfaction: { averageStar: 5, evaluated: 1, resolved: 1, participationRate: 1 }
  };
}

describe('统计报表身份生命周期', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    identity.epoch = 1;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('身份切换后迟到的旧报表不会覆盖新页面', async () => {
    let resolveOld!: (value: TicketReport) => void;
    const oldReport = new Promise<TicketReport>(resolve => { resolveOld = resolve; });
    vi.mocked(api.getReport).mockReturnValueOnce(oldReport).mockResolvedValueOnce(report('新类型'));

    const first = mount(ReportView);
    first.unmount();
    identity.epoch = 2;
    wrapper = mount(ReportView);
    await flushPromises();
    expect(wrapper.text()).toContain('新类型');

    resolveOld(report('旧类型'));
    await flushPromises();
    expect(wrapper.text()).toContain('新类型');
    expect(wrapper.text()).not.toContain('旧类型');
  });
});
