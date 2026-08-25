import { Body, Controller, Post, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { ChatService } from './chat.service'
import { ChatDto } from './dto/chat.dto'
import { ToolConfirmDto } from './dto/tool-confirm.dto'

/**
 * SSE 对话接口（统一响应格式的唯一例外，见 ARCHITECTURE §10）。
 * 登录即可（不挂 @RequirePermission，套餐校验由 CreditService 预检兜底）。
 * 前置校验失败走 GlobalExceptionFilter 统一 JSON；进入流式后 @Res() 原生写流。
 */
@ApiTags('AI 助手')
@ApiBearerAuth()
@Controller('ai')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat')
  @SkipTransform()
  @ApiOperation({ summary: '发送消息（SSE 流式，唯一跳过统一响应格式的接口）' })
  async chat(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.chatService.handleChat(user, dto, res)
  }

  @Post('tool/confirm')
  @SkipTransform()
  @ApiOperation({ summary: '工具确认（SSE 流式返回总结）' })
  async toolConfirm(
    @CurrentUser() user: AuthUser,
    @Body() dto: ToolConfirmDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.chatService.handleToolConfirm(user, dto, res)
  }
}
