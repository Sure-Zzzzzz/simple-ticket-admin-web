<template>
  <div class="page">
    <PageHeader title="提交工单" description="选择类型、填写标题与补充信息后提交">
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
    <section class="card-section">
      <div class="form-grid">
        <label>
          工单类型
          <select
            v-model="typeCode"
            :disabled="types.length === 0"
          >
            <option
              v-for="item in types"
              :key="item.code"
              :value="item.code"
            >
              {{ item.name }}
            </option>
          </select>
        </label>
        <label>
          优先级
          <select v-model="priority">
            <option value="LOW">低</option>
            <option value="NORMAL">普通</option>
            <option value="HIGH">高</option>
            <option value="URGENT">紧急</option>
          </select>
        </label>
        <label>
          标题
          <input
            v-model="subject"
            maxlength="120"
            placeholder="一句话描述问题"
          >
        </label>
      </div>

      <label>
        描述
        <textarea
          v-model="description"
          rows="4"
          maxlength="8000"
          placeholder="环境、现象、期望（可留空）"
        />
      </label>

      <label>
        附件（可选，最多 10 个）
        <input
          type="file"
          multiple
          :disabled="submitting || uploading !== ''"
          @change="selectFiles"
        >
      </label>
      <ul v-if="selectedFiles.length > 0" class="attachment-list">
        <li
          v-for="item in selectedFiles"
          :key="fileKey(item)"
          class="attachment-row"
        >
          <span class="attachment-name">{{ item.name }}</span>
          <span class="muted">{{ formatSize(item.size) }}</span>
          <span
            v-if="uploadedAttachments.some(uploaded => uploaded.fileName === item.name && uploaded.size === item.size)"
            class="muted"
          >已上传</span>
        </li>
      </ul>
      <p v-if="uploading" class="muted">正在上传附件：{{ uploading }}</p>

      <!-- 类型模板动态字段（formTemplate JSON 渲染） -->
      <template v-if="templateFields.length > 0">
        <h3>补充信息</h3>
        <div class="form-grid">
          <template
            v-for="field in templateFields"
            :key="field.key"
          >
            <label v-if="field.type === 'select'">
              {{ field.label }}<template v-if="field.required"> *</template>
              <select v-model="answers[field.key]" :required="field.required">
                <option value="">请选择</option>
                <option
                  v-for="option in field.options"
                  :key="option"
                  :value="option"
                >
                  {{ option }}
                </option>
              </select>
            </label>
            <label v-else-if="field.type === 'textarea'">
              {{ field.label }}<template v-if="field.required"> *</template>
              <textarea
                v-model="answers[field.key]"
                rows="3"
                :required="field.required"
                :maxlength="fieldMaxLength(field)"
              />
            </label>
            <label v-else>
              {{ field.label }}<template v-if="field.required"> *</template>
              <input
                v-model="answers[field.key]"
                :required="field.required"
                :maxlength="fieldMaxLength(field)"
              >
            </label>
          </template>
        </div>
      </template>

      <p
        v-if="error"
        class="admin-message error"
        role="alert"
      >
        {{ error }}
        <button v-if="types.length === 0" type="button" class="button-secondary" @click="() => void loadTypes()">重试</button>
      </p>
      <div class="form-footer">
        <button
          type="button"
          class="button-primary"
          :disabled="!canSubmit || submitting || uploading !== ''"
          @click="() => void submit()"
        >
          {{ submitting ? '提交中…' : '提交工单' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import {
  createTicket,
  listPortalTypes,
  uploadAttachment,
  type AttachmentItem,
  type TemplateField,
  type TicketType
} from '../api/ticketApi';
import { ticketIdentityEpoch } from '../auth/pkce';

const router = useRouter();
const types = ref<TicketType[]>([]);
const typeCode = ref('');
const priority = ref('NORMAL');
const subject = ref('');
const description = ref('');
const answers = reactive<Record<string, string>>({});
const submitting = ref(false);
const error = ref('');
const selectedFiles = ref<File[]>([]);
const uploadedAttachments = ref<AttachmentItem[]>([]);
const uploading = ref('');
const idempotencyKey = ref<string | null>(null);
const idempotencyPayload = ref('');
let requestSequence = 0;
let disposed = false;

const currentType = computed(() => types.value.find(item => item.code === typeCode.value) ?? null);

const templateFields = computed<TemplateField[]>(() => {
  const raw = currentType.value?.formTemplate;
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as TemplateField[] : [];
  } catch {
    return [];
  }
});

function fieldMaxLength(field: TemplateField): number {
  return typeof field.maxLength === 'number' && Number.isInteger(field.maxLength)
    && field.maxLength > 0 && field.maxLength <= 2000 ? field.maxLength : 2000;
}

const canSubmit = computed(() =>
  typeCode.value !== '' && subject.value.trim().length > 0
  && templateFields.value.every(field => !field.required || !!answers[field.key]?.trim()));

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function selectFiles(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) {
    return;
  }
  if (files.length > 10) {
    error.value = '单个工单最多上传 10 个附件';
    input.value = '';
    return;
  }
  selectedFiles.value = files;
  uploadedAttachments.value = [];
  idempotencyKey.value = null;
  idempotencyPayload.value = '';
  error.value = '';
}

async function uploadSelectedFiles(): Promise<AttachmentItem[]> {
  const result: AttachmentItem[] = [...uploadedAttachments.value];
  for (const file of selectedFiles.value) {
    if (result.some(item => item.fileName === file.name && item.size === file.size)) {
      continue;
    }
    uploading.value = file.name;
    result.push(await uploadAttachment(file));
    uploadedAttachments.value = [...result];
  }
  uploading.value = '';
  uploadedAttachments.value = result;
  return result;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadTypes(): Promise<void> {
  const sequence = ++requestSequence;
  const identity = ticketIdentityEpoch();
  error.value = '';
  try {
    const nextTypes = await listPortalTypes();
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    types.value = nextTypes;
    if (types.value.length > 0) typeCode.value = types.value[0].code;
  } catch (cause) {
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    error.value = cause instanceof Error ? cause.message : '加载工单类型失败';
  }
}

async function submit(): Promise<void> {
  const sequence = ++requestSequence;
  const identity = ticketIdentityEpoch();
  submitting.value = true;
  error.value = '';
  try {
    const attachments = await uploadSelectedFiles();
    const payload = {
      typeCode: typeCode.value,
      subject: subject.value.trim(),
      description: description.value.trim() || undefined,
      priority: priority.value,
      formAnswers: { ...answers },
      attachments
    };
    const payloadFingerprint = JSON.stringify(payload);
    if (!idempotencyKey.value || idempotencyPayload.value !== payloadFingerprint) {
      idempotencyKey.value = newIdempotencyKey();
      idempotencyPayload.value = payloadFingerprint;
    }
    const key = idempotencyKey.value;
    const created = await createTicket(payload, key);
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    await router.push(`/tickets/${created.ticketNo}`);
  } catch (e) {
    if (disposed || sequence !== requestSequence || identity !== ticketIdentityEpoch()) return;
    error.value = e instanceof Error ? e.message : '提交失败';
    uploading.value = '';
  } finally {
    if (!disposed && sequence === requestSequence && identity === ticketIdentityEpoch()) submitting.value = false;
  }
}

onMounted(() => void loadTypes());
onBeforeUnmount(() => { disposed = true; requestSequence++; });
</script>
