import { Injectable } from '@nestjs/common'
import type { Readable } from 'node:stream'
import { StorageService } from '../../../infra/storage/storage.service'

/** 快照轨命中结果 */
export interface ReleaseHit {
  /** 快照目录内相对路径（已确定为真实文件） */
  relPath: string
  size: number
  ext: string | null
  mtime: Date
}

/**
 * 站点快照轨解析（P19 T162 / D144 / D148 / R156 / R160）。
 *
 * 站点有当前版本（`site_site.active_release_id` 非空）时，开放层从
 * `site-releases/{siteId}/{releaseId}/` 出流——**不查云盘、不消费 `is_public`**（R161 权限平面解耦）。
 *
 * 三个刻意的实现取向：
 * 1. **解析方式与 legacy 轨一致**（真实文件 → `.html` → 目录 `index.html` → `spaFallback`）——
 *    快照目录不可变（R156）已保证一致性，重写回退链是纯风险无收益（D148）；
 * 2. **不写 `site:path` 缓存**——目录不可变，文件系统 `stat` 足够轻，省掉「按轨失效」的一致性面；
 * 3. **`.tmp-` 中转区对解析不可见**——发布用的是不同目录名（`.tmp-{id}`），
 *    且解析只接受 `resolveInside` 校验过的相对路径，任何探测都落 40400（R160）。
 */
@Injectable()
export class SiteReleaseTrackService {
  constructor(private readonly storage: StorageService) {}

  /** 快照目录相对路径（site-releases/{siteId}/{releaseId}） */
  dirOf(siteId: string, releaseId: string): string {
    return this.storage.releaseDirOf(siteId, releaseId)
  }

  /**
   * 按回退链在快照目录内解析路径；返回命中的真实文件（目录不算命中）。
   *
   * @param dir 快照目录相对路径
   * @param rawPath 原始请求路径（保留尾斜杠语义）
   * @param spaFallback 站点 SPA 回退入口（相对站点根；null = 不回退）
   */
  async resolve(
    dir: string,
    rawPath: string,
    spaFallback: string | null,
  ): Promise<ReleaseHit | null> {
    const normalized = this.normalize(rawPath)
    if (normalized === null) return null
    for (const candidate of this.candidates(normalized, rawPath, spaFallback)) {
      const stat = await this.storage.statInDir(dir, candidate)
      if (!stat || stat.isDir) continue
      return {
        relPath: candidate,
        size: stat.size,
        ext: this.extOf(candidate),
        mtime: stat.mtime,
      }
    }
    return null
  }

  /** 快照目录内文件流（Range 由调用方传） */
  stream(dir: string, relPath: string, range?: { start: number; end: number }): Readable {
    return this.storage.createDirReadStream(dir, relPath, range)
  }

  /** 回退候选序列（与 legacy 轨同口径：目录 → index.html；无扩展名 → .html → spaFallback → 目录 index.html） */
  private candidates(normalized: string, rawPath: string, spaFallback: string | null): string[] {
    if (normalized === '') return ['index.html']
    if (rawPath.endsWith('/')) return [`${normalized}/index.html`]
    const list = [normalized]
    const last = normalized.split('/').pop() ?? ''
    if (!/\.[A-Za-z0-9]{1,8}$/.test(last)) {
      list.push(`${normalized}.html`)
      if (spaFallback) list.push(spaFallback)
      list.push(`${normalized}/index.html`)
    }
    return list
  }

  /** 规范化（拒反斜杠 / `..` / 空段 / 超深；返回相对路径，非法 null） */
  private normalize(rawPath: string): string | null {
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath ?? '')
    } catch {
      return null
    }
    if (decoded.includes('\\')) return null
    // 首段 `api` 由控制器先行拦截（与 legacy 轨同一道双保险），此处只做结构校验
    const segments = decoded.split('/').filter((seg) => seg.length > 0 && seg !== '.')
    if (segments.some((seg) => seg === '..')) return null
    if (segments.length > 10) return null
    return segments.join('/')
  }

  private extOf(path: string): string | null {
    const name = path.split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : null
  }
}
