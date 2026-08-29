import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

/** 创建/编辑标签（unique(site_id, name)，重复 40108） */
export class SaveTagDto {
  @ApiProperty({ description: '标签名称（1~32 字）' })
  @IsString()
  @Length(1, 32, { message: '标签名称需 1~32 字' })
  name!: string
}
