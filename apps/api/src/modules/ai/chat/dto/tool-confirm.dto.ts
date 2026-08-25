import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, Min } from 'class-validator'

/** 工具确认入参（SSE 流式返回总结） */
export class ToolConfirmDto {
  @ApiProperty({ description: '确认单 ID（tool_confirm 事件中的 toolCallId）' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toolCallId!: number

  @ApiProperty({ description: '是否批准执行' })
  @IsBoolean()
  approved!: boolean
}
