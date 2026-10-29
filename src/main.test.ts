import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { ticketAccessToken, ticketCurrentSubjectId } from './auth/pkce';

const lifecycle = vi.hoisted(() => ({
  hooks: null as null | {
    mount(props: unknown): void;
    update(props: unknown): void;
    unmount(): void;
  }
}));

vi.mock('vite-plugin-qiankun/dist/helper', () => ({
  qiankunWindow: { __POWERED_BY_QIANKUN__: true },
  renderWithQiankun: (hooks: typeof lifecycle.hooks) => { lifecycle.hooks = hooks; }
}));

import './main';

describe('门户人员身份挂载', () => {
  afterEach(() => {
    lifecycle.hooks?.unmount();
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  it.each([
    ['/handle/all', '/api/ticket/manage/all-tickets', { content: [], page: 1, size: 20 }],
    ['/report', '/api/ticket/manage/report', { byStatus: [], satisfaction: { avgStar: 0, evaluated: 0, resolved: 0 } }]
  ])('%s进入独立的服务端契约', async (path, expectedApi, payload) => {
    window.history.replaceState({}, '', `/app/ticket${path}`);
    document.body.innerHTML = '<div id="app"></div>';
    window.sessionStorage.setItem('ticket.accessToken', 'person-token');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3_600_000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'person-A');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    lifecycle.hooks?.mount({
      container: document,
      routePrefix: '/app/ticket',
      getCurrentUser: () => ({ subjectId: 'person-A' })
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://portal.example.test');
    expect(url.pathname).toBe(expectedApi);
  });

  it('挂载时绑定主体，换人立即撤销旧工单令牌，卸载时解绑', async () => {
    window.history.replaceState({}, '', '/app/ticket/oauth-callback');
    document.body.innerHTML = '<div id="app"></div>';
    window.sessionStorage.setItem('ticket.accessToken', 'old-token');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3_600_000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'person-A');
    const host = reactive({ currentUser: { subjectId: 'person-A' } });
    lifecycle.hooks?.mount({
      container: document,
      routePrefix: '/app/ticket',
      getCurrentUser: () => host.currentUser
    });
    await flushPromises();
    expect(ticketCurrentSubjectId()).toBe('person-A');
    expect(ticketAccessToken()).toBe('old-token');

    host.currentUser = { subjectId: 'person-B' };
    await nextTick();
    expect(ticketCurrentSubjectId()).toBe('person-B');
    expect(ticketAccessToken()).toBeNull();
    expect(window.sessionStorage.getItem('ticket.accessToken')).toBeNull();

    lifecycle.hooks?.unmount();
    expect(ticketCurrentSubjectId()).toBeNull();
  });

  it('卸载时清理顶层会话中的工单令牌', async () => {
    window.history.replaceState({}, '', '/app/ticket/oauth-callback');
    document.body.innerHTML = '<div id="app"></div>';
    window.sessionStorage.setItem('ticket.accessToken', 'stale-token');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3_600_000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'person-A');
    lifecycle.hooks?.mount({ container: document, routePrefix: '/app/ticket' });
    await flushPromises();

    lifecycle.hooks?.unmount();

    expect(window.sessionStorage.getItem('ticket.accessToken')).toBeNull();
    expect(window.sessionStorage.getItem('ticket.tokenExpiresAt')).toBeNull();
    expect(window.sessionStorage.getItem('ticket.tokenSubject')).toBeNull();
  });
});
