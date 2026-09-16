import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'
import { PageQueryDto } from '../../../common/dto/page-query.dto'

/**
 * siteId 作用域入参（P4E T61 多站点化；P7 D73 起仅「按站隔离」的实体沿用，如评论）。
 *
 * P7 内容池化后（D73/R76）：文章/栏目/标签改**用户级**作用域（见 UserPageQueryDto），
 * 站点只是展示窗口；评论按站隔离（D75）仍以 siteId 为准。
 * update/delete 类端点按实体 id 反查属主，**不接受**请求里的 siteId。
 */
export class SiteIdDto {
  @ApiProperty({ description: '站点 ID（必带；不存在或非属主 → 40119）' })
  @Type(() => Number)
  @IsInt({ message: 'siteId 必须为整数' })
  @Min(1, { message: 'siteId 非法' })
  siteId!: number
}

/** 站点作用域分页查询基类（P4E T61：分页 + 必带 siteId；P7 起仅评论列表沿用，D75 按站隔离） */
export class SitePageQueryDto extends PageQueryDto {
  @ApiProperty({ description: '站点 ID（必带；不存在或非属主 → 40119）' })
  @Type(() => Number)
  @IsInt({ message: 'siteId 必须为整数' })
  @Min(1, { message: 'siteId 非法' })
  siteId!: number
}

/**
 * 用户级分页查询基类（P7 D73/R76）：内容池化后文章/栏目/标签归用户所有，
 * 列表不再必带 siteId（站点降为可选筛选：按「已发表到该站」过滤）。
 */
export class UserPageQueryDto extends PageQueryDto {}
