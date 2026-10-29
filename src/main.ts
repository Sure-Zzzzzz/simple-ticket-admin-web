import { createApp, watch, type App as VueApp } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import {
  applyTheme,
  createLightThemePreference,
  type ThemeSnapshot
} from '@sure-zzzzzz/simple-iam-theme-contract';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import App from './App.vue';
import { beginTicketAuthorization, clearTicketToken, configureTicketIdentitySource, synchronizeTicketIdentity, ticketAccessToken, ticketIdentityEpoch } from './auth/pkce';
import { configureTicketApi, configureTicketIdentityEpochSource, configureTicketTokenRevoker, configureTicketTokenSource, setTicketUnauthorizedHandler } from './api/ticketApi';
import MyTicketsView from './view/MyTicketsView.vue';
import TicketDetailView from './view/TicketDetailView.vue';
import TicketCreateView from './view/TicketCreateView.vue';
import HandleQueueView from './view/HandleQueueView.vue';
import AdminView from './view/AdminView.vue';
import ReportView from './view/ReportView.vue';
import OAuthCallbackView from './view/OAuthCallbackView.vue';
import './style.css';

let app: VueApp<Element> | null = null;
let router: Router | null = null;
let root: HTMLElement | null = null;
let releaseTheme = () => undefined as void;
let releaseIdentity = () => undefined as void;
let currentUserSource: MountProps['getCurrentUser'];

interface MountProps {
  container?: Element | Document;
  routePrefix?: string;
  apiBase?: string;
  getCurrentUser?: () => { subjectId: string | null } | null;
  theme?: { current(): ThemeSnapshot; subscribe(listener: (snapshot: ThemeSnapshot) => void): () => void };
}

const TICKET_ROUTE_PREFIX = '/app/ticket';

function resolveTicketRoutePrefix(routePrefix?: string): string {
  const normalized = (routePrefix || TICKET_ROUTE_PREFIX).replace(/\/+$/, '');
  if (normalized !== TICKET_ROUTE_PREFIX) {
    throw new Error(`工单应用只支持固定路由前缀 ${TICKET_ROUTE_PREFIX}`);
  }
  return normalized;
}

function createTicketRouter(base: string) {
  const instance = createRouter({
    history: createWebHistory(base),
    routes: [
      { path: '/', component: MyTicketsView },
      { path: '/tickets/new', component: TicketCreateView },
      { path: '/tickets/:ticketNo', component: TicketDetailView },
      { path: '/handle', component: HandleQueueView },
      { path: '/handle/all', component: HandleQueueView, props: { scope: 'all' } },
      { path: '/admin', component: AdminView },
      { path: '/report', component: ReportView },
      { path: '/oauth-callback', component: OAuthCallbackView },
      { path: '/:pathMatch(.*)*', redirect: '/' }
    ]
  });
  instance.beforeEach(to => {
    if (to.path === '/oauth-callback') {
      return true;
    }
    if (!ticketAccessToken()) {
      beginTicketAuthorization(to.fullPath);
      return false;
    }
    return true;
  });
  return instance;
}

function applyTicketTheme(props: MountProps): void {
  releaseTheme();
  releaseTheme = () => undefined as void;
  if (root) {
    applyTheme(root, props.theme?.current() ?? createLightThemePreference());
    if (props.theme) {
      releaseTheme = props.theme.subscribe(snapshot => {
        if (root) {
          applyTheme(root, snapshot);
        }
      });
    }
  }
}

function bindTicketIdentity(props: MountProps): void {
  releaseIdentity();
  currentUserSource = props.getCurrentUser;
  configureTicketIdentitySource(props.getCurrentUser
    ? () => props.getCurrentUser?.()?.subjectId ?? null : null);
  releaseIdentity = watch(() => props.getCurrentUser?.()?.subjectId, () => {
    synchronizeTicketIdentity();
  }, { flush: 'sync' });
}

function render(props: MountProps = {}) {
  bindTicketIdentity(props);
  const routePrefix = resolveTicketRoutePrefix(props.routePrefix);
  router = createTicketRouter(`${routePrefix}/`);
  configureTicketApi(props.apiBase ?? '/api/ticket');
  configureTicketTokenSource(ticketAccessToken);
  configureTicketTokenRevoker(clearTicketToken);
  configureTicketIdentityEpochSource(ticketIdentityEpoch);
  setTicketUnauthorizedHandler(() => {
    if (router) {
      beginTicketAuthorization(router.currentRoute.value.fullPath);
    }
  });
  app = createApp(App);
  app.use(router);
  const container = props.container?.querySelector('#app') || document.querySelector('#app');
  if (container instanceof HTMLElement) {
    app.mount(container);
    root = container;
    applyTicketTheme(props);
  }
}

renderWithQiankun({
  bootstrap() {},
  mount(props) {
    render(props as MountProps);
  },
  update(props) {
    const next = props as MountProps;
    resolveTicketRoutePrefix(next.routePrefix);
    applyTicketTheme(next);
    if (next.getCurrentUser !== currentUserSource) {
      bindTicketIdentity(next);
    }
    synchronizeTicketIdentity();
  },
  unmount() {
    releaseIdentity();
    releaseIdentity = () => undefined as void;
    currentUserSource = undefined;
    clearTicketToken();
    configureTicketIdentitySource(null);
    releaseTheme();
    releaseTheme = () => undefined as void;
    if (app) {
      app.unmount();
      app = null;
    }
    if (root) {
      root.innerHTML = '';
      root = null;
    }
    setTicketUnauthorizedHandler(null);
    configureTicketIdentityEpochSource(null);
    router = null;
  }
});

// 独立打开（非 qiankun）：直连 runtime 走查形态
if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render({});
}
