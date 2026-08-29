import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisKey } from '../../../common/constants/redis-key'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import {
  CloudFacade,
  type RawWriteResult,
  type SubtreeEntry,
} from '../../cloud/facade/cloud-facade.service'

/**
 * 站点文本文件扩展名白名单（P4b §15.12：AI 三件套校验用，写死代码不进配置组；
 * 前端编辑器另维护同集显示条件，两边以架构增补 §15.12 为准对齐）。
 */
export const SITE_FILE_TEXT_EXTS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'txt',
  'md',
  'json',
  'svg',
  'xml',
  'yml',
  'yaml',
  'csv',
])

/** AI 写单文件上限 256KB（§15.12） */
export const AI_WRITE_MAX_FILE_BYTES = 256 * 1024
/** AI 单次写入文件数上限（§15.12；超过时模型应分批 write，每批一张确认卡） */
export const AI_WRITE_MAX_FILES = 10
/** AI 读文件上限 64KB（§15.12：同时是模型上下文护栏） */
export const AI_READ_MAX_BYTES = 64 * 1024

/** 当前用户的站点信息（rootFolderId 保持 bigint 供域内机械操作，出域序列化由调用方转字符串） */
export interface MySiteInfo {
  id: bigint
  slug: string
  title: string
  status: number
  rootFolderId: bigint
}

/** 站点文件清单结果（listFiles；null = 未开通站点，工具回喂 40101 引导） */
export interface SiteFileListResult {
  site: { slug: string; title: string; status: number }
  files: SubtreeEntry[]
  truncated: boolean
}

/** 单文件写入结果（writeFiles 逐项，部分成功语义 R18） */
export interface SiteFileWriteResult {
  path: string
  ok: boolean
  action?: 'created' | 'overwritten'
  size?: number
  error?: string
}

/** 站点读文件结果（UTF-8 解码后返回） */
export interface SiteFileReadResult {
  path: string
  size: number
  content: string
}

/** 从文件名提取小写扩展名（无扩展名返回 ''） */
function extOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * site 域门面：跨域（system/ai 等）只通过本门面与 site 交互，禁止直接 import 域内实现（域边界纪律）。
 * 封装：
 * - 删用户预检 hasSite（R13 / PRD-P4A D14）
 * - P4b 站点语义校验层（§15.3）：getMySiteInfo / invalidateSitePaths / listFiles / readFile / writeFiles。
 *   路径规范 / 文本白名单 / 大小与数量上限等站点语义校验全部收敛在本层，抛 site 段码
 *   （40101 / 40113~40115 / 40400）；机械执行（树遍历/读盘/行写入）在 CloudFacade 机械原语，
 *   cloud 段码（30001/30003/30006）在本层捕获转换（read → 40400；write → per-file error）。
 *   ai 域工具因此只需注入本门面，零跨域 import 内部实现。
 */
