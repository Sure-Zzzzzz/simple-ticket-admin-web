<template>
  <main class="page">
    <PageHeader
      title="授权回调"
      description="正在完成登录令牌交换。"
    />
    <div
      v-if="status === 'processing'"
      class="loading-state"
      role="status"
    >
      正在换取令牌…
    </div>
    <div
      v-else-if="status === 'ok'"
      class="admin-message success"
      role="status"
    >
      授权成功，正在返回工单中心…
    </div>
    <div
      v-else-if="status === 'missing'"
      class="admin-message error"
      role="alert"
    >
      授权信息不完整，请重新授权
    </div>
    <div
      v-else-if="status === 'mismatch'"
      class="admin-message error"
      role="alert"
    >
      本次授权已失效，请重新授权
    </div>
    <div
      v-else
      class="admin-message error"
      role="alert"
    >
      {{ failure }}
    </div>
    <button
      v-if="status === 'failed' || status === 'missing' || status === 'mismatch'"
      type="button"
      class="button-primary"
      @click="retryAuthorization"
    >
      重新授权
    </button>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import { beginTicketAuthorization, handleTicketCallback } from '../auth/pkce';

const router = useRouter();
const status = ref<'processing' | 'ok' | 'missing' | 'mismatch' | 'failed'>('processing');
const target = ref('/');
const failure = ref('');
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());

onMounted(async () => {
  try {
    const outcome = await handleTicketCallback(window.location.search, undefined, controller.signal);
    if (controller.signal.aborted) return;
    if (outcome.kind === 'cancelled') {
      status.value = 'failed';
      failure.value = '当前登录身份已变化，请重新授权';
      return;
    }
    if (outcome.kind === 'authorized') {
      status.value = 'ok';
      target.value = outcome.target;
      await router.replace(outcome.target);
    } else if (outcome.kind === 'missing-params') {
      status.value = 'missing';
    } else {
      status.value = 'mismatch';
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    status.value = 'failed';
    failure.value = e instanceof Error ? e.message : '回调处理失败';
  }
});

function retryAuthorization(): void {
  try {
    beginTicketAuthorization(target.value);
  } catch (error) {
    status.value = 'failed';
    failure.value = error instanceof Error ? error.message : '无法发起授权';
  }
}
</script>
