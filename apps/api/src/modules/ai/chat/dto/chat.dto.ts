import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator'

/** 附件入参（P10 D82/D84）：云盘文件 id；本地上传先走既有 upload 接口落 /ai-attachments/ 再取 id */
export class ChatAttachmentDto {
  @ApiProperty({ description: '云盘文件 ID（字符串，避免 bigint 精度丢失）' })
  @IsString()
  @Length(1, 32, { message: '附件 fileId 非法' })
  fileId!: string
}

/** 发送消息入参（SSE 流式） */
export class ChatDto {
  @ApiPropertyOptional({ description: '会话 ID；为空表示新会话首条消息，此时 modelId 必填' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number

  @ApiPropertyOptional({ description: '模型 ID；新会话首条消息必填，已有会话时忽略（用会话当前模型）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  modelId?: number

  @ApiProperty({ description: '用户消息文本' })
  @IsString()
  @Length(1, 100000, { message: '消息内容不能为空' })
  content!: string

  @ApiPropertyOptional({
    description: '附件列表（≤5 个/条消息）；消费方式（全文注入 / 清单自读）由后端按 D83 分流，对前端透明',
    type: [ChatAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: '单条消息附件不能超过 5 个' })
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  attachments?: ChatAttachmentDto[]
}
