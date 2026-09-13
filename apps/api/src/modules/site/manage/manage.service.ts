import { Injectable } from '@nestjs/common'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { SiteResolveService } from '../open/site-resolve.service'
import { SiteQuotaService } from '../quota/quota.service'
import { SLUG_PATTERN } from './dto/site.dto'
import type { CreateSiteDto, UpdateSiteDto } from './dto/site.dto'

/** slug 保留字黑名单（R11：与开放层路由段冲突的标识） */
const SLUG_BLACKLIST = new Set([
  'api', 'www', 'admin', 'manage', 'system', 'open', 'static', 'assets', 'public', 'login', 's', 'site',
])

/** 建站默认模板目录（P4b T44 迁移：assets/site-template → assets/site-templates/default，§15.7） */
const TEMPLATE_DIR = join(process.cwd(), 'assets', 'site-templates', 'default')

/** 模板四件套（D16）：文件名 → 扩展名 / MIME */
const TEMPLATE_FILES = [
  { name: 'index.html', ext: 'html', mime: 'text/html' },
  { name: 'style.css', ext: 'css', mime: 'text/css' },
  { name: 'app.js', ext: 'js', mime: 'text/javascript' },
  { name: 'README.txt', ext: 'txt', mime: 'text/plain' },
] as const

/** 站点对外视图（API-P4E §10.2 list item；bigint 一律转字符串出域） */
export interface SiteView {
  id: string
  slug: string
  title: string
  description: string | null
  status: number
  commentAudit: number
  siteUrl: string
  rootFolderId: string
  mediaFolderId: string
  articleCount: number
  createdAt: Date
}

/**
 * 站点 CRUD（PRD-P4E F1 / API-P4E §10.2；原「我的站点（mine 系列）」多站化改造 T60）：
 * - list：我的站点集合（不分页，上限即配额）+ `{ limit, used }`；
 * - create：配额校验（40118，R47）→ slug 格式/保留字（40103）+ 全局唯一（40102）→ 云盘骨架
 *   （根目录名 = slug，D57）→ media/ 子目录 → 模板四件套 → 落 site_site；任一步失败回滚
 *   （discardSiteDraft：软删行 + 删物理文件 + used 回退）；
 * - detail/update/delete：一律属主校验（40119，不暴露他人站点存在性）；
 * - delete（R50/R53/R55）：site 域六表物理删 → CloudFacade.removeSiteRoot（软删进回收站，used 不动，
 *   绕过 R52 用户面保护）→ 缓存三族清理 → slug 立即释放。
 */
