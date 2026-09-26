import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'

/** 市场条目类型（审核三动作） */
export type ReviewAction = 'approve' | 'reject' | 'delist'

/** 审核动作（POST /api/market/review/:id，API §20.1 审核侧） */
export class ReviewListingDto {
  @ApiProperty({
    description: 'approve = 通过上架；reject = 拒绝（必填 note）；delist = 下架（仅在架条目）',
    enum: ['approve', 'reject', 'delist'],
  })
  @IsIn(['approve', 'reject', 'delist'], { message: "action 仅允许 'approve' / 'reject' / 'delist'" })
  action!: ReviewAction

  @ApiPropertyOptional({ description: '审核意见（拒绝时必填，≤500 字）' })
  @IsOptional()
  @IsString()
  @Length(1, 500, { message: '审核意见需 1~500 字' })
  note?: string
}
