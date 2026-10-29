<template>
  <div class="page">
    <PageHeader :title="ticket ? `工单 ${ticket.ticketNo}` : '工单详情'" :description="ticket ? ticket.subject : '加载中'">
      <template #actions>
        <button
          type="button"
          class="button-secondary"
          @click="() => void router.back()"
        >
          返回
        </button>
      </template>
    </PageHeader>
    <p
      v-if="loading"
      class="loading-state"
    >
      加载中…
    </p>
    <div v-else-if="loadError" class="admin-message error" role="alert">
      {{ loadError }}
      <button type="button" class="button-secondary" @click="() => void refresh()">重试</button>
    </div>
    <template v-else-if="ticket">
      <!-- 状态流转步进；终态全部使用成功语义。 -->
      <div class="ticket-flow">
        <span
          v-for="step in flowSteps"
          :key="step.key"
          class="flow-step"
          :class="{ 'step-current': step.current, 'step-done': step.done }"
        >
          {{ step.label }}
        </span>
      </div>

      <section class="card-section">
        <div class="section-heading">
          <h2>{{ ticket.subject }}</h2>
          <span
            class="status-chip"
            :class="`status-${ticket.status.toLowerCase()}`"
          >{{ statusText(ticket.status) }}</span>
        </div>
        <div class="ticket-meta-grid">
          <div class="ticket-meta-item">
            <span class="ticket-meta-label">类型</span>
            <span class="ticket-meta-value">{{ ticket.typeCode }}</span>
          </div>
          <div class="ticket-meta-item">
            <span class="ticket-meta-label">优先级</span>
            <span class="ticket-meta-value">{{ priorityText(ticket.priority) }}</span>
          </div>
          <div class="ticket-meta-item">
            <span class="ticket-meta-label">提单人</span>
            <span class="ticket-meta-value">{{ ticket.ownerName || ticket.ownerSubjectId }}</span>
          </div>
          <div class="ticket-meta-item">
            <span class="ticket-meta-label">处理人</span>
            <span class="ticket-meta-value">{{ ticket.assigneeName || ticket.assigneeSubjectId || '待受理' }}</span>
          </div>
          <div class="ticket-meta-item">
            <span class="ticket-meta-label">创建时间</span>
            <span class="ticket-meta-value">{{ formatTime(ticket.createdAt) }}</span>
          </div>
        </div>
        <p class="ticket-description">{{ ticket.description || '（无描述）' }}</p>
      </section>

      <section class="card-section">
        <div class="section-heading">
          <h3>时间线</h3>
          <button
            v-if="timeline?.nextCursor"
            type="button"
            class="button-secondary"
            :disabled="timelineLoadingMore"
            @click="() => void loadOlderTimeline()"
          >
            {{ timelineLoadingMore ? '加载中…' : '加载更早记录' }}
          </button>
        </div>
        <div
          v-for="item in timelineItems"
          :key="item.key"
          class="timeline-item"
        >
          <span class="timeline-time">{{ formatTime(item.time) }}</span>
          <span class="timeline-title">{{ item.title }}</span>
          <div
            v-if="item.body"
            class="comment-bubble"
            :class="{ internal: item.internal }"
          >
            {{ item.body }}
          </div>
        </div>
        <p
          v-if="timelineItems.length === 0"
          class="loading-state"
        >
          暂无记录
        </p>
        <div v-if="timeline && timeline.attachments.length > 0" class="attachment-area">
          <h3>附件</h3>
          <ul class="attachment-list">
            <li v-for="attachment in timeline.attachments" :key="attachment.id" class="attachment-row">
              <span class="attachment-name">{{ attachment.fileName }}</span>
              <span class="muted">{{ formatSize(attachment.size) }}</span>
              <button
                type="button"
                class="table-action"
                :disabled="downloadingAttachmentId === attachment.id"
                :aria-label="`下载附件 ${attachment.fileName}`"
                @click="() => void downloadAttachment(attachment.id)"
              >
                <Download :size="16" aria-hidden="true" />
                下载
              </button>
            </li>
          </ul>
          <p v-if="attachmentError" class="admin-message error" role="alert">{{ attachmentError }}</p>
        </div>
      </section>

      <section v-if="canEvaluate" class="card-section">
        <div class="section-heading">
          <h3>评价处理结果</h3>
        </div>
        <div class="form-grid">
          <label>
            评分
            <select v-model.number="evaluationStar">
              <option :value="5">5 星</option>
              <option :value="4">4 星</option>
              <option :value="3">3 星</option>
              <option :value="2">2 星</option>
              <option :value="1">1 星</option>
            </select>
          </label>
          <label>
            评价（可选）
            <textarea v-model="evaluationComment" rows="3" maxlength="2000" />
          </label>
        </div>
        <div class="form-footer">
          <button
            type="button"
            class="button-primary"
            :disabled="acting"
            @click="doEvaluate"
          >
            提交评价
          </button>
        </div>
      </section>

      <section
        v-if="actionBarVisible"
        class="card-section"
      >
        <div v-if="canComment" class="ticket-comment-form">
          <textarea
            v-model="commentDraft"
            placeholder="写留言…"
            rows="3"
            aria-label="留言内容"
          />
          <label v-if="canInternalComment" class="ticket-inline-check">
            <input v-model="internalComment" type="checkbox">
            仅处理组可见
          </label>
        </div>
        <div v-if="canAssign || canTransfer" class="form-grid">
          <label>
            目标处理组编码
            <input v-model="assignment.groupCode" autocomplete="off" required>
          </label>
          <label>
            目标处理人 subjectId
            <input v-model="assignment.assigneeSubjectId" autocomplete="off" required>
          </label>
        </div>
        <label v-if="canRequestInfo">
          待补充原因
          <select v-model="requestInfoReason">
            <option value="AWAIT_MATERIAL">等待提单人补充材料</option>
            <option value="AWAIT_THIRDPARTY">等待第三方</option>
          </select>
        </label>
        <div class="form-footer">
          <button
            v-if="canComment"
            type="button"
            class="button-primary"
            :disabled="!commentDraft.trim() || acting"
            @click="submitComment"
          >
            发送留言
          </button>
          <button
            v-if="canAssign"
            type="button"
            class="button-secondary"
            :disabled="!canSubmitAssignment || acting"
            @click="doAssign"
          >
            分派
          </button>
          <button
            v-if="canTransfer"
            type="button"
            class="button-secondary"
            :disabled="!canSubmitAssignment || acting"
            @click="doTransfer"
          >
            转派
          </button>
          <button
            v-if="canRequestInfo"
            type="button"
            class="button-secondary"
            :disabled="acting"
            @click="doRequestInfo"
          >
            请求补充
          </button>
          <button
            v-if="canResolve"
            type="button"
            class="button-primary"
            :disabled="acting"
            @click="doResolve"
          >
            办结
          </button>
          <button
            v-if="canSupply"
            type="button"
            class="button-primary"
            :disabled="acting"
            @click="doSupply"
          >
            提交补充
          </button>
          <button
            v-if="canConfirm"
            type="button"
            class="button-primary"
            :disabled="acting"
            @click="doConfirm"
          >
            确认关闭
          </button>
          <button
            v-if="canReject"
            type="button"
            class="table-action danger"
            :disabled="acting"
            @click="doReject"
          >
            不认可，重开
          </button>
          <button
            v-if="canWithdraw"
            type="button"
            class="table-action danger"
            :disabled="acting"
            @click="doWithdraw"
          >
            撤销工单
          </button>
        </div>
        <p
          v-if="actionError"
          class="admin-message error"
          role="alert"
        >
          {{ actionError }}
        </p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Download } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import {
  addComment,
  addManageComment,
  addInternalComment,
  assignTicket,
  confirmTicket,
  evaluateTicket,
  getAttachmentDownloadUrl,
  getManageAttachmentDownloadUrl,
  getTicket,
  getManageTicket,
  getTimeline,
  getManageTimeline,
  rejectTicket,
  requestInfoTicket,
  resolveTicket,
  supplyTicket,
  transferTicket,
  withdrawTicket,
  type TicketDetail,
  type TicketTimeline
} from '../api/ticketApi';
import { ticketCurrentSubjectId, ticketIdentityEpoch } from '../auth/pkce';

