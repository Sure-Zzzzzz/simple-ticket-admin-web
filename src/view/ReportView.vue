<template>
  <div class="page">
    <PageHeader title="统计报表" description="工单状态分布与办结满意度" />
    <section class="panel">
      <div class="ticket-filter-bar">
        <input v-model="fromDate" type="date" aria-label="报表开始日期">
        <input v-model="toDate" type="date" aria-label="报表结束日期">
        <button type="button" class="button-primary" @click="() => void loadReport()">查询</button>
      </div>
    </section>
    <div v-if="error" class="admin-message error" role="alert">
      {{ error }}
      <button type="button" class="button-secondary" @click="() => void loadReport()">重试</button>
    </div>
    <p v-else-if="loading" class="loading-state">加载中…</p>
    <template v-else-if="report">
      <p class="muted">统计范围：{{ report.from || '默认范围' }} 至 {{ report.to || '今天' }}</p>
      <section class="report-summary-grid" aria-label="报表概览">
        <article class="report-summary-card">
          <span>工单总量</span>
          <strong>{{ totalCount }}</strong>
          <small>当前统计范围</small>
        </article>
        <article class="report-summary-card">
          <span>处理中</span>
          <strong>{{ activeCount }}</strong>
          <small>已提交、处理中、待补充</small>
        </article>
        <article class="report-summary-card">
          <span>已办结</span>
          <strong>{{ report.satisfaction.resolved }}</strong>
          <small>已关闭工单</small>
        </article>
        <article class="report-summary-card">
          <span>参评率</span>
          <strong>{{ formatPercent(report.satisfaction.participationRate) }}</strong>
          <small>{{ report.satisfaction.evaluated }} / {{ report.satisfaction.resolved }} 已评价</small>
        </article>
      </section>

      <section class="report-panel">
        <div class="report-section-heading">
          <div>
            <h2>状态分布</h2>
            <p>当前范围内每种状态的工单数量</p>
          </div>
          <strong>{{ totalCount }} 单</strong>
        </div>
        <p v-if="(report.byStatus ?? []).length === 0" class="loading-state">暂无工单</p>
        <template v-else>
          <div class="distribution-bar" role="img" :aria-label="statusDistributionLabel">
            <span
              v-for="row in report.byStatus ?? []"
              :key="row.key ?? row.status"
              class="distribution-segment"
              :class="statusClass(row.key ?? row.status)"
              :style="{ width: `${barPercent(row.count, totalCount)}%` }"
            />
          </div>
          <div class="distribution-list">
            <div v-for="row in report.byStatus ?? []" :key="`status-${row.key ?? row.status}`" class="distribution-row">
              <span class="distribution-label"><i class="distribution-dot" :class="statusClass(row.key ?? row.status)" />{{ statusText(row.key ?? row.status) }}</span>
              <strong>{{ row.count }}</strong>
              <span class="distribution-percent">{{ formatShare(row.count, totalCount) }}</span>
            </div>
          </div>
        </template>
      </section>

      <section class="report-two-column">
        <article class="report-panel">
          <div class="report-section-heading">
            <div><h2>按工单类型</h2><p>不同类型的工作量</p></div>
            <strong>{{ report.byType?.length ?? 0 }} 类</strong>
          </div>
          <div v-if="(report.byType ?? []).length" class="ranked-list">
            <div v-for="row in sortedRows(report.byType ?? [])" :key="`type-${row.key ?? row.status}`" class="ranked-row">
              <div class="ranked-row-head"><span>{{ row.key || '未分类' }}</span><strong>{{ row.count }}</strong></div>
              <div class="ranked-track"><span :style="{ width: `${barPercent(row.count, maxCount(report.byType ?? []))}%` }" /></div>
            </div>
          </div>
          <p v-else class="loading-state">暂无工单类型数据</p>
        </article>
        <article class="report-panel">
          <div class="report-section-heading">
            <div><h2>按处理组</h2><p>各处理组承接的工单量</p></div>
            <strong>{{ report.byGroup?.length ?? 0 }} 组</strong>
          </div>
          <div v-if="(report.byGroup ?? []).length" class="ranked-list">
            <div v-for="row in sortedRows(report.byGroup ?? [])" :key="`group-${row.key ?? row.status}`" class="ranked-row">
              <div class="ranked-row-head"><span>{{ row.key || '未分派' }}</span><strong>{{ row.count }}</strong></div>
              <div class="ranked-track"><span :style="{ width: `${barPercent(row.count, maxCount(report.byGroup ?? []))}%` }" /></div>
            </div>
          </div>
          <p v-else class="loading-state">暂无处理组数据</p>
        </article>
      </section>

      <section class="report-panel">
        <div class="report-section-heading">
          <div><h2>SLA 指标</h2><p>响应与办结是否在约定时限内完成</p></div>
        </div>
        <div class="sla-grid">
          <div v-for="metric in slaMetrics" :key="metric.label" class="sla-item">
            <div class="sla-item-head"><span>{{ metric.label }}</span><strong>{{ formatPercent(metric.value) }}</strong></div>
            <div class="metric-track"><span :class="metric.tone" :style="{ width: `${percentValue(metric.value)}%` }" /></div>
          </div>
          <div class="sla-item sla-item-plain">
            <div class="sla-item-head"><span>平均响应耗时</span><strong>{{ formatMinutes(report.averageResponseMinutes) }}</strong></div>
            <p>从提交到首次受理的平均时间</p>
          </div>
          <div class="sla-item sla-item-plain">
            <div class="sla-item-head"><span>平均办结耗时</span><strong>{{ formatMinutes(report.averageResolutionMinutes) }}</strong></div>
            <p>从提交到办结的平均时间</p>
          </div>
        </div>
      </section>
      <section class="report-panel satisfaction-panel">
        <div class="report-section-heading">
          <div><h2>满意度</h2><p>已关闭工单的评价反馈</p></div>
          <strong>{{ averageStar }} / 5</strong>
        </div>
        <div class="satisfaction-content">
          <div class="star-rating" :aria-label="`平均评分 ${averageStar} / 5`">
            <span v-for="star in 5" :key="star" :class="{ filled: star <= roundedAverageStar }" aria-hidden="true">★</span>
          </div>
          <div class="satisfaction-stats">
            <div><span>已评价</span><strong>{{ report.satisfaction.evaluated }}</strong></div>
            <div><span>已关闭</span><strong>{{ report.satisfaction.resolved }}</strong></div>
            <div><span>参评率</span><strong>{{ formatPercent(report.satisfaction.participationRate) }}</strong></div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import { getReport, type TicketReport } from '../api/ticketApi';
