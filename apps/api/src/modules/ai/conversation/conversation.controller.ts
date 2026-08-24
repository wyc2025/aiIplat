import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { ConversationService } from './conversation.service'
import { ConversationQueryDto, UpdateConversationDto } from './dto/conversation.dto'

/** AI 会话与消息（用户自服务，只操作本人数据，不挂 @RequirePermission） */
@ApiTags('AI 助手')
@ApiBearerAuth()
@Controller('ai/conversation')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  @ApiOperation({ summary: '会话分页列表' })
  page(@CurrentUser('userId') userId: string, @Query() query: ConversationQueryDto) {
    return this.conversationService.page(BigInt(userId), query)
  }

  @Put(':id')
  @OperationLog('AI 对话', '重命名会话或切换模型')
  @ApiOperation({ summary: '重命名会话 / 切换模型' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversationService.update(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id')
  @OperationLog('AI 对话', '删除会话')
  @ApiOperation({ summary: '删除会话（软删，消息级联软删）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.conversationService.remove(BigInt(userId), BigInt(id))
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '消息列表（最近 50 条，正序）' })
  messages(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.conversationService.messages(BigInt(userId), BigInt(id))
  }
}
