import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import { QueueModule } from '../queue/queue.module';
import { VideoProcessingQueueModule } from './video-processing-queue.module';
import { VideoProcessingPublisher } from './video-processing.publisher';

describe('VideoProcessingQueueModule', () => {
  it('should compile and expose VideoProcessingPublisher', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
        VideoProcessingQueueModule,
      ],
    }).compile();

    expect(module.get(VideoProcessingPublisher)).toBeInstanceOf(
      VideoProcessingPublisher,
    );
    await module.close();
  });
});