import { ticketIdentityEpoch } from '../auth/pkce';

const report = ref<TicketReport | null>(null);
const loading = ref(true);
const error = ref('');
const fromDate = ref('');
const toDate = ref('');
const labels: Record<string, string> = {
  SUBMITTED: '已提交', PROCESSING: '处理中', PENDING_INFO: '待补充',
  RESOLVED: '已解决', CLOSED: '已关闭', WITHDRAWN: '已撤销'
};
const rowColors: Record<string, string> = {
  SUBMITTED: 'status-submitted', PROCESSING: 'status-processing', PENDING_INFO: 'status-pending',
  RESOLVED: 'status-resolved', CLOSED: 'status-closed', WITHDRAWN: 'status-withdrawn'
};
let requestSequence = 0;
let disposed = false;

function statusText(status: string): string {
  return labels[status] ?? status;
}

function formatPercent(value: number | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function formatMinutes(value: number | undefined): string {
  return `${(value ?? 0).toFixed(1)} 分钟`;
}

type ReportCountRow = { key?: string; status?: string; count: number };

function statusClass(status: string): string {
  return rowColors[status] ?? 'status-default';
}

function barPercent(value: number, total: number): number {
  if (!total || value <= 0) return 0;
  return Math.max(2, Math.min(100, (value / total) * 100));
}

function formatShare(value: number, total: number): string {
  return `${total ? ((value / total) * 100).toFixed(1) : '0.0'}%`;
}

function sortedRows(rows: ReportCountRow[]): ReportCountRow[] {
  return [...rows].sort((left, right) => right.count - left.count);
}

function maxCount(rows: ReportCountRow[]): number {
  return Math.max(...rows.map(row => row.count), 0);
}

function percentValue(value: number | undefined): number {
  return Math.max(0, Math.min(100, (value ?? 0) * 100));
}

const totalCount = computed(() => (report.value?.byStatus ?? []).reduce((sum, row) => sum + row.count, 0));
const activeCount = computed(() => (report.value?.byStatus ?? [])
  .filter(row => ['SUBMITTED', 'PROCESSING', 'PENDING_INFO'].includes(row.key ?? row.status ?? ''))
  .reduce((sum, row) => sum + row.count, 0));
const averageStar = computed(() => (report.value?.satisfaction.averageStar
  ?? report.value?.satisfaction.avgStar ?? 0).toFixed(1));
const roundedAverageStar = computed(() => Math.round(Number(averageStar.value)));
const statusDistributionLabel = computed(() => (report.value?.byStatus ?? [])
  .map(row => `${statusText(row.key ?? row.status ?? '')}${row.count}单`).join('，'));
const slaMetrics = computed(() => [
  { label: '响应达标率', value: report.value?.responseSlaRate ?? 0, tone: 'metric-success' },
  { label: '办结达标率', value: report.value?.resolutionSlaRate ?? 0, tone: 'metric-success' },
  { label: '超时率', value: report.value?.overdueRate ?? 0, tone: 'metric-danger' }
]);

async function loadReport(): Promise<void> {
  const sequence = ++requestSequence;
  const identity = ticketIdentityEpoch();
  error.value = '';
  loading.value = true;
  try {
    const nextReport = await getReport(fromDate.value || undefined, toDate.value || undefined);
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    report.value = nextReport;
  } catch (cause) {
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    error.value = cause instanceof Error ? cause.message : '加载失败';
  } finally {
    if (!disposed && sequence === requestSequence && identity === ticketIdentityEpoch()) loading.value = false;
  }
}

onMounted(() => void loadReport());
onBeforeUnmount(() => { disposed = true; requestSequence++; });
</script>

<style scoped>
.report-summary-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
}

