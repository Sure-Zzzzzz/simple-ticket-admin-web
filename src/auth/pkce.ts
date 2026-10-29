import { ref } from 'vue';

// PKCE（代码交换证明密钥）浏览器授权：纯 JS SHA-256 实现（无 crypto.subtle 依赖，http 明文可跑）。
// verifier/state 存 window.top.sessionStorage（qiankun 子应用跨挂载保持同一存储）。

const PKCE_STATE_PREFIX = 'ticket.pkce.';
const ACCESS_TOKEN_KEY = 'ticket.accessToken';
const TOKEN_SUBJECT_KEY = 'ticket.tokenSubject';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const PKCE_SCOPE = 'openid profile';

/** 身份生命周期版本：即使令牌 A→B→A，旧请求也不能重新获得归属。 */
export const ticketIdentityVersion = ref(0);
let identitySource: (() => string | null) | null = null;
let observedToken: string | null | undefined;
let observedSubject: string | null | undefined;
let authorizationFlowVersion = 0;

/** 门户只提供人员主体标识，不把门户凭据带入工单。 */
export function configureTicketIdentitySource(source: (() => string | null) | null): void {
  identitySource = source;
  // 挂载和卸载是不同的请求生命周期，即使人员和令牌相同也使旧请求失效。
  ticketIdentityVersion.value++;
  synchronizeTicketIdentity();
}

/** 当前门户人员标识，仅用于页面动作展示；服务端仍执行授权。 */
export function ticketCurrentSubjectId(): string | null {
  return identitySource?.() ?? null;
}

/** 宿主主体变化时撤销旧工单令牌，再由原 PKCE 流程获取本应用令牌。 */
export function synchronizeTicketIdentity(): void {
  if (!identitySource) return;
  const subject = identitySource();
  const subjectChanged = observedSubject !== undefined && observedSubject !== subject;
  // 撤销令牌会同步通知身份监听器；先提交主体，重入读取不能再次处理同一变更。
  observedSubject = subject;
  // 无令牌的授权交换也属于人员身份，不能让 A→B→A 的旧回调重新生效。
  if (subjectChanged) {
    clearTicketToken();
  } else if (readSession(ACCESS_TOKEN_KEY) && readSession(TOKEN_SUBJECT_KEY) !== subject) {
    clearTicketToken();
  }
}

/** 请求捕获此版本，响应和错误均只归相同的身份生命周期。 */
export function ticketIdentityEpoch(): number {
  ticketAccessToken();
  return ticketIdentityVersion.value;
}

function observeToken(token: string | null): void {
  if (observedToken !== token) {
    observedToken = token;
    ticketIdentityVersion.value++;
  }
}

export class TicketPkceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketPkceError';
  }
}

/** 授权端点与客户端参数（部署时经 env 覆盖）。 */
export const TICKET_AUTH_DEFAULTS = {
  /** 空串=同源身份网关：/oauth2/authorize 与 /oauth2/token 走相对路径（接入手册形态）。 */
  issuer: '',
  /** 不进仓铁律：客户端标识由构建期 env（VITE_TICKET_PKCE_CLIENT_ID，键名见 .env.example）或显式配置注入。 */
  clientId: '',
  redirectPath: '/app/ticket/oauth-callback'
};

function stripStatePrefix(state: string): string {
  const marker = PKCE_STATE_PREFIX;
  const index = state.indexOf(marker);
  if (index < 0) {
    return '/';
  }
  const rest = state.slice(index + marker.length);
  // rest 形如 {时间戳}.{路由}：去掉时间戳段（首个'.'之前）
  const dot = rest.indexOf('.');
  const target = dot >= 0 ? rest.slice(dot + 1) : '/';
  return target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
    && !Array.from(target).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !target.startsWith('/oauth-callback') ? target : '/';
}

