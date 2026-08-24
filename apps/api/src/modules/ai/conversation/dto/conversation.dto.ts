import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator'
import { PageQueryDto } from '../../../../common/dto/page-query.dto'

/** 会话分页查询（只查本人会话，条件由登录态决定，无需额外过滤条件） */
export class ConversationQueryDto extends PageQueryDto {}

/** 更新会话：重命名（title）/ 切换模型（modelId），至少传一项 */
export class UpdateConversationDto {
  @ApiPropertyOptional({ description: '会话标题（1~50 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '标题长度需在 1~50 字之间' })
  title?: string

  @ApiPropertyOptional({ description: '切换后的模型 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  modelId?: number
}
