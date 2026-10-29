<template>
  <div class="page">
    <PageHeader
      :title="scope === 'all' ? '全部工单' : '处理台'"
      :description="scope === 'all' ? '查看全部工单的处理进度' : '你所在处理组的工单队列，按优先级与提交顺序排列'"
    />
    <section class="panel">
      <div class="ticket-filter-bar">
        <select
          v-model="statusFilter"
          class="ticket-filter-select"
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value="SUBMITTED">待受理</option>
          <option value="PROCESSING">处理中</option>
          <option value="PENDING_INFO">待补充</option>
          <option value="RESOLVED">已解决</option>
          <option v-if="scope === 'all'" value="CLOSED">已关闭</option>
          <option v-if="scope === 'all'" value="WITHDRAWN">已撤销</option>
        </select>
        <template v-if="scope !== 'all'">
          <select
            v-model="priorityFilter"
            class="ticket-filter-select"
            aria-label="优先级筛选"
          >
            <option value="">全部优先级</option>
            <option value="URGENT">紧急</option>
            <option value="HIGH">高</option>
            <option value="NORMAL">普通</option>
            <option value="LOW">低</option>
          </select>
          <label class="ticket-inline-check">
            <input v-model="overdueOnly" type="checkbox">
            仅看超时
          </label>
          <input
            v-model="queryText"
            type="search"
            aria-label="搜索队列"
            placeholder="单号或标题"
            @keyup.enter="applyQuery"
          >
          <button type="button" class="button-secondary" @click="applyQuery">查询</button>
          <button type="button" class="button-secondary" @click="resetFilters">重置</button>
        </template>
        <span class="count">{{ totalText }}</span>
      </div>
      <div v-if="error" class="admin-message error" role="alert">
        {{ error }}
        <button type="button" class="button-secondary" @click="() => void load(true)">重试</button>
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
        {{ scope === 'all' ? '暂无工单' : '队列空' }}
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
            <th>提单人</th>
            <th>超时</th>
            <th>操作</th>
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
            <td>{{ ticket.ownerName || ticket.ownerSubjectId }}</td>
            <td>
              <span
                v-if="ticket.overdueResponse || ticket.overdueResolution"
                class="table-action danger"
              >
                已超时
              </span>
              <span v-else>—</span>
            </td>
            <td class="table-action-cell">
              <button
                v-if="scope !== 'all' && ticket.status === 'SUBMITTED'"
                type="button"
                class="table-action"
                :disabled="acting === ticket.ticketNo"
                @click="() => void doClaim(ticket.ticketNo)"
              >
                受理
              </button>
              <button
                type="button"
                class="table-action"
                @click="() => void router.push({ path: `/tickets/${ticket.ticketNo}`, query: { from: scope } })"
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
import { claimTicket, getTicket, listAllTickets, listQueue, type TicketSummary } from '../api/ticketApi';
import { ticketIdentityEpoch } from '../auth/pkce';

const { scope = 'queue' } = defineProps<{ scope?: 'queue' | 'all' }>();

const router = useRouter();
const tickets = ref<TicketSummary[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
const statusFilter = ref('');
const priorityFilter = ref('');
const overdueOnly = ref(false);
const queryText = ref('');
const appliedQuery = ref('');
const page = ref(1);
const size = 20;
const hasMore = ref(false);
const acting = ref('');
let requestSequence = 0;
let disposed = false;
let skipNextFilterReload = false;

const totalText = computed(() => `已加载 ${tickets.value.length} 条`);

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: '待受理', PROCESSING: '处理中', PENDING_INFO: '待补充',
  RESOLVED: '已解决', CLOSED: '已关闭', WITHDRAWN: '已撤销'
};

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status;
}

const PRIORITY_TEXT: Record<string, string> = {
  LOW: '低', NORMAL: '普通', HIGH: '高', URGENT: '紧急'
};

function priorityText(priority: string): string {
  return PRIORITY_TEXT[priority] ?? priority;
}

async function load(reset: boolean): Promise<void> {
  const sequence = ++requestSequence;
  const identity = ticketIdentityEpoch();
  loading.value = reset;
  loadingMore.value = !reset;
  error.value = '';
  try {
    const target = reset ? 1 : page.value + 1;
    const result = scope === 'all'
      ? await listAllTickets(target, size, statusFilter.value ? [statusFilter.value] : undefined)
      : await listQueue(target, size, {
        status: statusFilter.value ? [statusFilter.value] : undefined,
        priority: priorityFilter.value || undefined,
        overdue: overdueOnly.value ? true : undefined,
        q: appliedQuery.value || undefined
      });
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    tickets.value = reset ? result.content : tickets.value.concat(result.content);
    page.value = result.page;
    hasMore.value = result.content.length >= result.size;
  } catch (cause) {
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    error.value = cause instanceof Error ? cause.message : '加载失败';
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
  skipNextFilterReload = Boolean(statusFilter.value || priorityFilter.value || overdueOnly.value);
  statusFilter.value = '';
  priorityFilter.value = '';
  overdueOnly.value = false;
  queryText.value = '';
  appliedQuery.value = '';
  void load(true);
}

async function doClaim(ticketNo: string): Promise<void> {
  acting.value = ticketNo;
  error.value = '';
  try {
    const detail = await getTicket(ticketNo);
    await claimTicket(ticketNo, detail.version);
    await load(true);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '受理失败';
  } finally {
    acting.value = '';
  }
}

onMounted(() => void load(true));
watch([statusFilter, priorityFilter, overdueOnly], () => {
  if (skipNextFilterReload) {
    skipNextFilterReload = false;
    return;
  }
  void load(true);
});
onBeforeUnmount(() => { disposed = true; requestSequence++; });
</script>