function resolveTopSession(): Storage | null {
  // qiankun 为每次挂载创建 Window Proxy；回调与目标页必须共用顶层真实 sessionStorage
  try {
    return window.top?.sessionStorage ?? window.sessionStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

function readSession(key: string): string | null {
  try {
    return resolveTopSession()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    resolveTopSession()?.setItem(key, value);
  } catch {
    // 隐私模式存储不可用：跳过持久化
  }
}

function removeSession(key: string): void {
  try {
    resolveTopSession()?.removeItem(key);
  } catch {
    // 忽略
  }
}

/** SHA-256 原始摘要（同步、http 可用；代替 SubtleCrypto 的异步与 https 限制）。 */
function sha256Bytes(input: string): Uint8Array {
  const bytes = new TextEncoder().encode(input);
  return jsSha256Digest(bytes);
}

/** PKCE S256 challenge = BASE64URL(SHA-256(verifier))（RFC 7636 §4.2）。 */
function pkceChallenge(verifier: string): string {
  const digest = sha256Bytes(verifier);
  let binary = '';
  for (const byte of digest) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 内嵌 SHA-256（公开域参考实现，紧凑版）
function jsSha256Digest(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = data.length;
  const bitLen = l * 8;
  const withOne = l + 1;
  const total = (((withOne + 8) >>> 6) + 1) << 6;
  const m = new Uint8Array(total);
  m.set(data);
  m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, bitLen >>> 0, false);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    out.setUint32(i * 4, H[i], false);
  }
  return digest;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function randomUrlSafe(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    throw new TicketPkceError('浏览器无法生成安全的授权请求');
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface TicketPkceConfig {
  issuer?: string;
  clientId?: string;
}

function resolveConfig(config?: TicketPkceConfig): { issuer: string; clientId: string } {
  return {
    issuer: config?.issuer
      ?? (import.meta.env.VITE_TICKET_PKCE_ISSUER as string | undefined)
      ?? TICKET_AUTH_DEFAULTS.issuer,
    clientId: config?.clientId
      ?? (import.meta.env.VITE_TICKET_PKCE_CLIENT_ID as string | undefined)
      ?? TICKET_AUTH_DEFAULTS.clientId
  };
}

/** 发起 PKCE 授权跳转：随机 state 携带应用内目标路由，verifier 存会话存储。 */
export function beginTicketAuthorization(target: string, config?: TicketPkceConfig): void {
  const { issuer, clientId } = resolveConfig(config);
  if (!clientId) {
    // 不进仓铁律下的显式失败：缺注入宁可报错，不静默回落仓内标识
    throw new Error('工单客户端标识未注入：构建期须设置 VITE_TICKET_PKCE_CLIENT_ID（见 .env.example）');
  }
  const verifier = randomUrlSafe(48);
  synchronizeTicketIdentity();
  // 同主体也可能开始另一轮授权，旧换码结果不得覆盖新请求或跳回旧页面。
  authorizationFlowVersion++;
  const state = `${PKCE_STATE_PREFIX}${randomUrlSafe(24)}.${target}`;
  writeSession('ticket.pkce.verifier', verifier);
  writeSession('ticket.pkce.state', state);
  if (identitySource) writeSession('ticket.pkce.subject', identitySource() ?? '');
  const challenge = pkceChallenge(verifier);
  const redirectUri = `${window.location.origin}${TICKET_AUTH_DEFAULTS.redirectPath}`;
  const url = `${issuer}/oauth2/authorize?response_type=code`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&scope=${encodeURIComponent(PKCE_SCOPE)}`
    + `&state=${encodeURIComponent(state)}`
    + `&code_challenge=${encodeURIComponent(challenge)}`
    + `&code_challenge_method=S256`;
  window.location.assign(url);
}

export type TicketCallbackOutcome =
  | { kind: 'authorized'; target: string }
  | { kind: 'cancelled' }
  | { kind: 'missing-params' }
  | { kind: 'state-mismatch' };

/** 处理回调：code+state 换令牌（存会话），返回目标路由。 */
export async function handleTicketCallback(
  search: string,
  config?: TicketPkceConfig,
  signal?: AbortSignal
): Promise<TicketCallbackOutcome> {
  const epoch = ticketIdentityEpoch();
  const flowVersion = authorizationFlowVersion;
  const current = () => !signal?.aborted && epoch === ticketIdentityEpoch()
    && flowVersion === authorizationFlowVersion;
  if (!current()) return { kind: 'cancelled' };
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    return { kind: 'missing-params' };
  }
  const expectedState = readSession('ticket.pkce.state');
  if (!expectedState || expectedState !== state) {
    return { kind: 'state-mismatch' };
  }
  const verifier = readSession('ticket.pkce.verifier') ?? '';
  if (!verifier || (identitySource && readSession('ticket.pkce.subject') !== identitySource())) {
    return { kind: 'state-mismatch' };
  }
  // 消费一次，阻止重复挂载或重复回调并发交换同一个授权码。
  removeSession('ticket.pkce.verifier');
  removeSession('ticket.pkce.state');
  removeSession('ticket.pkce.subject');
  const { issuer, clientId } = resolveConfig(config);
  const redirectUri = `${window.location.origin}${TICKET_AUTH_DEFAULTS.redirectPath}`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  });
  let response: Response;
  try {
    response = await fetch(`${issuer}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal
    });
  } catch (error) {
    if (!current()) return { kind: 'cancelled' };
    throw error;
  }
  if (!current()) return { kind: 'cancelled' };
  if (!response.ok) {
    throw new TicketPkceError(`令牌交换失败: ${response.status}`);
  }
  let payload: { access_token?: string; expires_in?: number } | null;
  try {
    payload = await response.json();
  } catch (error) {
    if (!current()) return { kind: 'cancelled' };
    throw error;
  }
  if (!current()) return { kind: 'cancelled' };
  if (!payload || typeof payload !== 'object') throw new TicketPkceError('令牌响应格式无效');
  const lifetime = payload.expires_in === undefined ? 3600 : payload.expires_in;
  if (typeof payload.access_token !== 'string' || !payload.access_token.trim()
    || typeof lifetime !== 'number' || !Number.isFinite(lifetime) || lifetime <= 0
    || !Number.isFinite(Date.now() + lifetime * 1000)) {
    throw new TicketPkceError('令牌响应格式无效');
  }
  writeSession(ACCESS_TOKEN_KEY, payload.access_token);
  const expiresIn = lifetime * 1000;
  writeSession('ticket.tokenExpiresAt', String(Date.now() + expiresIn - Math.min(TOKEN_EXPIRY_SKEW_MS, expiresIn / 2)));
  if (identitySource) writeSession(TOKEN_SUBJECT_KEY, identitySource() ?? '');
  if (readSession(ACCESS_TOKEN_KEY) !== payload.access_token) {
    clearTicketToken();
    throw new TicketPkceError('浏览器会话存储不可用，请允许后重新授权');
  }
  observeToken(payload.access_token);
  // state 形如 ticket.pkce.{随机值}.{目标路由}，仅允许工单子应用内部路由。
  const target = stripStatePrefix(state);
  return { kind: 'authorized', target: target || '/' };
}

/** 读有效令牌（过期返回 null）。 */
export function ticketAccessToken(): string | null {
  synchronizeTicketIdentity();
  const token = readSession(ACCESS_TOKEN_KEY);
  const expiresAt = Number(readSession('ticket.tokenExpiresAt') ?? '0');
  if (!token?.trim() || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    if (token) clearTicketToken();
    observeToken(null);
    return null;
  }
  observeToken(token);
  return token;
}

/** 清除本地令牌。 */
export function clearTicketToken(): void {
  removeSession(ACCESS_TOKEN_KEY);
  removeSession('ticket.tokenExpiresAt');
  removeSession(TOKEN_SUBJECT_KEY);
  observedToken = null;
  ticketIdentityVersion.value++;
}

/** challenge 供测试直接核验（RFC 7636 向量）。 */
export function ticketChallengeOf(verifier: string): string {
  return pkceChallenge(verifier);
}