@Injectable()
export class SiteFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  /** 用户是否已开通站点（有 site_site 行即 true）；删除用户前预检，与 cloud hasFiles 并列 */
  async hasSite(userId: bigint): Promise<boolean> {
    const count = await this.prisma.siteSite.count({ where: { userId } })
    return count > 0
  }

  /** 当前用户的站点信息；未开通返回 null（工具层回喂 40101 引导文案，不抛出） */
  async getMySiteInfo(userId: bigint): Promise<MySiteInfo | null> {
    const site = await this.prisma.siteSite.findFirst({ where: { userId } })
    if (!site) return null
    return {
      id: site.id,
      slug: site.slug,
      title: site.title,
      status: site.status,
      rootFolderId: site.rootFolderId,
    }
  }

  /**
   * 精确失效站点路径解析缓存（§15.4）：对每个 path DEL `site:path:{siteId}:{path}`
   * （含可能存在的 "404" 负缓存）——AI/模板写入后访客立即可见，不等 60s TTL。
   * site 域自持 key 语义，cloud/ai 域不可见。
   */
  async invalidateSitePaths(siteId: bigint, paths: string[]): Promise<void> {
    const siteIdStr = siteId.toString()
    for (const p of paths) {
      await this.redis.client.del(RedisKey.sitePath(siteIdStr, p)).catch(() => undefined)
    }
  }

  /** 站点文件树（管理侧语义，属主视角，不做公开性判定）；null = 未开通站点 */
  async listFiles(userId: bigint): Promise<SiteFileListResult | null> {
    const site = await this.getMySiteInfo(userId)
    if (!site) return null
    const { files, truncated } = await this.cloudFacade.listSubtreeRaw(site.rootFolderId)
    return {
      site: { slug: site.slug, title: site.title, status: site.status },
      files,
      truncated,
    }
  }

  /**
   * 读站点文本文件（站点语义校验层）：
   * 未开通 40101 / 路径非法 40113 / 非白名单 40114 / 超过 64KB 40115 / 不存在或目录 40400。
   */
  async readFile(userId: bigint, path: string): Promise<SiteFileReadResult> {
    const site = await this.requireSite(userId)
    const normalized = this.normalizeSitePath(path)
    const ext = extOfName(normalized)
    if (!SITE_FILE_TEXT_EXTS.has(ext)) {
      throw new BusinessException(ErrorCode.SiteFileTypeNotAllowed, '文件类型不允许（仅文本白名单扩展名）')
    }

    // 机械读盘（cloud 段）：不存在/是目录（30001）→ 站点语义层统一 40400（分段归位 §15.3）
    let raw: { size: number; content: Buffer }
    try {
      raw = await this.cloudFacade.readFileRaw(site.rootFolderId, normalized)
    } catch (e) {
      throw this.toSiteError(e)
    }
    if (raw.size > AI_READ_MAX_BYTES) {
      throw new BusinessException(ErrorCode.SiteContentTooLarge, '文件超出读取上限（64KB）')
    }
    return { path: normalized, size: raw.size, content: raw.content.toString('utf-8') }
  }

  /**
   * 批量写站点文件（R18：逐文件独立成败，部分成功不整体回滚）：
   * - 批量约束：单次 ≤10 个（40115）
   * - 逐文件：路径规范（40113 → per-file error）/ 白名单（40114）/ 单文件 ≤256KB（40115）→
   *   CloudFacade.writeFileRaw 机械写入（30001/30003/30006 捕获为该文件 error）
   * - 同路径软删旧版 + 新建（回收站可回滚，D22）
   * - 全部完成后精确失效 ok 路径的 site:path 缓存（含负缓存）
   */
  async writeFiles(
    userId: bigint,
    files: Array<{ path: string; content: string }>,
  ): Promise<SiteFileWriteResult[]> {
    const site = await this.requireSite(userId)
    if (files.length === 0 || files.length > AI_WRITE_MAX_FILES) {
      throw new BusinessException(
        ErrorCode.SiteContentTooLarge,
        `单次最多写入 ${AI_WRITE_MAX_FILES} 个文件`,
      )
    }

    const results: SiteFileWriteResult[] = []
    for (const file of files) {
      // 站点语义校验（失败记为该项 error，不中断其余文件）
      let normalized: string
      try {
        normalized = this.normalizeSitePath(file.path)
      } catch (e) {
        results.push({ path: file.path, ok: false, error: (e as BusinessException).message })
        continue
      }
      const ext = extOfName(normalized)
      if (!SITE_FILE_TEXT_EXTS.has(ext)) {
        results.push({ path: normalized, ok: false, error: '文件类型不允许（仅文本白名单扩展名）' })
        continue
      }
      if (Buffer.byteLength(file.content, 'utf-8') > AI_WRITE_MAX_FILE_BYTES) {
        results.push({ path: normalized, ok: false, error: '内容超出单文件写入上限（256KB）' })
        continue
      }

      // 机械写入（cloud 段异常捕获为该文件 error，部分成功语义）
      try {
        const r: RawWriteResult = await this.cloudFacade.writeFileRaw(
          userId,
          site.rootFolderId,
          normalized,
          Buffer.from(file.content, 'utf-8'),
        )
        results.push({ path: normalized, ok: true, action: r.action, size: r.size })
      } catch (e) {
        if (e instanceof BusinessException) {
          results.push({ path: normalized, ok: false, error: e.message })
        } else {
          throw e
        }
      }
    }

    // 精确失效 ok 路径的 site:path 缓存（含负缓存）——AI 写完访客立即可见
    const okPaths = results.filter((r) => r.ok).map((r) => r.path)
    if (okPaths.length > 0) {
      await this.invalidateSitePaths(site.id, okPaths)
    }
    return results
  }

  /** 断言站点存在（未开通 40101，文案即引导口径），返回站点信息 */
  private async requireSite(userId: bigint): Promise<MySiteInfo> {
    const site = await this.getMySiteInfo(userId)
    if (!site) {
      throw new BusinessException(
        ErrorCode.SiteNotFound,
        '用户尚未开通个人网站，请引导其到「个人网站 → 站点设置」创建',
      )
    }
    return site
  }

  /** 站点路径规范化（R17）：拒绝对路径 / `..` / 空段 / 反斜杠 / 段超长（64 字符），返回规范相对路径 → 40113 */
  private normalizeSitePath(path: string): string {
    if (typeof path !== 'string' || path.length === 0) {
      throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法')
    }
    if (path.includes('\\')) {
      throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（禁止反斜杠）')
    }
    if (path.startsWith('/')) {
      throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（禁止绝对路径）')
    }
    const segments = path.split('/')
    for (const seg of segments) {
      if (seg.length === 0 || seg === '.' || seg === '..') {
        throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（含空段/./..）')
      }
      if (seg.length > 64) {
        throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（单段超长）')
      }
    }
    return segments.join('/')
  }

  /** cloud 段异常 → 站点语义层映射（30001 不存在/目录 → 40400；其余原样上抛） */
  private toSiteError(e: unknown): Error {
    if (e instanceof BusinessException && e.code === ErrorCode.CloudFileNotFound) {
      return new BusinessException(ErrorCode.NotFound, '文件不存在')
    }
    return e as Error
  }
}
