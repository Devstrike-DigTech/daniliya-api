import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  // rawBody: keep the unparsed buffer available (req.rawBody) so payment
  // webhooks can verify HMAC signatures against the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);
  const isProd = configService.get('NODE_ENV') === 'production';

  app.use(helmet());

  // CORS_ORIGIN is a comma-separated list — the five portals run on their own
  // ports locally (3000 web, 3001 affiliate, 3002 influencer, 3003 vendor,
  // 3004 admin) and on their own domains in production.
  const origins = (configService.get<string>('CORS_ORIGIN') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length === 1 ? origins[0] : origins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  app.setGlobalPrefix('api/v1');

  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Daniliya API')
      .setDescription('Daniliya Multi-Business & Affiliate Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port);
  console.log(`Daniliya API running on port ${port}`);
}

bootstrap();
