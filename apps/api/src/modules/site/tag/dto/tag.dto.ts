import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'
import { SiteIdDto } from '../../dto/site-id.dto'

/** 标签列表查询（P4E T61：必带 siteId，属主校验 40119） */
export class TagQueryDto extends SiteIdDto {}

/** 创建标签（P4E T61：body 带 siteId；unique(site_id, name)，重复 40108） */
export class CreateTagDto extends SiteIdDto {
  @ApiProperty({ description: '标签名称（1~32 字）' })
  @IsString()
  @Length(1, 32, { message: '标签名称需 1~32 字' })
  name!: string
}

/** 编辑标签（属主按实体反查，不接受请求 siteId） */
export class SaveTagDto {
  @ApiProperty({ description: '标签名称（1~32 字）' })
  @IsString()
  @Length(1, 32, { message: '标签名称需 1~32 字' })
  name!: string
}
