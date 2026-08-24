import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator'

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
}
