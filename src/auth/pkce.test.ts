import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '../App.vue';
import MyTicketsView from '../view/MyTicketsView.vue';
import { configureTicketApi, setTicketUnauthorizedHandler } from '../api/ticketApi';
import {
  beginTicketAuthorization,
  clearTicketToken,
  ticketAccessToken,
  ticketChallengeOf,
  configureTicketIdentitySource,
  ticketIdentityEpoch,
  ticketIdentityVersion,
  synchronizeTicketIdentity,
  handleTicketCallback,
  TICKET_AUTH_DEFAULTS
} from './pkce';

vi.mock('vite-plugin-qiankun/dist/helper', () => ({ qiankunWindow: { __POWERED_BY_QIANKUN__: true } }));

function resetSession(): void {
  window.sessionStorage.clear();
}

describe('工单 PKCE', () => {
  beforeEach(() => {
    configureTicketIdentitySource(null);
    resetSession();
    clearTicketToken();
    setTicketUnauthorizedHandler(null);
    vi.stubEnv('VITE_TICKET_PKCE_CLIENT_ID', 'test-client');
  });
  afterEach(() => {
    configureTicketIdentitySource(null);
    setTicketUnauthorizedHandler(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function prepareCallback(target = '/orders'): string {
    const state = `ticket.pkce.test.${target}`;
    window.sessionStorage.setItem('ticket.pkce.verifier', 'test-verifier');
    window.sessionStorage.setItem('ticket.pkce.state', state);
    return '?code=abc&state=' + encodeURIComponent(state);
  }

  it('challenge 是 verifier 的 SHA-256 base64url（标准向量）', () => {
    // RFC 7636 附录 B 向量：verifier dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    expect(ticketChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('begin 写 verifier/state 并跳转授权端点（S256）', () => {
    resetSession();
    clearTicketToken();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://127.0.0.1:5178' });
    beginTicketAuthorization('/customers');
    expect(assign).toHaveBeenCalledTimes(1);
    const url = String(assign.mock.calls[0][0]);
    expect(url).toContain(`${TICKET_AUTH_DEFAULTS.issuer}/oauth2/authorize`);
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('code_challenge=');
    expect(url).toContain(encodeURIComponent('http://127.0.0.1:5178/app/ticket/oauth-callback'));
    expect(window.sessionStorage.getItem('ticket.pkce.verifier')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('callback 换令牌成功后清除 verifier 并返回目标路由', async () => {
    resetSession();
    window.sessionStorage.setItem('ticket.pkce.verifier', 'test-verifier');
    window.sessionStorage.setItem('ticket.pkce.state', 'ticket.pkce.1./orders');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'token-1', expires_in: 3600 })
    });
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await handleTicketCallback('?code=abc&state=' + encodeURIComponent('ticket.pkce.1./orders'));
    expect(outcome.kind === 'authorized' && outcome.target).toBe('/orders');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/oauth2/token');
    expect(String(init.body)).toContain('code_verifier=test-verifier');
    expect(ticketAccessToken()).toBe('token-1');
    expect(window.sessionStorage.getItem('ticket.pkce.verifier')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('state 不匹配拒绝', async () => {
    resetSession();
    window.sessionStorage.setItem('ticket.pkce.verifier', 'v');
    window.sessionStorage.setItem('ticket.pkce.state', 'expected');
    const outcome = await handleTicketCallback('?code=abc&state=other');
    expect(outcome.kind).toBe('state-mismatch');
  });

  it('有效令牌必须有有限且未来的到期时间', () => {
    for (const expiresAt of [null, '0', 'NaN', 'Infinity', String(Date.now() - 1)]) {
      window.sessionStorage.setItem('ticket.accessToken', 'token');
      if (expiresAt === null) window.sessionStorage.removeItem('ticket.tokenExpiresAt');
      else window.sessionStorage.setItem('ticket.tokenExpiresAt', expiresAt);
      expect(ticketAccessToken()).toBeNull();
      expect(window.sessionStorage.getItem('ticket.accessToken')).toBeNull();
    }
  });

  it('身份A→B→A即使恢复原令牌也使用新的请求版本', () => {
    let subject = 'A';
    configureTicketIdentitySource(() => subject);
    window.sessionStorage.setItem('ticket.accessToken', 'token-A');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'A');
    const first = ticketIdentityEpoch();
    subject = 'B';
    synchronizeTicketIdentity();
    expect(ticketAccessToken()).toBeNull();
    subject = 'A';
    synchronizeTicketIdentity();
    window.sessionStorage.setItem('ticket.accessToken', 'token-A');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'A');
    expect(ticketAccessToken()).toBe('token-A');
    expect(ticketIdentityEpoch()).toBeGreaterThan(first);
  });

  it('切换主体时同步监听器读取真实令牌不能递归撤销同一身份', () => {
    let subject = 'A';
    configureTicketIdentitySource(() => subject);
    window.sessionStorage.setItem('ticket.accessToken', 'token-A');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'A');
    expect(ticketAccessToken()).toBe('token-A');
    const readToken = vi.fn(() => ticketAccessToken());
    const stop = watch(ticketIdentityVersion, readToken, { flush: 'sync' });
    try {
      subject = 'B';
      synchronizeTicketIdentity();
      expect(readToken).toHaveBeenCalledTimes(1);
      expect(readToken.mock.results[0].value).toBeNull();
      expect(ticketAccessToken()).toBeNull();
      expect(readToken).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('真实交付页401重挂后停止无令牌请求并结束加载，不重复覆盖授权请求', async () => {
    configureTicketIdentitySource(() => 'A');
    window.sessionStorage.setItem('ticket.accessToken', 'token-A');
    window.sessionStorage.setItem('ticket.tokenExpiresAt', String(Date.now() + 3600000));
    window.sessionStorage.setItem('ticket.tokenSubject', 'A');
    expect(ticketAccessToken()).toBe('token-A');
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 })))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // 旧实现会继续重挂并发出空凭据请求；限定响应次数，避免回归测试本身无限循环。
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetch);
    configureTicketApi('/api/ticket');
    const { configureTicketTokenSource, configureTicketTokenRevoker } = await import('../api/ticketApi');
    configureTicketTokenSource(ticketAccessToken);
    configureTicketTokenRevoker(clearTicketToken);
    const unauthorized = vi.fn();
    setTicketUnauthorizedHandler(unauthorized);
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/my-tickets', component: MyTicketsView }
    ] });
    const guard = vi.fn(() => true);
    router.beforeEach(guard);
    await router.push('/my-tickets');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [router] } });
    try {
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(1);
      const { listMyTickets } = await import('../api/ticketApi');
      await listMyTickets(1, 20, ['pending_info']).catch(() => undefined);
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(new URL(fetch.mock.calls[1][0], 'https://portal.example.test').pathname)
        .toBe('/api/ticket/portal/my-tickets');
      expect(new URL(fetch.mock.calls[1][0], 'https://portal.example.test').searchParams.get('status'))
        .toBe('pending_info');
      expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer token-A');
      expect(ticketAccessToken()).toBeNull();
      expect(unauthorized).toHaveBeenCalledTimes(1);
      // 版本key重挂不会重新进入路由守卫；安全边界必须在业务请求层执行。
      expect(guard).toHaveBeenCalledTimes(1);
      expect(wrapper.get('[role="alert"]').text()).toContain('登录已过期');
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('同一授权请求只允许一次令牌交换', async () => {
    const search = prepareCallback();
    let resolveResponse!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise(resolve => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = handleTicketCallback(search);
    expect(await handleTicketCallback(search)).toEqual({ kind: 'state-mismatch' });
    resolveResponse({ ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 }) });
    expect(await first).toEqual({ kind: 'authorized', target: '/orders' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['response', 'payload'])('同主体新授权使等待%s的旧换码失效，保留新请求', async stage => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    let finish!: (value: unknown) => void;
    const deferred = new Promise(resolve => { finish = resolve; });
    const json = vi.fn(() => stage === 'payload' ? deferred : Promise.resolve({ access_token: 'old-token' }));
    const response = { ok: true, json };
    vi.stubGlobal('fetch', vi.fn(() => stage === 'response' ? deferred : Promise.resolve(response)));
    const pending = handleTicketCallback(prepareCallback());
    if (stage === 'payload') await vi.waitFor(() => expect(json).toHaveBeenCalled());
    beginTicketAuthorization('/fulfillment');
    const newState = window.sessionStorage.getItem('ticket.pkce.state');
    const newVerifier = window.sessionStorage.getItem('ticket.pkce.verifier');
    finish(stage === 'response' ? response : { access_token: 'old-token', expires_in: 3600 });
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(ticketAccessToken()).toBeNull();
    expect(window.sessionStorage.getItem('ticket.pkce.state')).toBe(newState);
    expect(window.sessionStorage.getItem('ticket.pkce.verifier')).toBe(newVerifier);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('缺失verifier不交换令牌', async () => {
    const search = prepareCallback();
    window.sessionStorage.removeItem('ticket.pkce.verifier');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await handleTicketCallback(search)).toEqual({ kind: 'state-mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('回调卸载后迟到的令牌解析不会写入会话', async () => {
    const search = prepareCallback();
    let resolvePayload!: (value: unknown) => void;
    const json = vi.fn(() => new Promise(resolve => { resolvePayload = resolve; }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));
    const controller = new AbortController();
    const pending = handleTicketCallback(search, undefined, controller.signal);
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    controller.abort();
    resolvePayload({ access_token: 'late-token', expires_in: 3600 });
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(ticketAccessToken()).toBeNull();
  });

  it('没有旧令牌时也拒绝A→B→A的迟到回调', async () => {
    let subject = 'A';
    configureTicketIdentitySource(() => subject);
    const search = prepareCallback();
    window.sessionStorage.setItem('ticket.pkce.subject', 'A');
    let resolveResponse!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveResponse = resolve; })));
    const pending = handleTicketCallback(search);
    subject = 'B';
    synchronizeTicketIdentity();
    subject = 'A';
    synchronizeTicketIdentity();
    resolveResponse({ ok: true, json: async () => ({ access_token: 'late-token', expires_in: 3600 }) });
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(ticketAccessToken()).toBeNull();
  });

  it.each([null, {}, { access_token: '' }, { access_token: 'x', expires_in: 0 },
    { access_token: 'x', expires_in: '3600' }, { access_token: 'x', expires_in: Infinity }])(
    '无效令牌响应不污染会话：%j', async payload => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
      await expect(handleTicketCallback(prepareCallback())).rejects.toThrow('令牌响应格式无效');
      expect(ticketAccessToken()).toBeNull();
    });

  it.each(['//outside.example', '/\\outside.example', '/oauth-callback?code=x'])('授权目标只允许应用内页面：%s', async target => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 })
    }));
    expect(await handleTicketCallback(prepareCallback(target))).toEqual({ kind: 'authorized', target: '/' });
  });
});
