<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadAppAttachment } from '@/api/app'
import type { AppFieldView } from '@/types/api'

/**
 * AdminRenderer 字段输入（P11 T106，ARCHITECTURE-P11 §6）：
 * 按字段类型渲染控件；ref 走候选数据源；attachment 走 /app/:code/attachment 上传（落 /app-attachments/）。
 */
const props = defineProps<{
  appCode: string
  field: AppFieldView
  modelValue: unknown
  /** ref 字段候选（{ value: rowId, label }） */
  options?: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>()

const uploading = ref(false)

const value = computed({
  get: () => props.modelValue,
  set: (next) => emit('update:modelValue', next),
})

/** el-upload 变更回调（用命名方法，避免模板内联箭头参数隐式 any） */
function onFileChange(file: { raw?: File }): void {
  if (file.raw) void doUpload(file.raw)
}

async function doUpload(file: File): Promise<void> {
  uploading.value = true
  try {
    const uploaded = await uploadAppAttachment(props.appCode, file)
    emit('update:modelValue', uploaded.fileId)
    ElMessage.success(`附件已上传`)
  } catch {
    // 请求层已提示
  } finally {
    uploading.value = false
  }
}

function clearAttachment() {
  emit('update:modelValue', null)
}
</script>

<template>
  <el-input
    v-if="field.type === 'text'"
    v-model="value as string"
    :placeholder="`请输入${field.label}`"
    clearable
  />
  <el-input-number
    v-else-if="field.type === 'number'"
    v-model="value as number"
    :controls="false"
    class="v-field-number"
  />
  <el-date-picker
    v-else-if="field.type === 'datetime'"
    v-model="value as string"
    type="datetime"
    value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
    :placeholder="`请选择${field.label}`"
  />
  <el-switch
    v-else-if="field.type === 'bool'"
    v-model="value as boolean"
  />
  <el-select
    v-else-if="field.type === 'enum'"
    v-model="value as string"
    :placeholder="`请选择${field.label}`"
    clearable
  >
    <el-option
      v-for="option in field.enumOptions ?? []"
      :key="option.value"
      :label="option.label"
      :value="option.value"
    />
  </el-select>
  <el-select
    v-else-if="field.type === 'ref' && field.refMultiple"
    v-model="value as string[]"
    multiple
    filterable
    :placeholder="`请选择${field.label}`"
    clearable
  >
    <el-option
      v-for="option in options ?? []"
      :key="option.value"
      :label="option.label"
      :value="option.value"
    />
  </el-select>
  <el-select
    v-else-if="field.type === 'ref'"
    v-model="value as string"
    filterable
    :placeholder="`请选择${field.label}`"
    clearable
  >
    <el-option
      v-for="option in options ?? []"
      :key="option.value"
      :label="option.label"
      :value="option.value"
    />
  </el-select>
  <div
    v-else-if="field.type === 'attachment'"
    class="v-field-attachment"
  >
    <span class="v-field-attachment__value">{{ value ? '已上传附件' : '（未上传）' }}</span>
    <el-upload
      :show-file-list="false"
      :auto-upload="false"
      :limit="1"
      :on-change="onFileChange"
    >
      <el-button
        size="small"
        :loading="uploading"
      >
        上传附件
      </el-button>
    </el-upload>
    <el-button
      v-if="value"
      size="small"
      text
      type="danger"
      @click="clearAttachment"
    >
      清除
    </el-button>
  </div>
  <el-input
    v-else
    v-model="value as string"
    :placeholder="`请输入${field.label}`"
  />
</template>

<style scoped>
.v-field-number {
  width: 100%;
}
.v-field-attachment {
  display: flex;
  align-items: center;
  gap: 8px;
}
.v-field-attachment__value {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