const route = useRoute();
const router = useRouter();
const ticket = ref<TicketDetail | null>(null);
const timeline = ref<TicketTimeline | null>(null);
const timelineLoadingMore = ref(false);
const loading = ref(true);
const loadError = ref('');
const acting = ref(false);
const actionError = ref('');
const downloadingAttachmentId = ref<number | null>(null);
const attachmentError = ref('');
const commentDraft = ref('');
const internalComment = ref(false);
const requestInfoReason = ref<'AWAIT_MATERIAL' | 'AWAIT_THIRDPARTY'>('AWAIT_MATERIAL');
const assignment = reactive({ groupCode: '', assigneeSubjectId: '' });
const evaluationStar = ref(5);
const evaluationComment = ref('');
const evaluationSubmitted = ref(false);
// 按单操作权限尚无可消费的能力来源；不能从全量列表可读推断写权限。
const managementPermissions = ref<ReadonlySet<string>>(new Set());
let loadSequence = 0;
let disposed = false;

const managementScope = computed(() => route.query.from === 'queue' || route.query.from === 'all');

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
  LOW: '低', NORMAL: '普通', HIGH: '高', URGENT: '紧急'
};

function priorityText(priority: string): string {
  return PRIORITY_TEXT[priority] ?? priority;
}

function formatTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

