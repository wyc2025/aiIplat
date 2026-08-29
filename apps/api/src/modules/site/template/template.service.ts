import { Injectable, Logger } from '@nestjs/common'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dirent } from 'node:fs'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { SiteFacade, type SiteFileWriteResult } from '../facade/site-facade.service'
import type { ApplyTemplateDto } from './dto/template.dto'

/** 模板库资产目录（应用静态资产，读取用 fs；§15.7：实时读不缓存，模板由部署侧维护） */
const TEMPLATES_DIR = join(process.cwd(), 'assets', 'site-templates')

/**
 * 模板库（P4b F5/§15.7）：
 * - 列表：读 assets/site-templates 各子目录的 template.json，缺失或解析失败跳过并记运行日志；
 * - 应用：温和覆盖（R20/D23）——遍历模板文件（排除 template.json）经 SiteFacade.writeFiles
 *   批量写入（同路径软删旧版 + 新建，media/ 与模板外文件不动，写完 writeFiles 内部精确失效
 *   site:path 缓存）。不直接碰 StorageService（机械写入全在 SiteFacade → CloudFacade）。
 */
@Injectable()
export class SiteTemplateService {
  private readonly logger = new Logger(SiteTemplateService.name)

  constructor(private readonly siteFacade: SiteFacade) {}

  /** 模板列表 [{ id, name, description }]（id = 模板目录名） */
  async listTemplates(): Promise<Array<{ id: string; name: string; description: string }>> {
    let entries: Dirent[]
    try {
      entries = await readdir(TEMPLATES_DIR, { withFileTypes: true })
    } catch (error) {
      this.logger.error(`模板目录读取失败: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }

    const list: Array<{ id: string; name: string; description: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const raw = await readFile(join(TEMPLATES_DIR, entry.name, 'template.json'), 'utf-8')
        const meta = JSON.parse(raw) as { name?: string; description?: string }
        if (!meta.name) throw new Error('缺少 name 字段')
        list.push({ id: entry.name, name: meta.name, description: meta.description ?? '' })
      } catch (error) {
        // 目录无 template.json 或 JSON 解析失败 → 跳过并记运行日志（§15.7）
        this.logger.warn(
          `模板 ${entry.name} 的 template.json 缺失或格式错误，已跳过: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return list
  }

  /** 应用模板（温和覆盖），返回逐文件应用清单（含部分成功明细） */
  async applyTemplate(userId: bigint, dto: ApplyTemplateDto): Promise<SiteFileWriteResult[]> {
    // 未开通优先（§15.7 步骤 1 顺序：40101 先于 40116）
    const site = await this.siteFacade.getMySiteInfo(userId)
    if (!site) {
      throw new BusinessException(ErrorCode.SiteNotFound, '您尚未开通个人网站')
    }

    // 模板目录（templateId 已由 DTO 正则挡穿越字符；目录不存在 → 40116）
    const dir = join(TEMPLATES_DIR, dto.templateId)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      throw new BusinessException(ErrorCode.SiteTemplateNotFound, '模板不存在，请刷新模板列表')
    }

    // 收集模板文件（平铺四件套；排除 template.json）
    const files: Array<{ path: string; content: string }> = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === 'template.json') continue
      files.push({ path: entry.name, content: await readFile(join(dir, entry.name), 'utf-8') })
    }
    if (files.length === 0) {
      throw new BusinessException(ErrorCode.SiteTemplateNotFound, '模板不存在或内容为空')
    }

    // 写入经 SiteFacade.writeFiles（站点语义校验 + 机械写入 + 部分成功语义 + site:path 精确失效）
    return this.siteFacade.writeFiles(userId, files)
  }
}
