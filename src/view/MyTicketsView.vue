<template>
  <div class="page">
    <PageHeader title="我的工单" description="提交与跟踪你的工单，处理进展会通过站内信通知">
      <template #actions>
        <button
          type="button"
          class="button-primary"
          @click="() => void router.push('/tickets/new')"
        >
          提交工单
        </button>
      </template>
    </PageHeader>
    <section class="panel">
      <div class="ticket-filter-bar">
        <select
          v-model="statusFilter"
          class="ticket-filter-select"
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value="SUBMITTED">已提交</option>
          <option value="PROCESSING">处理中</option>
          <option value="PENDING_INFO">待补充</option>
          <option value="RESOLVED">已解决</option>
          <option value="CLOSED">已关闭</option>
          <option value="WITHDRAWN">已撤销</option>
        </select>
        <input
          v-model.trim="typeCode"
          type="search"
          aria-label="类型编码"
          placeholder="类型编码"
        >
        <input
          v-model="fromDate"
          type="date"
          aria-label="开始日期"
        >
        <input
          v-model="toDate"
          type="date"
          aria-label="结束日期"
        >
        <input
          v-model="queryText"
          type="search"
          aria-label="搜索工单"
          placeholder="单号或标题"
          @keyup.enter="applyQuery"
        >
        <button type="button" class="button-secondary" @click="applyQuery">查询</button>
        <button type="button" class="button-secondary" @click="resetFilters">重置</button>
        <span class="count">{{ totalText }}</span>
      </div>
      <div
        v-if="error"
        class="admin-message error"
        role="alert"
      >
        {{ error }}
        <button
          class="button-secondary"
          type="button"
          @click="() => void load(true)"
        >
          重试
        </button>
      </div>
      <p
        v-else-if="loading"
        class="loading-state"
      >
        加载中…
      </p>
      <p
        v-else-if="tickets.length === 0"
        class="loading-state"
      >
        暂无工单
      </p>
      <table
        v-else
        class="data-table"
      >
        <thead>
          <tr>
            <th>单号 / 标题</th>
            <th>状态</th>
            <th>优先级</th>
            <th>处理人</th>
            <th>最近活跃</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ticket in tickets"
            :key="ticket.ticketNo"
          >
            <td>
              <span class="identity-cell">
                <span class="identity-main">{{ ticket.subject }}</span>
                <span class="identity-code">{{ ticket.ticketNo }}</span>
              </span>
            </td>
            <td>
              <span
                class="status-chip"
                :class="`status-${ticket.status.toLowerCase()}`"
              >{{ statusText(ticket.status) }}</span>
            </td>
            <td>{{ priorityText(ticket.priority) }}</td>
            <td>{{ ticket.assigneeName || '—' }}</td>
            <td>{{ formatTime(ticket.lastActivityAt) }}</td>
            <td class="table-action-cell">
              <button
                type="button"
                class="table-action"
                @click="() => void router.push(`/tickets/${ticket.ticketNo}`)"
              >
                详情
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="hasMore"
        class="load-more-row"
      >
        <button
          type="button"
          class="button-secondary"
          :disabled="loading || loadingMore"
          @click="loadMore"
        >
          加载更多
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import { listMyTickets, type TicketSummary } from '../api/ticketApi';
import { ticketIdentityEpoch } from '../auth/pkce';

const router = useRouter();
const tickets = ref<TicketSummary[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
const statusFilter = ref('');
const typeCode = ref('');
const fromDate = ref('');
const toDate = ref('');
const queryText = ref('');
const appliedQuery = ref('');
const page = ref(1);
const size = 20;
const hasMore = ref(false);
let requestSequence = 0;
let disposed = false;
let skipNextFilterReload = false;

const totalText = computed(() => `已加载 ${tickets.value.length} 条`);

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: '已提交',
  PROCESSING: '处理中',
  PENDING_INFO: '待补充',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
  WITHDRAWN: '已撤销'
};

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status;
}

const PRIORITY_TEXT: Record<string, string> = {
  LOW: '低',
  NORMAL: '普通',
  HIGH: '高',
  URGENT: '紧急'
};

function priorityText(priority: string): string {
  return PRIORITY_TEXT[priority] ?? priority;
}

function formatTime(iso: string): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

async function load(reset: boolean): Promise<void> {
  const sequence = ++requestSequence;
  const identity = ticketIdentityEpoch();
  loading.value = reset;
  loadingMore.value = !reset;
  error.value = '';
  try {
    const target = reset ? 1 : page.value + 1;
    const result = await listMyTickets(target, size, {
      status: statusFilter.value ? [statusFilter.value] : undefined,
      typeCode: typeCode.value || undefined,
      from: fromDate.value || undefined,
      to: toDate.value || undefined,
      q: appliedQuery.value || undefined
    });
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    tickets.value = reset ? result.content : tickets.value.concat(result.content);
    page.value = result.page;
    hasMore.value = result.content.length >= result.size;
  } catch (e) {
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    error.value = e instanceof Error ? e.message : '加载失败';
    if (reset) tickets.value = [];
  } finally {
    if (!disposed && sequence === requestSequence && identity === ticketIdentityEpoch()) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function loadMore(): void {
  void load(false);
}

function applyQuery(): void {
  appliedQuery.value = queryText.value.trim();
  void load(true);
}

function resetFilters(): void {
  skipNextFilterReload = Boolean(statusFilter.value || typeCode.value || fromDate.value || toDate.value);
  statusFilter.value = '';
  typeCode.value = '';
  fromDate.value = '';
  toDate.value = '';
  queryText.value = '';
  appliedQuery.value = '';
  void load(true);
}

onMounted(() => void load(true));
watch([statusFilter, typeCode, fromDate, toDate], () => {
  if (skipNextFilterReload) {
    skipNextFilterReload = false;
    return;
  }
  void load(true);
});
onBeforeUnmount(() => { disposed = true; requestSequence++; });
</script>
