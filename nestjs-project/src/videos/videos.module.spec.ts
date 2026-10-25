import { createVideoTestingModule } from '../test/video-test-module';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile with storage, channels and the processing queue wired', async () => {
    const module = await createVideoTestingModule([VideosModule]);

    expect(module.get(VideosService)).toBeInstanceOf(VideosService);
    await module.close();
  }, 30000);
});
