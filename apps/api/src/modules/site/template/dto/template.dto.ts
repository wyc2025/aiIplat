import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

/** 应用模板（P4b F5/§15.7）：templateId 即模板目录名，正则挡路径穿越字符（../、分隔符等） */
export class ApplyTemplateDto {
  @ApiProperty({ description: '模板 ID（模板目录名，GET /api/site/templates 返回）' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, { message: '模板 ID 非法' })
  templateId!: string
}
