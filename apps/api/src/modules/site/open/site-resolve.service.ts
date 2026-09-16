import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { RedisKey } from '../../../common/constants/redis-key'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'

/** slug 解析缓存 TTL（秒）：站点信息变化频率低，§14.9 约定 300s */
const RESOLVE_TTL_SEC = 300
/** 路径解析缓存 TTL（秒）：cloud 侧变更靠此被动失效，§14.4 R12 约定 60s */
const PATH_TTL_SEC = 60
/** 负缓存标记值 */
const NEGATIVE_CACHE = '404'

/** slug 解析结果（缓存值形态，id 以字符串序列化避免 bigint JSON 问题） */
export interface ResolvedSite {
  siteId: string
  /** 站点属主（P7 D73：内容池化后开放层按用户取内容） */
  userId: string
  rootFolderId: string
  status: number
  title: string
  description: string | null
  commentAudit: number
  /** SPA 回退入口（P7 D77：无扩展名路径回退时静态服务的入口文件；null = 不回退） */
  spaFallback: string | null
}

/** 路径解析结果 */
export type ResolvedPath =
  | { found: true; fileId: string }
  | { found: false }

/**
 * 开放层解析服务（架构增补 §14.4）：
 * - slug → 站点信息（Redis 缓存 300s，站点不存在/停用返回 null → 开放层统一 40400）
 * - 路径 → cloud_file id（Redis 缓存 60s + "404" 负缓存，防无效路径穿透 DB，D11）
 * 缓存写失败只记日志不阻断（降级为直查）。
 */
@Injectable()
export class SiteResolveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  /** 解析 slug → 站点信息；不存在或停用返回 null（开放层统一 40400，R10） */
  async resolveSite(slug: string): Promise<ResolvedSite | null> {
    const cacheKey = RedisKey.siteResolve(slug)
    const cached = await this.redis.client.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as ResolvedSite
    }

    const site = await this.prisma.siteSite.findFirst({ where: { slug } })
    if (!site || site.status !== 1) {
      // 站点不存在/停用不写缓存（避免缓存"未开通"状态导致开通后仍 404；停用由写操作主动失效）
      return null
    }

    const resolved: ResolvedSite = {
      siteId: site.id.toString(),
      userId: site.userId.toString(),
      rootFolderId: site.rootFolderId.toString(),
      status: site.status,
      title: site.title,
      description: site.description,
      commentAudit: site.commentAudit,
      spaFallback: site.spaFallback,
    }
    await this.redis.client
      .set(cacheKey, JSON.stringify(resolved), 'EX', RESOLVE_TTL_SEC)
      .catch(() => undefined)
    return resolved
  }

  /**
   * 解析站点内相对路径 → 文件 fileId（目录不算文件命中，交由 controller 走目录语义 R4）。
   * 命中缓存直接返回；未命中经 CloudFacade.resolvePublicPath（R2 上溯公开链校验），
   * 结果（含 "404" 负缓存）写 Redis 60s。
   */
  async resolvePath(siteId: string, rootFolderId: string, path: string): Promise<ResolvedPath> {
    const cacheKey = RedisKey.sitePath(siteId, path)
    const cached = await this.redis.client.get(cacheKey)
    if (cached === NEGATIVE_CACHE) return { found: false }
    if (cached) return { found: true, fileId: cached }

    const file = await this.cloudFacade.resolvePublicPath(BigInt(rootFolderId), path)

    // 路径完全不存在（非目录）：写 "404" 负缓存（D11 防无效路径穿透 DB）
    if (!file) {
      await this.redis.client.set(cacheKey, NEGATIVE_CACHE, 'EX', PATH_TTL_SEC).catch(() => undefined)
      return { found: false }
    }

    // 是目录：不算文件命中，且不写负缓存（目录下后续可能新增 index.html，缓存会挡住）
    if (file.isDir === 1) {
      return { found: false }
    }

    const fileId = file.id.toString()
    await this.redis.client.set(cacheKey, fileId, 'EX', PATH_TTL_SEC).catch(() => undefined)
    return { found: true, fileId }
  }

  /** 主动失效 slug→站点缓存（§14.3：改 slug/停用/启用/编辑站点信息后调用；新缓存随请求重建） */
  async invalidateSite(slug: string): Promise<void> {
    await this.redis.client.del(RedisKey.siteResolve(slug)).catch(() => undefined)
  }
}
