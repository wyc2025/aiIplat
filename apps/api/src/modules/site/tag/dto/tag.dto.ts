import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'
/** 标签列表查询（P7 D73：归用户，不再带 siteId） */
export class TagQueryDto {}

/** 创建标签（P7 D73：归用户；unique(user_id, name)，重名 40108） */
export class CreateTagDto {
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
