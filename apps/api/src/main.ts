import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // 全局前缀 /api
  app.setGlobalPrefix('api')
  // CSP 会拦截 Swagger UI 资源，后端不渲染页面故关闭
  app.use(helmet({ contentSecurityPolicy: false }))
  // 开放层 CORP 改写（§14.5）：站点页面被 CSP sandbox 置于 opaque origin，其 style/js/img 等
  // no-cors 子资源一律按跨源校验，helmet 默认的 Cross-Origin-Resource-Policy: same-origin 会把它们
  // 全部拦截（站点停留在"加载中"），故 /api/open 响应改写为 cross-origin（与 CORS 反射 * 同口径）
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url?.startsWith('/api/open')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    }
    next()
  })
  // 信任代理头（R8/§14.12：开放层 IP 取值 X-Forwarded-For 首段；纯直连下与 socket 地址等价）
  app.set('trust proxy', true)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // 校验失败由 GlobalExceptionFilter 统一转为 40001
      exceptionFactory: (errors) => {
        const first = errors[0]
        const message = first?.constraints
          ? Object.values(first.constraints)[0]
          : '参数校验失败'
        return new BadRequestException(message)
      },
    }),
  )

  // CORS 函数式（§14.5）：路径以 /api/open 开头 → origin 反射为 *（opaque origin 下一切 fetch 均跨源，
  // 且允许 Content-Type 头——评论提交 application/json 会触发 preflight）；其余路径维持 CORS_ORIGINS 白名单。
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  app.enableCors((req: Request, callback: (err: Error | null, options: Record<string, unknown>) => void) => {
    const isOpenPath = req.url?.startsWith('/api/open') ?? false
    callback(null, {
      origin: isOpenPath ? '*' : corsOrigins.length > 0 ? corsOrigins : false,
      // 开放层放行自定义 Content-Type（评论提交 JSON preflight）；后台面维持默认
      ...(isOpenPath
        ? { allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'If-None-Match'] }
        : {}),
    })
  })

  // Swagger 接口文档：/api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('iplat API')
    .setDescription('iplat 后台管理底座接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
}

void bootstrap()
