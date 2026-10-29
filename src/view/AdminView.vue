<template>
  <div class="page">
    <PageHeader title="类型与处理组" description="工单类型、SLA 时限与处理组治理" />
    <div v-if="error" class="admin-message error" role="alert">
      {{ error }}
      <button type="button" class="button-secondary" @click="() => void refresh()">重试</button>
    </div>
    <section class="card-section">
      <div class="section-heading">
        <h3>工单类型</h3>
        <button
          type="button"
          class="button-secondary"
          @click="startNewType"
        >
          新建类型
        </button>
      </div>
      <table
        v-if="types.length > 0"
        class="data-table"
      >
        <thead>
          <tr>
            <th>编码 / 名称</th>
            <th>默认组</th>
            <th>响应时限</th>
            <th>办结时限</th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in types"
            :key="item.code"
          >
            <td>
              <span class="identity-cell">
                <span class="identity-main">{{ item.name }}</span>
                <span class="identity-code">{{ item.code }}</span>
              </span>
            </td>
            <td>{{ item.defaultGroup }}</td>
            <td>{{ item.slaResponseMinutes }} 分钟</td>
            <td>{{ item.slaResolutionMinutes }} 分钟</td>
            <td>{{ item.enabled ? '启用' : '停用' }}</td>
            <td class="table-action-cell">
              <button
                type="button"
                class="table-action"
                @click="editType(item)"
              >
                编辑
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="typeEditing" class="ticket-editor">
        <h3>{{ typeForm.id ? '编辑类型' : '新建类型' }}</h3>
        <div class="form-grid">
          <label>
            编码
            <input
              v-model="typeForm.code"
              :disabled="Boolean(typeForm.id)"
              placeholder="如 fault"
            >
          </label>
          <label>
            名称
            <input
              v-model="typeForm.name"
              placeholder="如 故障报修"
            >
          </label>
          <label>
            默认处理组
            <select v-model="typeForm.defaultGroup">
              <option
                v-for="group in groups"
                :key="group.code"
                :value="group.code"
              >
                {{ group.name }}
              </option>
            </select>
          </label>
          <label>
            响应时限（分钟）
            <input
              v-model.number="typeForm.slaResponseMinutes"
              type="number"
              min="1"
            >
          </label>
          <label>
            办结时限（分钟）
            <input
              v-model.number="typeForm.slaResolutionMinutes"
              type="number"
              min="1"
            >
          </label>
          <label>表单模板 JSON<textarea
            v-model="typeForm.formTemplate"
            rows="3"
            placeholder='[{"key":"scope","label":"影响范围","type":"select","required":true,"options":["单系统"]}]'
          /></label>
          <label class="ticket-inline-check">
            <input v-model="typeForm.enabled" type="checkbox">
            启用类型
          </label>
        </div>
        <div class="form-footer">
          <button
            type="button"
            class="button-primary"
            @click="() => void submitType()"
          >
            保存
          </button>
          <button
            type="button"
            class="button-secondary"
            @click="typeEditing = false"
          >
            取消
          </button>
        </div>
      </div>
    </section>

    <section class="card-section">
      <div class="section-heading">
        <h3>处理组</h3>
        <button
          type="button"
          class="button-secondary"
          @click="startNewGroup"
        >
          新建组
        </button>
      </div>
      <table
        v-if="groups.length > 0"
        class="data-table"
      >
        <thead>
          <tr>
            <th>编码 / 名称</th>
            <th>组长</th>
            <th>组员</th>
            <th>状态</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="group in groups"
            :key="group.code"
          >
            <td>
              <span class="identity-cell">
                <span class="identity-main">{{ group.name }}</span>
                <span class="identity-code">{{ group.code }}</span>
              </span>
            </td>
            <td>{{ group.leaderSubjectId || '—' }}</td>
            <td>{{ group.memberSubjectIds.length }} 人</td>
            <td>{{ group.enabled ? '启用' : '停用' }}</td>
            <td class="table-action-cell">
              <button
                type="button"
                class="table-action"
                @click="editGroup(group)"
              >
                编辑
              </button>
              <button
                v-if="group.enabled"
                type="button"
                class="table-action danger"
                @click="() => void disableGroup(group.code)"
              >
                停用
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="groupEditing" class="ticket-editor">
        <h3>{{ groupForm.id ? '编辑组' : '新建组' }}</h3>
        <div class="form-grid">
          <label>
            编码
            <input
              v-model="groupForm.code"
              :disabled="Boolean(groupForm.id)"
              placeholder="如 grp-ops"
            >
          </label>
          <label>
            名称
            <input
              v-model="groupForm.name"
              placeholder="如 运维组"
            >
          </label>
          <label>
            组长标识
            <input
              v-model="groupForm.leaderSubjectId"
              placeholder="subjectId"
            >
          </label>
          <label>
            组员（逗号分隔 subjectId）
            <input
              :value="(groupForm.memberSubjectIds ?? []).join(',')"
              @input="groupForm.memberSubjectIds = parseMembers($event)"
            >
          </label>
          <label class="ticket-inline-check">
            <input v-model="groupForm.enabled" type="checkbox">
            启用处理组
          </label>
        </div>
        <div class="form-footer">
          <button
            type="button"
            class="button-primary"
            @click="() => void submitGroup()"
          >
            保存
          </button>
          <button
            type="button"
            class="button-secondary"
            @click="groupEditing = false"
          >
            取消
          </button>
        </div>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import {
  deleteGroup,
  listGroups,
  listTypes,
  saveGroup,
  saveType,
  type TicketGroup,
  type TicketType
} from '../api/ticketApi';
import { ticketIdentityEpoch } from '../auth/pkce';

