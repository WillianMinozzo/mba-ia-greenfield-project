import { spawn } from 'child_process';
import { Injectable } from '@nestjs/common';
import { FfmpegRunError } from './media.errors';

const STDERR_EXCERPT_LENGTH = 500;

export interface RunResult {
  stdout: string;
  stderr: string;
}

@Injectable()
export class FfmpegRunner {
  /** Runs a binary with array args (no shell); kills it and rejects once `timeoutMs` expires. */
  async run(
    binary: string,
    args: string[],
    timeoutMs: number,
  ): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new FfmpegRunError(err.message, null, stderr));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            new FfmpegRunError(
              `${binary} timed out after ${timeoutMs}ms`,
              code,
              stderr,
              true,
            ),
          );
        } else if (code !== 0) {
          const excerpt = stderr.trim().slice(-STDERR_EXCERPT_LENGTH);
          reject(
            new FfmpegRunError(
              `${binary} exited with code ${code}: ${excerpt}`,
              code,
              stderr,
            ),
          );
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }
}