const FLOW_ORDER = ['SUBMITTED', 'PROCESSING', 'RESOLVED', 'CLOSED'];
const FLOW_LABEL: Record<string, string> = {
  SUBMITTED: '已提交', PROCESSING: '处理中', RESOLVED: '已解决', CLOSED: '已关闭'
};

const flowSteps = computed(() => {
  if (!ticket.value) {
    return [];
  }
  const status = ticket.value.status;
  if (status === 'WITHDRAWN') {
    return [{ key: 'withdrawn', label: '已撤销', current: true, done: false }];
  }
  const currentIndex = FLOW_ORDER.indexOf(status === 'PENDING_INFO' ? 'PROCESSING' : status);
  return FLOW_ORDER.map((key, index) => ({
    key,
    label: FLOW_LABEL[key],
    current: index === currentIndex,
    done: index < currentIndex
  }));
});

interface TimelineEntry {
  key: string;
  time: string;
  title: string;
  body: string | null;
  internal: boolean;
}

const ACTION_TEXT: Record<string, string> = {
  CLAIM: '受理工单', ASSIGN: '分派', TRANSFER: '转派',
  REQUEST_INFO: '等待补充', SUPPLY: '已补充', RESOLVE: '办结',
  CONFIRM: '确认关闭', REJECT: '重开', WITHDRAW: '撤销', CONFIRM_TIMEOUT: '确认超时自动关闭'
};

const timelineItems = computed<TimelineEntry[]>(() => {
  if (!timeline.value) {
    return [];
  }
  const transitions = timeline.value.transitions.map(item => ({
    key: `t-${item.id}`,
    time: item.createdAt,
    title: `${ACTION_TEXT[item.action] ?? item.action}（${item.actorSubjectId ?? '系统'}）`,
    body: null as string | null,
    internal: false
  }));
  const comments = timeline.value.comments.map(item => ({
    key: `c-${item.id}`,
    time: item.createdAt,
    title: `${item.authorRole === 'SYSTEM' ? '系统' : item.authorName ?? ''}留言${item.internal ? '（内部）' : ''}`,
    body: item.body,
    internal: item.internal
  }));
  return [...transitions, ...comments].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
});

const isOwner = computed(() => ticket.value !== null && !!ticketCurrentSubjectId()
  && ticket.value.ownerSubjectId === ticketCurrentSubjectId());
const isAssignee = computed(() => ticket.value !== null && !!ticketCurrentSubjectId()
  && ticket.value.assigneeSubjectId === ticketCurrentSubjectId());
const canManage = computed(() => isAssignee.value);
const canAssign = computed(() => managementPermissions.value.has('ticket:assign') && ticket.value !== null
  && ['SUBMITTED', 'PROCESSING', 'PENDING_INFO'].includes(ticket.value.status));