const types = ref<TicketType[]>([]);
const groups = ref<TicketGroup[]>([]);
const error = ref('');
const typeEditing = ref(false);
const groupEditing = ref(false);

const typeForm = reactive<Partial<TicketType>>({
  slaResponseMinutes: 60,
  slaResolutionMinutes: 480
});
const groupForm = reactive<Partial<TicketGroup>>({ memberSubjectIds: [] });
let requestSequence = 0;
let disposed = false;

function parseMembers(event: Event): string[] {
  const value = (event.target as HTMLInputElement).value;
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

async function refresh(): Promise<void> {
  const sequence = ++requestSequence;
  const identity = ticketIdentityEpoch();
  error.value = '';
  try {
    const [nextTypes, nextGroups] = await Promise.all([listTypes(), listGroups()]);
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    types.value = nextTypes;
    groups.value = nextGroups;
  } catch (cause) {
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    error.value = cause instanceof Error ? cause.message : '加载失败';
  }
}

function startNewType(): void {
  Object.assign(typeForm, {
    id: undefined, code: '', name: '', defaultGroup: groups.value[0]?.code ?? '',
    slaResponseMinutes: 60, slaResolutionMinutes: 480, formTemplate: '[]', enabled: true
  });
  typeEditing.value = true;
}

function editType(item: TicketType): void {
  Object.assign(typeForm, item);
  typeEditing.value = true;
}

async function submitType(): Promise<void> {
  error.value = '';
  try {
    await saveType(typeForm);
    typeEditing.value = false;
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败';
  }
}

function startNewGroup(): void {
  Object.assign(groupForm, { id: undefined, code: '', name: '', memberSubjectIds: [], leaderSubjectId: '', enabled: true });
  groupEditing.value = true;
}

function editGroup(group: TicketGroup): void {
  Object.assign(groupForm, group);
  groupEditing.value = true;
}

async function submitGroup(): Promise<void> {
  error.value = '';
  try {
    await saveGroup(groupForm);
    groupEditing.value = false;
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败';
  }
}

async function disableGroup(code: string): Promise<void> {
  error.value = '';
  try {
    await deleteGroup(code);
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '停用失败';
  }
}

onMounted(() => void refresh());
onBeforeUnmount(() => { disposed = true; requestSequence++; });
</script>
