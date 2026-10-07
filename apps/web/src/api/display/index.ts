import { del, get, post, put } from '@/utils/request'

/**
 * 展示应用 API 客户端（P14 T128，API-P14 §21.1-1~6）。
 *
 * 展示应用 = AI 生成的静态展示页（HTML/CSS/JS）容器：可挂靠到站点（开放层 `disp/{id}/` 对外访问），
 * 数据读取需把数据应用**授权**给它（授权两跳：数据应用 → 展示应用 → 挂靠站点）。
 */
export interface DisplayItem {
  id: string
  name: string
  siteId: string | null
  siteSlug: string | null
  siteTitle: string | null
  /** 挂靠态 = 站点内相对路径；未挂靠 = 云盘暂存区路径 */
  folderPath: string
  /** 写文件用路径（相对云盘根；AI 写页面文件用） */
  writePath: string
  /** 挂靠后的开放层入口（未挂靠为 null） */
  urlPreview: string | null
  grantCount: number
  grants: Array<{ appId: string; appCode: string }>
  createdAt: string
  /**
   * 展示应用云盘目录节点 id（**仅列表接口返回**）：未挂靠（暂存区）或挂靠后目录尚未创建时为 null。
   * 卡片「打开云盘目录」按钮经 `?dir={folderId}` 直达该目录。
   */
  folderId: string | null
  /** 挂靠站点根目录 id（仅列表返回；未挂靠为 null）——目录尚未创建时退回跳站点根 */
  siteRootFolderId: string | null
  /**
   * 访客是否已可见（仅列表返回）：挂靠且内容已进站点当前发布快照。
   * false = 未挂靠或未发布——访客打不开链接，需「发布到站点」后生效。
   */
  published: boolean
}

/** 我的展示应用列表（含挂靠站点与授权清单） */
export const listDisplays = () => get<DisplayItem[]>('/display')

/** 创建展示应用（siteSlug 缺省 → 云盘暂存区；重名 50018） */
export const createDisplay = (payload: { name: string; siteSlug?: string }) =>
  post<DisplayItem>('/display', payload)

/** 挂靠 / 换挂靠 / 取消挂靠（目录移动与挂靠关系同事务语义；中断全回滚，R127） */
export const affiliateDisplay = (id: string, siteSlug: string | null) =>
  put<DisplayItem & { moved: boolean }>(`/display/${id}/affiliate`, { siteSlug })

/** 软删展示应用（清授权边；目录保留于云盘由用户处置） */
export const deleteDisplay = (id: string) => del(`/display/${id}`)

/** 授权数据应用（重复授权 50017；应用未发布时返回 isPublic=0 供界面提示） */
export const grantDisplay = (id: string, appCode: string) =>
  post<{ ok: true; displayId: string; appCode: string; appName: string; isPublic: number }>(
    `/display/${id}/grants`,
    { appCode },
  )

/** 撤销授权（授权不存在 50017） */
export const revokeDisplay = (id: string, appCode: string) =>
  del(`/display/${id}/grants/${appCode}`)

/**
 * 版本检查点（P20 T167 / API §28.3）。
 *
 * 定位是**存档**而非上线：把当前页面内容存成一个可回退的版本，随时恢复到工作区。
 * 与站点发布分治——展示页不必随站点发布；对外访问仍由站点版本决定。
 */
export interface DisplayReleaseItem {
  id: string
  versionNo: number
  label: string | null
  fileCount: number
  totalBytes: string
  pinned: boolean
  createdBy: string
  createTime: string
}

/** 版本列表（新 → 旧） */
export const listDisplayReleases = (id: string) =>
  get<DisplayReleaseItem[]>(`/display/${id}/releases`)

/** 把当前页面内容保存为一个版本（还没有页面文件 → 40001；正在保存 → 50022） */
export const saveDisplayRelease = (id: string, label?: string) =>
  post<DisplayReleaseItem>(`/display/${id}/releases`, { label })

/**
 * 恢复到工作区：现有内容先软删进回收站，再写回该版本。
 * 恢复错了可从云盘回收站撤回，所以这是一个**可反悔**的操作。
 */
export const restoreDisplayRelease = (id: string, releaseId: string) =>
  post<{ ok: true; restoredFiles: number; removedFiles: number }>(
    `/display/${id}/releases/${releaseId}/restore`,
    {},
  )

/** 锁定 / 解锁版本（锁定后豁免删除） */
export const pinDisplayRelease = (id: string, releaseId: string, pinned: boolean) =>
  put<DisplayReleaseItem>(`/display/${id}/releases/${releaseId}/pin`, { pinned })

/** 删除版本（已锁定的需先解锁，否则 50022） */
export const deleteDisplayRelease = (id: string, releaseId: string) =>
  del(`/display/${id}/releases/${releaseId}`)
