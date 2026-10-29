<template>
  <div
    ref="ticketRoot"
    class="ticket-admin-app"
    :class="{ 'ticket-admin-app--standalone': standalone }"
  >
    <!-- 门户 qiankun 形态：应用菜单由门户侧栏承载，子应用只渲染内容区，不自带导航；
         直开（standalone）形态仅显示标题栏（IAM 管理台同构） -->
    <header
      v-if="standalone"
      class="ticket-standalone-header"
    >
      <h1>工单中心</h1>
    </header>
    <RouterView :key="$route.path === '/oauth-callback' ? 'callback' : ticketIdentityVersion" />
  </div>
</template>

<script setup lang="ts">
import { qiankunWindow } from 'vite-plugin-qiankun/dist/helper';
import { ref } from 'vue';
import { ticketIdentityVersion } from './auth/pkce';

const standalone = !qiankunWindow.__POWERED_BY_QIANKUN__;
const ticketRoot = ref<InstanceType<typeof window.HTMLElement> | null>(null);
</script>
