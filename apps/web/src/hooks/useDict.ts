import { reactive, toRefs } from 'vue'
import { getDictByType } from '@/api/system/dict'

export interface DictItem {
  label: string
  value: string
}

/**
 * 字典取值与渲染：按类型标识拉取并缓存。
 * 用法：const { sys_user_gender } = useDict('sys_user_gender')
 * 模板：{{ dictLabel(sys_user_gender, row.gender) }}
 */
export function useDict(...types: string[]) {
  const dicts = reactive<Record<string, DictItem[]>>({})

  types.forEach((type) => {
    dicts[type] = []
    getDictByType(type).then((list) => {
      dicts[type] = list
    })
  })

  /** 按 value 取 label，取不到返回原值 */
  function dictLabel(list: DictItem[], value: unknown): string {
    const item = list.find((d) => d.value === String(value))
    return item?.label ?? String(value ?? '')
  }

  return { ...toRefs(dicts), dictLabel }
}
