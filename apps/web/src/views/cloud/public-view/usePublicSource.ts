import type { PubFileInfo, PubFolderList } from '@/types/api'
import {
  pubDownloadUrl,
  pubFileInfo,
  pubFolderList,
  pubRawUrl,
  pubSubFileInfo,
} from '@/api/cloud/public'
import {
  fetchSharePack,
  shareDownloadUrl,
  shareFolderList,
  shareInfo,
  shareRawUrl,
} from '@/api/cloud/share-public'

/**
 * 公开内容数据源适配层（P4d D46）：`{ kind, token, sid? }` → 统一 info/list/raw/download 取数。
 * 两种寻址共用同一套渲染组件（FileView / FolderView），实现「语义分、体验不分」：
 * - pub：P4c 公开链接（/api/pub/f|d/{token}…，长期 + 文件自身属性）
 * - share：分享链接（/api/cloud/share/{token}…，有效期 + 计次 + 可停止 + 可提取码）
 */
export type PublicSourceKind = 'pub' | 'share'

export interface PublicSource {
  kind: PublicSourceKind
  /** 页面标题（分享文件夹取源文件夹名；公开页用固定文案） */
  title: string
  /** 文件/文件夹元信息（path 缺省 = 源自身） */
  fileInfo(path?: string): Promise<PubFileInfo>
  /** 单层列表（仅文件夹有意义） */
  folderList(path?: string): Promise<PubFolderList>
  rawUrl(path?: string): string
  downloadUrl(path?: string): string
  /** 整包下载（仅分享的文件夹提供，D48）；fetch + Blob，错误可提示 */
  loadPack?: () => Promise<Blob>
}

export function createPublicSource(opts: {
  kind: PublicSourceKind
  token: string
  sid?: string
  title?: string
}): PublicSource {
  const { token, sid } = opts
  if (opts.kind === 'pub') {
    return {
      kind: 'pub',
      title: opts.title ?? '文件夹浏览',
      fileInfo: (path) => (path ? pubSubFileInfo(token, path) : pubFileInfo(token)),
      folderList: (path) => pubFolderList(token, path),
      rawUrl: (path) => pubRawUrl(token, path),
      downloadUrl: (path) => pubDownloadUrl(token, path),
    }
  }
  return {
    kind: 'share',
    title: opts.title ?? '分享内容',
    // 分享信息响应与 pub 元信息形态不同，此处归一化为 PubFileInfo（复用渲染组件）
    fileInfo: async (path) => {
      const info = await shareInfo(token, sid, path)
      return {
        name: info.fileName,
        size: Number(info.size),
        mime: info.mime ?? '',
        ext: info.ext ?? '',
        updatedAt: info.updatedAt,
      }
    },
    folderList: async (path) => {
      const res = await shareFolderList(token, sid, path)
      return { path: res.path, items: res.items }
    },
    rawUrl: (path) => shareRawUrl(token, sid, path),
    downloadUrl: (path) => shareDownloadUrl(token, sid, path),
    loadPack: () => fetchSharePack(token, sid),
  }
}
