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
import { SLUG_PATTERN } from './dto/site.dto'
import type { CreateSiteDto, UpdateSiteDto } from './dto/site.dto'

/** slug 保留字黑名单（R11：与开放层路由段冲突的标识） */
const SLUG_BLACKLIST = new Set([
  'api', 'www', 'admin', 'manage', 'system', 'open', 'static', 'assets', 'public', 'login', 's', 'site',
])

/** 默认模板目录（应用静态资产，读取可用 fs；见架构增补 §14.1 纪律） */
const TEMPLATE_DIR = join(process.cwd(), 'assets', 'site-template')

/** 模板四件套（D16）：文件名 → 扩展名 / MIME */
const TEMPLATE_FILES = [
  { name: 'index.html', ext: 'html', mime: 'text/html' },
  { name: 'style.css', ext: 'css', mime: 'text/css' },
  { name: 'app.js', ext: 'js', mime: 'text/javascript' },
  { name: 'README.txt', ext: 'txt', mime: 'text/plain' },
] as const

/**
 * 站点设置（PRD F1 / 架构增补 §14.3）：
 * 创建 = slug 校验（R11）→ 云盘根建「我的站点」公开目录（重名自动"(1)"）→ media/ 子目录 →
 * 模板四件套复制（读 assets → StorageService 写正式区 → CloudFacade 登记 + used 记账）→ 落 site_site；
 * 任一步失败回滚（软删行 + 删物理文件 + used 回退）。编辑含改 slug（旧链接立即失效）与启停。
 */
@Injectable()
export class SiteManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudFacade: CloudFacade,
    private readonly resolveService: SiteResolveService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  /** 我的站点：未开通返回 null（前端引导创建） */
  async getMine(userId: bigint) {
    const site = await this.prisma.siteSite.findFirst({ where: { userId } })
    return site ? this.toSiteView(site) : null
  }

  /** 创建站点（一气呵成，失败回滚） */
  async create(userId: bigint, dto: CreateSiteDto) {
    // R11：slug 格式 + 保留字 → 40103
    this.assertSlugValid(dto.slug)
    // slug 全局唯一 → 40102
    const slugTaken = await this.prisma.siteSite.findFirst({ where: { slug: dto.slug } })
    if (slugTaken) {
      throw new BusinessException(ErrorCode.SiteSlugTaken, '该 slug 已被其他站点占用')
    }
    // 单站约束 → 40101（已开通）
    const existing = await this.prisma.siteSite.findFirst({ where: { userId } })
    if (existing) {
      throw new BusinessException(ErrorCode.SiteNotFound, '您已开通个人网站，无需重复创建')
    }

    // 建站点根目录（用户云盘根，公开，重名自动"(1)"）
    const root = await this.cloudFacade.createFolder(userId, BigInt(0), '我的站点', true)
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
      return this.toSiteView(site)
    } catch (error) {
      // §14.3 第 5 步：任一步失败回滚，不留半成品（行软删 + 物理删除 + used 回退）
      await this.cloudFacade.discardSiteDraft(userId, drafts)
      throw error
    }
  }

  /** 编辑站点（标题/描述/slug/状态/评论开关）；变更后主动失效 slug 解析缓存 */
  async update(userId: bigint, dto: UpdateSiteDto) {
    const site = await this.prisma.siteSite.findFirst({ where: { userId } })
    if (!site) {
      throw new BusinessException(ErrorCode.SiteNotFound, '站点不存在或未开通')
    }

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
    return this.toSiteView(updated)
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

  /** site_site 行 → 前端形态（API.md §6.2：siteUrl = /api/open/{slug}/） */
  private toSiteView(site: {
    id: bigint
    slug: string
    title: string
    description: string | null
    status: number
    commentAudit: number
    rootFolderId: bigint
    mediaFolderId: bigint
    createTime: Date
  }) {
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
      createdAt: site.createTime,
    }
  }
}