.report-summary-card,
.report-panel {
  background: var(--iam-color-surface);
  border: 1px solid var(--iam-color-border);
  border-radius: var(--iam-radius-card);
  box-shadow: var(--iam-shadow-card);
}

.report-summary-card {
  display: grid;
  gap: 8px;
  min-height: 116px;
  padding: 18px;
}

.report-summary-card span,
.report-summary-card small,
.report-section-heading p,
.sla-item-plain p,
.satisfaction-stats span {
  color: var(--iam-color-text-secondary);
}

.report-summary-card span { font-size: 13px; font-weight: 700; }
.report-summary-card strong { font-size: 30px; line-height: 1; }
.report-summary-card small { font-size: 12px; }

.report-panel { padding: 20px; }

.report-two-column {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
}

.report-section-heading {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 18px;
}

.report-section-heading h2 { font-size: 17px; margin: 0; }
.report-section-heading p { font-size: 12px; margin: 5px 0 0; }
.report-section-heading > strong { color: var(--iam-color-text-secondary); font-size: 13px; white-space: nowrap; }

.distribution-bar {
  background: var(--iam-color-surface-soft);
  border-radius: 999px;
  display: flex;
  height: 14px;
  overflow: hidden;
}

.distribution-segment { min-width: 2px; transition: width .2s ease; }
.distribution-row { align-items: center; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) auto 58px; padding: 9px 0; }
.distribution-label { align-items: center; display: flex; gap: 8px; min-width: 0; }
.distribution-dot { border-radius: 50%; display: inline-block; flex: 0 0 auto; height: 9px; width: 9px; }
.distribution-percent { color: var(--iam-color-text-secondary); font-size: 12px; text-align: right; }

.status-submitted { background: var(--iam-color-border-strong); }
.status-processing { background: var(--iam-color-primary); }
.status-pending { background: var(--iam-color-warning); }
.status-resolved { background: var(--iam-color-info); }
.status-closed { background: var(--iam-color-success); }
.status-withdrawn { background: var(--iam-color-danger); }
.status-default { background: var(--iam-color-border-strong); }

.ranked-list { display: grid; gap: 14px; }
.ranked-row { display: grid; gap: 7px; }
.ranked-row-head { display: flex; gap: 12px; justify-content: space-between; }
.ranked-row-head span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ranked-row-head strong { color: var(--iam-color-text-secondary); font-size: 13px; }
.ranked-track,
.metric-track { background: var(--iam-color-surface-soft); border-radius: 999px; height: 8px; overflow: hidden; }
.ranked-track span { background: var(--iam-color-primary); border-radius: inherit; display: block; height: 100%; min-width: 5px; }

.sla-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
.sla-item { display: grid; gap: 9px; }
.sla-item-head { align-items: baseline; display: flex; gap: 12px; justify-content: space-between; }
.sla-item-head span { color: var(--iam-color-text-secondary); font-size: 13px; }
.sla-item-head strong { font-size: 16px; white-space: nowrap; }
.metric-track span { border-radius: inherit; display: block; height: 100%; min-width: 2px; }
.metric-success { background: var(--iam-color-success); }
.metric-danger { background: var(--iam-color-danger); }
.sla-item-plain p { font-size: 12px; line-height: 1.5; margin: 0; }

.satisfaction-content { align-items: center; display: flex; flex-wrap: wrap; gap: 34px; justify-content: space-between; }
.star-rating { display: flex; gap: 5px; }
.star-rating span { color: var(--iam-color-border-strong); font-size: 28px; line-height: 1; }
.star-rating span.filled { color: var(--iam-color-warning); }
.satisfaction-stats { display: grid; flex: 1 1 360px; gap: 20px; grid-template-columns: repeat(3, minmax(80px, 1fr)); min-width: min(100%, 260px); text-align: right; }
.satisfaction-stats div { display: grid; gap: 4px; }
.satisfaction-stats span { font-size: 12px; }
.satisfaction-stats strong { font-size: 18px; }

@media (max-width: 760px) {
  .report-panel { padding: 16px; }
  .satisfaction-content { align-items: flex-start; }
  .satisfaction-stats { text-align: left; }
}
</style>
