import { FfmpegRunner } from './ffmpeg-runner';
import { FfmpegRunError } from './media.errors';

// Uses `node` as a stand-in binary: deterministic exit codes, stderr and timing without media.
describe('FfmpegRunner', () => {
  const runner = new FfmpegRunner();

  it('should resolve with stdout when the process exits 0', async () => {
    const result = await runner.run(
      process.execPath,
      ['-e', 'process.stdout.write("ok")'],
      5000,
    );

    expect(result.stdout).toBe('ok');
  });

  it('should reject with the exit code and stderr when the process fails', async () => {
    const promise = runner.run(
      process.execPath,
      ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      5000,
    );

    await expect(promise).rejects.toBeInstanceOf(FfmpegRunError);
    await expect(promise).rejects.toMatchObject({
      exitCode: 3,
      stderr: 'boom',
      timedOut: false,
    });
  });

  it('should kill the process and reject once the timeout expires', async () => {
    const started = Date.now();

    await expect(
      runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], 300),
    ).rejects.toMatchObject({ timedOut: true });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('should reject when the binary does not exist', async () => {
    await expect(
      runner.run('definitely-not-a-binary', [], 1000),
    ).rejects.toBeInstanceOf(FfmpegRunError);
  });
});
