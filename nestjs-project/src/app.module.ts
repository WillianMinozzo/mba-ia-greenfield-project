import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CONFIG_MODULE_OPTIONS } from './config/config-module.options';
import { TYPEORM_MODULE_OPTIONS } from './database/typeorm-module.options';
import { QueueModule } from './queue/queue.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    ConfigModule.forRoot(CONFIG_MODULE_OPTIONS),
    TypeOrmModule.forRootAsync(TYPEORM_MODULE_OPTIONS),
    QueueModule,
    AuthModule,
    VideosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