@Injectable()
export class SiteManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudFacade: CloudFacade,
    private readonly resolveService: SiteResolveService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly quota: SiteQuotaService,
  ) {}

  /** 我的站点列表（不分页，上限即配额）+ 配额视图 */
  async list(userId: bigint) {
    const sites = await this.prisma.siteSite.findMany({
      where: { userId },
      orderBy: [{ createTime: 'asc' }, { id: 'asc' }],
    })
    const counts = await this.prisma.siteArticle.groupBy({
      by: ['siteId'],
      where: { siteId: { in: sites.map((s) => s.id) } },
      _count: { _all: true },
    })
    const countMap = new Map(counts.map((c) => [c.siteId.toString(), c._count._all]))
    const { limit, used } = await this.quota.getQuota(userId)
    return {
      list: sites.map((site) => this.toSiteView(site, countMap.get(site.id.toString()) ?? 0)),
      limit,
      used,
    }
  }

  /** 站点详情（属主校验 40119；含 articleCount） */
  async detail(userId: bigint, siteId: bigint) {
    const site = await this.getOwnedSite(userId, siteId)
    const articleCount = await this.prisma.siteArticle.count({ where: { siteId: site.id } })
    return this.toSiteView(site, articleCount)
  }

  /** 创建站点（配额 → slug 校验 → 云盘骨架 + 模板，一气呵成，失败回滚） */
  async create(userId: bigint, dto: CreateSiteDto) {
    // R47 配额校验（单点：手动建站与 AI create_site 共用本方法，D55）
    await this.quota.checkCanCreate(userId)
    // R11：slug 格式 + 保留字 → 40103
    this.assertSlugValid(dto.slug)
    // slug 全局唯一 → 40102
    const slugTaken = await this.prisma.siteSite.findFirst({ where: { slug: dto.slug } })
    if (slugTaken) {
      throw new BusinessException(ErrorCode.SiteSlugTaken, '该 slug 已被其他站点占用')
    }

    // 建站点根目录（用户云盘根，公开；目录名 = slug，D57 天然免「我的站点(1)」）
    const root = await this.cloudFacade.createFolder(userId, BigInt(0), dto.slug, true)
    // 回滚清单：已建的 cloud_file 行（软删）+ 已写的物理文件（删除）+ used 回退
    const drafts: Array<{ id: bigint; storageName: string | null; size: bigint }> = [
      { id: root.id, storageName: null, size: BigInt(0) },
    ]
    try {
      // media/ 子目录（公开性沿根目录上溯语义，无需单标）
      const media = await this.cloudFacade.createFolder(userId, root.id, 'media')
      drafts.push({ id: media.id, storageName: null, size: BigInt(0) })

      // 模板复制：读 assets 四文件 → 写正式区 → 登记 cloud_file + used 记账
      // is_public 不置（默认 0=继承站点根的公开，R2 三态语义；创建时打标已随三态模型撤销）
      for (const template of TEMPLATE_FILES) {
        const content = await readFile(join(TEMPLATE_DIR, template.name))
        const storageName = await this.storage.writeFromBuffer(content, template.ext)
        const created = await this.cloudFacade.registerPublicFile(userId, root.id, template.name, {
          size: BigInt(content.length),
          ext: template.ext,
          mime: template.mime,
          storageName,
        })
        drafts.push({ id: created.id, storageName, size: BigInt(content.length) })
      }

      // 落 site_site 行
      const site = await this.prisma.siteSite.create({
        data: {
          userId,
          slug: dto.slug,
          title: dto.title,
          description: dto.description || null,
          rootFolderId: root.id,
          mediaFolderId: media.id,
        },
      })
      return this.toSiteView(site, 0)
    } catch (error) {
      // §14.3 第 5 步：任一步失败回滚，不留半成品（行软删 + 物理删除 + used 回退）
      await this.cloudFacade.discardSiteDraft(userId, drafts)
      throw error
    }
  }

  /** 编辑站点（标题/描述/slug/状态/评论开关）；变更后主动失效 slug 解析缓存 */
  async update(userId: bigint, siteId: bigint, dto: UpdateSiteDto) {
    const site = await this.getOwnedSite(userId, siteId)

    const data: {
      title?: string
      description?: string | null
      slug?: string
      status?: number
      commentAudit?: number
    } = {}
    if (dto.title !== undefined) data.title = dto.title
    if (dto.description !== undefined) data.description = dto.description || null
    if (dto.status !== undefined) data.status = dto.status
    if (dto.commentAudit !== undefined) data.commentAudit = dto.commentAudit
    if (dto.slug !== undefined && dto.slug !== site.slug) {
      // R11：同创建口径校验（40103/40102，排除自身）
      this.assertSlugValid(dto.slug)
      const slugTaken = await this.prisma.siteSite.findFirst({
        where: { slug: dto.slug, id: { not: site.id } },
      })
      if (slugTaken) {
        throw new BusinessException(ErrorCode.SiteSlugTaken, '该 slug 已被其他站点占用')
      }
      data.slug = dto.slug
    }

    const updated = await this.prisma.siteSite.update({ where: { id: site.id }, data })

    // 缓存失效（R12/D12）：resolve 缓存含 status/title/description/commentAudit，任何编辑都需失效；
    // 改 slug 时旧 slug 缓存一并失效（旧链接立即全断，新 slug 缓存随请求重建），
    // 且开放数据缓存（coverUrl 内嵌 slug）需 scanDel 失效
    await this.resolveService.invalidateSite(site.slug)
    if (data.slug && data.slug !== site.slug) {
      await this.resolveService.invalidateSite(data.slug)
      await this.redis.scanDel(`site:data:${site.id.toString()}:*`).catch(() => undefined)
    }
    const articleCount = await this.prisma.siteArticle.count({ where: { siteId: site.id } })
    return this.toSiteView(updated, articleCount)
  }

  /**
   * 删站（R50/R53/R55）：
   * site 域六表物理删（R7 传统，无回收站）→ 站点根连同子树软删进回收站（used 不动，可还原为普通文件夹）
   * → 缓存三族清理 → slug 立即释放（R49）。
   * 响应 `{ deletedArticles, recycledRoot }` 供前端结果提示。
   */
  async remove(userId: bigint, siteId: bigint) {
    const site = await this.getOwnedSite(userId, siteId)
    const deletedArticles = await this.prisma.siteArticle.count({ where: { siteId: site.id } })

    // 物理删（顺序：评论 → 文章-标签 → 文章 → 标签 → 栏目 → 站点；R7 无软删）
    await this.prisma.$transaction([
      this.prisma.siteComment.deleteMany({ where: { siteId: site.id } }),
      this.prisma.siteArticleTag.deleteMany({ where: { article: { siteId: site.id } } }),
      this.prisma.siteArticle.deleteMany({ where: { siteId: site.id } }),
      this.prisma.siteTag.deleteMany({ where: { siteId: site.id } }),
      this.prisma.siteColumn.deleteMany({ where: { siteId: site.id } }),
      this.prisma.siteSite.delete({ where: { id: site.id } }),
    ])

    // 站点根软删进回收站（R53 内部通道，绕过 R52；used 不动，可还原为普通文件夹 R54）
    await this.cloudFacade.removeSiteRoot(userId, site.rootFolderId)

    // 缓存三族清理（R55）：resolve（slug）+ path/data（siteId）
    await this.resolveService.invalidateSite(site.slug)
    await this.redis.scanDel(`site:path:${site.id.toString()}:*`).catch(() => undefined)
    await this.redis.scanDel(`site:data:${site.id.toString()}:*`).catch(() => undefined)

    return { deletedArticles, recycledRoot: true }
  }

  /** 站点数配额视图（供 AI create_site 回喂 limit/used，P4E R57/D55） */
  async getQuota(userId: bigint) {
    return this.quota.getQuota(userId)
  }

  /** admin 查询某用户站点配额（照 cloud admin 先例直读 sys_user，不跨域 import system 模块） */
  async adminGetQuota(targetUserId: string) {
    const id = await this.assertUserExists(targetUserId)
    const { limit, used } = await this.quota.getQuota(id)
    return { userId: id.toString(), limit, used }
  }

  /** admin 调整某用户站点配额（R48：下限 = 该用户当前站点数；懒创建 upsert） */
  async adminUpdateQuota(targetUserId: string, limit: number) {
    const id = await this.assertUserExists(targetUserId)
    const result = await this.quota.adminUpdate(id, limit)
    return { userId: id.toString(), limit: result.limit, used: result.used }
  }

  /** 属主站点（P4E：不存在/非属主一律 40119，不暴露他人站点存在性） */
  async getOwnedSite(userId: bigint, siteId: bigint) {
    const site = await this.prisma.siteSite.findFirst({ where: { id: siteId, userId } })
    if (!site) {
      throw new BusinessException(ErrorCode.SiteForbidden, '站点不存在或非属主')
    }
    return site
  }

  /** 目标用户存在性（admin 端点；直接读库，不跨域 import system 模块） */
  private async assertUserExists(targetUserId: string): Promise<bigint> {
    const id = BigInt(targetUserId)
    const user = await this.prisma.sysUser.findUnique({ where: { id }, select: { id: true } })
    if (!user) {
      throw new BusinessException(ErrorCode.NotFound, '目标用户不存在')
    }
    return id
  }

  /** R11 slug 校验：格式正则 + 保留字黑名单 → 40103 */
  private assertSlugValid(slug: string): void {
    if (!SLUG_PATTERN.test(slug) || SLUG_BLACKLIST.has(slug)) {
      throw new BusinessException(
        ErrorCode.SiteSlugInvalid,
        'slug 需为 3~32 位小写字母/数字/连字符（字母或数字开头），且不得使用系统保留字',
      )
    }
  }

  /** site_site 行 → 前端形态（API-P4E §10.2：siteUrl = /api/open/{slug}/） */
  private toSiteView(
    site: {
      id: bigint
      slug: string
      title: string
      description: string | null
      status: number
      commentAudit: number
      rootFolderId: bigint
      mediaFolderId: bigint
      createTime: Date
    },
    articleCount: number,
  ): SiteView {
    return {
      id: site.id.toString(),
      slug: site.slug,
      title: site.title,
      description: site.description,
      status: site.status,
      commentAudit: site.commentAudit,
      siteUrl: `/api/open/${site.slug}/`,
      rootFolderId: site.rootFolderId.toString(),
      mediaFolderId: site.mediaFolderId.toString(),
      articleCount,
      createdAt: site.createTime,
    }
  }
}
