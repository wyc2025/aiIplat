import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // 全局前缀 /api
  app.setGlobalPrefix('api')
  // CSP 会拦截 Swagger UI 资源，后端不渲染页面故关闭
  app.use(helmet({ contentSecurityPolicy: false }))
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

  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : false })

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