const canTransfer = computed(() => managementPermissions.value.has('ticket:transfer') && ticket.value !== null
  && ['PROCESSING', 'PENDING_INFO'].includes(ticket.value.status));
const canSubmitAssignment = computed(() => !!assignment.groupCode.trim() && !!assignment.assigneeSubjectId.trim());
const canRequestInfo = computed(() => canManage.value && ticket.value?.status === 'PROCESSING');
const canResolve = computed(() => canManage.value && ticket.value !== null
  && ['PROCESSING', 'PENDING_INFO'].includes(ticket.value.status));
const canInternalComment = computed(() => canManage.value && !isOwner.value);
const canComment = computed(() => ticket.value !== null
  && (isOwner.value || canManage.value)
  && !['CLOSED', 'WITHDRAWN'].includes(ticket.value.status));
const canSupply = computed(() => isOwner.value && ticket.value?.status === 'PENDING_INFO');
const canConfirm = computed(() => isOwner.value && ticket.value?.status === 'RESOLVED');
const canReject = computed(() => isOwner.value && ticket.value?.status === 'RESOLVED');
const canEvaluate = computed(() => isOwner.value && ticket.value?.status === 'CLOSED'
  && !evaluationSubmitted.value
  && !(timeline.value?.transitions ?? []).some(item => item.action === 'CONFIRM_TIMEOUT'));
const canWithdraw = computed(() => isOwner.value && ticket.value !== null
  && ['SUBMITTED', 'PROCESSING', 'PENDING_INFO'].includes(ticket.value.status));
const actionBarVisible = computed(() =>
  canComment.value || canSupply.value || canConfirm.value || canReject.value || canWithdraw.value
  || canAssign.value || canTransfer.value || canRequestInfo.value || canResolve.value);

async function refresh(): Promise<void> {
  const sequence = ++loadSequence;
  const identity = ticketIdentityEpoch();
  const ticketNo = String(route.params.ticketNo);
  loadError.value = '';
  attachmentError.value = '';
  try {
    const [detail, history] = managementScope.value
      ? await Promise.all([getManageTicket(ticketNo), getManageTimeline(ticketNo)])
      : await Promise.all([getTicket(ticketNo), getTimeline(ticketNo)]);
    if (disposed || sequence !== loadSequence || identity !== ticketIdentityEpoch()) return;
    ticket.value = detail;
    timeline.value = history;
    assignment.groupCode = detail.assigneeGroup ?? '';
    assignment.assigneeSubjectId = detail.assigneeSubjectId ?? '';
  } catch (cause) {
    if (disposed || sequence !== loadSequence || identity !== ticketIdentityEpoch()) return;
    loadError.value = cause instanceof Error ? cause.message : '加载失败';
  } finally {
    if (!disposed && sequence === loadSequence && identity === ticketIdentityEpoch()) loading.value = false;
  }
}

async function loadOlderTimeline(): Promise<void> {
  const cursor = timeline.value?.nextCursor;
  if (!cursor || timelineLoadingMore.value || disposed) return;
  const sequence = loadSequence;
  const identity = ticketIdentityEpoch();
  timelineLoadingMore.value = true;
  try {
    const older = managementScope.value
      ? await getManageTimeline(String(route.params.ticketNo), cursor)
      : await getTimeline(String(route.params.ticketNo), cursor);
    if (disposed || sequence !== loadSequence || identity !== ticketIdentityEpoch()) return;
    const current = timeline.value;
    if (!current) return;
    const transitionIds = new Set(current.transitions.map(item => item.id));
    const commentIds = new Set(current.comments.map(item => item.id));
    const attachmentIds = new Set(current.attachments.map(item => item.id));
    timeline.value = {
      transitions: current.transitions.concat(older.transitions.filter(item => !transitionIds.has(item.id))),
      comments: current.comments.concat(older.comments.filter(item => !commentIds.has(item.id))),
      attachments: current.attachments.concat(older.attachments.filter(item => !attachmentIds.has(item.id))),
      nextCursor: older.nextCursor
    };
  } catch (cause) {
    if (!disposed && identity === ticketIdentityEpoch()) {
      actionError.value = cause instanceof Error ? cause.message : '加载时间线失败';
    }
  } finally {
    if (!disposed && identity === ticketIdentityEpoch()) timelineLoadingMore.value = false;
  }
}

