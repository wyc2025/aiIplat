import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'
import { PageQueryDto } from '../../../common/dto/page-query.dto'

/**
 * siteId 作用域入参（P4E T61 多站点化）。
 *
 * 通用约定（API-P4E §10.3）：list/create 类端点以请求 siteId 为准（属主校验 40119）；
 * update/delete 类端点按实体 id 反查所属站点再校验属主，**不接受**请求里的 siteId，
 * 故 siteId 只出现在本 DTO 及其派生类（list query / create body）中。
 */
export class SiteIdDto {
  @ApiProperty({ description: '站点 ID（必带；不存在或非属主 → 40119）' })
  @Type(() => Number)
  @IsInt({ message: 'siteId 必须为整数' })
  @Min(1, { message: 'siteId 非法' })
  siteId!: number
}

/** 站点作用域分页查询基类（P4E T61：分页 + 必带 siteId；文章/评论列表用） */
export class SitePageQueryDto extends PageQueryDto {
  @ApiProperty({ description: '站点 ID（必带；不存在或非属主 → 40119）' })
  @Type(() => Number)
  @IsInt({ message: 'siteId 必须为整数' })
  @Min(1, { message: 'siteId 非法' })
  siteId!: number
}
