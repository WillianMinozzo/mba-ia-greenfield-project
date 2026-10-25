import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingReconciler } from './video-processing.reconciler';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should resolve the processor and reconciler without HTTP controllers', async () => {
    // compile() wires DI without running lifecycle hooks, so no worker starts consuming.
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
    expect(module.get(VideoProcessingReconciler)).toBeInstanceOf(
      VideoProcessingReconciler,
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, WorkerModule) ?? [],
    ).toEqual([]);
    await module.close();
  }, 30000);
});