async function downloadAttachment(attachmentId: number): Promise<void> {
  const identity = ticketIdentityEpoch();
  downloadingAttachmentId.value = attachmentId;
  attachmentError.value = '';
  try {
    const { downloadUrl } = managementScope.value
      ? await getManageAttachmentDownloadUrl(String(route.params.ticketNo), attachmentId)
      : await getAttachmentDownloadUrl(String(route.params.ticketNo), attachmentId);
    if (disposed || identity !== ticketIdentityEpoch()) return;
    const url = new URL(downloadUrl, window.location.href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('附件下载地址无效');
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  } catch (cause) {
    if (!disposed && identity === ticketIdentityEpoch()) {
      attachmentError.value = cause instanceof Error ? cause.message : '下载附件失败';
    }
  } finally {
    if (!disposed && identity === ticketIdentityEpoch()) downloadingAttachmentId.value = null;
  }
}

async function run(action: () => Promise<unknown>): Promise<void> {
  const identity = ticketIdentityEpoch();
  acting.value = true;
  actionError.value = '';
  try {
    await action();
    if (!disposed && identity === ticketIdentityEpoch()) await refresh();
  } catch (error) {
    if (!disposed && identity === ticketIdentityEpoch()) {
      actionError.value = error instanceof Error ? error.message : '操作失败';
    }
  } finally {
    if (!disposed && identity === ticketIdentityEpoch()) acting.value = false;
  }
}

function submitComment(): void {
  const body = commentDraft.value.trim();
  if (!body) {
    return;
  }
  void run(async () => {
    if (managementScope.value) {
      await addManageComment(String(route.params.ticketNo), body, internalComment.value, ticket.value?.version);
    } else if (canInternalComment.value && internalComment.value) {
      await addInternalComment(String(route.params.ticketNo), body, ticket.value?.version);
    } else {
      await addComment(String(route.params.ticketNo), body, ticket.value?.version);
    }
    commentDraft.value = '';
  });
}

function doAssign(): void {
  if (!canSubmitAssignment.value) return;
  void run(() => assignTicket(String(route.params.ticketNo),
    assignment.groupCode.trim(), assignment.assigneeSubjectId.trim(), ticket.value?.version));
}

function doTransfer(): void {
  if (!canSubmitAssignment.value) return;
  void run(() => transferTicket(String(route.params.ticketNo),
    assignment.groupCode.trim(), assignment.assigneeSubjectId.trim(), ticket.value?.version));
}

function doRequestInfo(): void {
  void run(() => requestInfoTicket(String(route.params.ticketNo), requestInfoReason.value, ticket.value?.version));
}

function doResolve(): void {
  void run(() => resolveTicket(String(route.params.ticketNo), ticket.value?.version));
}

function doSupply(): void {
  if (!commentDraft.value.trim()) {
    actionError.value = '补充内容写入留言框后提交';
    return;
  }
  const body = commentDraft.value.trim();
  void run(async () => {
    await supplyTicket(String(route.params.ticketNo), body, ticket.value?.version);
    commentDraft.value = '';
  });
}

function doConfirm(): void {
  void run(() => confirmTicket(String(route.params.ticketNo), ticket.value?.version));
}

function doReject(): void {
  void run(() => rejectTicket(String(route.params.ticketNo), ticket.value?.version));
}

function doWithdraw(): void {
  void run(() => withdrawTicket(String(route.params.ticketNo), ticket.value?.version));
}

function doEvaluate(): void {
  if (!canEvaluate.value) return;
  void run(async () => {
    await evaluateTicket(String(route.params.ticketNo), evaluationStar.value,
      evaluationComment.value.trim() || undefined, ticket.value?.version);
    evaluationSubmitted.value = true;
  });
}

onMounted(() => void refresh());
onBeforeUnmount(() => { disposed = true; loadSequence++; });
</script>
