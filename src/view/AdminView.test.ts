import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import AdminView from './AdminView.vue';
import * as api from '../api/ticketApi';

vi.mock('../api/ticketApi', () => ({
  deleteGroup: vi.fn(), listGroups: vi.fn(), listTypes: vi.fn(), saveGroup: vi.fn(), saveType: vi.fn()
}));

const identity = vi.hoisted(() => ({ epoch: 1 }));
vi.mock('../auth/pkce', () => ({ ticketIdentityEpoch: () => identity.epoch }));

const activeGroup = {
  id: 1, code: 'ops', name: '运维组', memberSubjectIds: ['person-1'],
  leaderSubjectId: 'person-1', enabled: true
};
const disabledGroup = { ...activeGroup, id: 2, code: 'retired', name: '旧组', enabled: false };

describe('处理组停用语义', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listTypes).mockResolvedValue([]);
    vi.mocked(api.listGroups).mockResolvedValue([activeGroup, disabledGroup]);
    vi.mocked(api.deleteGroup).mockResolvedValue();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function open(): Promise<VueWrapper> {
    wrapper = mount(AdminView);
    await flushPromises();
    return wrapper;
  }

  it('仅启用组展示停用入口，停用后保留在列表并显示停用状态', async () => {
    vi.mocked(api.listGroups)
      .mockResolvedValueOnce([activeGroup, disabledGroup])
      .mockResolvedValue([{ ...activeGroup, enabled: false }, disabledGroup]);
    const view = await open();
    const rows = view.findAll('tbody tr');
    expect(rows[0].text()).toContain('停用');
    expect(rows[0].findAll('button').map(button => button.text())).toContain('停用');
    expect(rows[1].findAll('button').map(button => button.text())).not.toContain('停用');

    await rows[0].findAll('button').find(button => button.text() === '停用')?.trigger('click');
    await flushPromises();
    expect(api.deleteGroup).toHaveBeenCalledWith('ops');
    const updated = view.findAll('tbody tr')[0];
    expect(updated.text()).toContain('运维组');
    expect(updated.findAll('button').map(button => button.text())).not.toContain('停用');
  });

  it('停用失败提示使用停用语义', async () => {
    vi.mocked(api.deleteGroup).mockRejectedValueOnce(null);
    const view = await open();
    await view.findAll('tbody tr')[0].findAll('button')
      .find(button => button.text() === '停用')?.trigger('click');
    await flushPromises();
    expect(view.find('[role="alert"]').text()).toContain('停用失败');
  });

  it('身份切换后迟到的旧治理数据不会覆盖新页面', async () => {
    let resolveOldTypes!: (value: never[]) => void;
    let resolveOldGroups!: (value: typeof activeGroup[]) => void;
    const oldTypes = new Promise<never[]>(resolve => { resolveOldTypes = resolve; });
    const oldGroups = new Promise<typeof activeGroup[]>(resolve => { resolveOldGroups = resolve; });
    const newGroup = { ...activeGroup, code: 'new-ops', name: '新运维组' };
    vi.mocked(api.listTypes).mockReset().mockReturnValueOnce(oldTypes).mockResolvedValueOnce([]);
    vi.mocked(api.listGroups).mockReset().mockReturnValueOnce(oldGroups).mockResolvedValueOnce([newGroup]);

    const first = mount(AdminView);
    first.unmount();
    identity.epoch = 2;
    wrapper = mount(AdminView);
    await flushPromises();
    expect(wrapper.text()).toContain('新运维组');

    resolveOldTypes([]);
    resolveOldGroups([activeGroup]);
    await flushPromises();
    expect(wrapper.text()).toContain('新运维组');
    expect(wrapper.text()).not.toContain('运维组\nops');
  });
});
