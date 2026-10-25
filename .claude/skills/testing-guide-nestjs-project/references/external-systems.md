> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# External System Strategies

How each external system is handled in tests. These strategies were confirmed with the team.

---

## PostgreSQL — Real (Docker)

**Strategy:** Real database via the Docker `db` service (already in `compose.yaml`).

**Connection config for tests:**
```typescript
{
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'streamtube',
  password: process.env.DB_PASSWORD ?? 'streamtube',
  database: process.env.DB_DATABASE ?? 'streamtube',
  synchronize: true, // auto-create tables in test setup
}
```

**Test isolation:**
- Use `dataSource.query('DELETE FROM "table_name"')` to clean tables between tests
- Do NOT use `repository.delete({})` — throws `Empty criteria(s) are not allowed`
- Alternative: `repository.clear()` (truncates the table)
- For complex foreign key chains, delete in reverse dependency order or use `TRUNCATE ... CASCADE`
- Use `beforeEach` for cleanup to ensure each test starts with a clean state

**Entity setup:**
- Use `synchronize: true` in test DataSource to auto-create tables from entities
- For integration tests, import only the entities needed by the test — not all entities
- For E2E tests, import `AppModule` which includes all entities via their domain modules

---

## Object Storage — MinIO real (Docker)

**Strategy:** Real S3-compatible storage — the Compose `minio` service (`pgsty/minio`) — in development and tests. S3 in production uses the same `@aws-sdk/client-s3` code path; there is no local-filesystem adapter and storage is never mocked in integration/E2E tests.

**Approach:**
- `StorageService` (`src/storage/storage.service.ts`) is the only code that talks to the SDK. Integration tests exercise it against the `minio` service (`S3_ENDPOINT=http://minio:9000`).
- **Isolate per suite:** use a dedicated bucket (E2E suites use `streamtube-e2e`, set via `S3_BUCKET` before bootstrapping) or a unique key prefix per test (`test/storage-${randomUUID()}/...`). `StorageService.ensureBucket()` runs in `onModuleInit`, so `module.init()` / `app.init()` creates the bucket.
- **Clean up in teardown:** delete the objects you created (`deleteObject` in a `finally`), or for E2E abort pending multipart uploads and empty the bucket in `afterAll` (`test/utils/video-e2e.ts → emptyE2eBucket`).
- **Override `S3_PUBLIC_ENDPOINT=http://minio:9000` before building the module** in any test that *follows* a signed URL. Tests run inside the `nestjs-api` container, where `localhost:9000` (the browser-facing host) points at the container itself instead of MinIO, and SigV4 signs the `Host` header — a URL signed for one host cannot be replayed against another.
- **Multipart pattern:** S3 requires every part except the last to be ≥ 5MiB. Integration tests use 2 × 5MiB + a small last part; E2E tests declare small `sizeBytes` so the whole file fits in one part. The 10GB ceiling is validated by metadata (DTO + `partCount` math) — never upload a real large file.
- Use `fetch(url, { method: 'PUT', body })` to send parts to presigned URLs, exactly as a browser would; read the `ETag` response header.

**Setup pattern:**
```typescript
beforeAll(async () => {
  // Signed URLs are followed from inside the container, where only `minio` resolves.
  process.env.S3_PUBLIC_ENDPOINT = 'http://minio:9000';
  module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      StorageModule,
    ],
  }).compile();
  await module.init(); // runs ensureBucket()
  storage = module.get(StorageService);
});

afterAll(async () => {
  await module.close();
});
```

`src/test/video-test-module.ts → createVideoTestingModule([...])` bundles Config + TypeORM + BullMQ (unique prefix) + this override for suites that need Postgres, MinIO and Redis together.

**Integration test:**
```typescript
it('should complete a multipart uploaded through presigned part URLs', async () => {
  const key = `${keyPrefix}/multipart`;
  const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
  try {
    for (const [i, size] of [5 * MIB, 5 * MIB, 1024].entries()) {
      const url = await storage.presignUploadPart(key, uploadId, i + 1);
      const res = await fetch(url, { method: 'PUT', body: crypto.randomBytes(size) });
      expect(res.status).toBe(200);
    }
    const parts = await storage.listParts(key, uploadId);
    await storage.completeMultipartUpload(key, uploadId, parts);
    expect((await storage.headObject(key)).contentLength).toBe(10 * MIB + 1024);
  } finally {
    await storage.deleteObject(key);
  }
});
```

**What stays unit:** URL shape of presigned URLs (host, `X-Amz-Expires`, `response-content-disposition`). Signing is a local HMAC computation, so a real `S3Client` with fake credentials and no network is enough (`src/storage/storage.service.spec.ts`).

---

## Message Queue — Real (Docker)

**Strategy:** BullMQ (`bullmq` + `@nestjs/bullmq`) on the Compose `redis` service. Connect to host `redis` (the Compose service name) on port 6379 — the port is **not** published to the host, so queue tests only run inside the container.

**Isolation rules:**
- **Unique `prefix` per suite.** The `video-worker` container consumes the default prefix (`bull`) against the same Redis and the same database — a test job on the default prefix can be picked up by the real worker. Integration tests pass ``prefix: `test-${randomUUID()}` `` to `BullModule.forRoot`; E2E suites set `QUEUE_PREFIX` before bootstrapping `AppModule` (`test/utils/video-e2e.ts`).
- **`queue.obliterate({ force: true })`** in `afterEach`/`beforeEach` (and in `afterAll`) so job counts start from zero.
- **Inspect jobs through the DI token:** `module.get<Queue>(getQueueToken('video-processing'))`, then `queue.getJob(id)`, `queue.getJobCounts('waiting', 'delayed', 'active')`, `job.getState()`.
- **Always `module.close()` / `app.close()` in `afterAll`** — `registerQueue` attaches shutdown hooks that close the Redis connections; skipping it leaves Jest hanging.
- `@nestjs/bullmq@12` is ESM-only: both Jest configs carry a `transformIgnorePatterns` exception plus a `.js` `ts-jest` transform for `@nestjs/bullmq` and `@nestjs/bull-shared`. Keep it when touching the Jest config.

**Setup pattern:**
```typescript
module = await Test.createTestingModule({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'redis',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
      prefix: `test-publisher-${crypto.randomUUID()}`,
    }),
    VideoProcessingQueueModule,
  ],
}).compile();
await module.init();
queue = module.get<Queue>(getQueueToken('video-processing'));
```

**Publisher test (integration):**
```typescript
it('should add a process-video job keyed by the video id', async () => {
  await publisher.enqueue(videoId);

  const job = await queue.getJob(videoId);
  expect(job!.name).toBe('process-video');
  expect(job!.data).toEqual({ videoId });
  expect(job!.opts.attempts).toBe(3);
  expect(await job!.getState()).toBe('waiting'); // no processor registered in the API
});
```

**Consumer (processor) tests:** call `processor.process(job)` directly with a minimal `{ data }` job against real Postgres/MinIO/FFmpeg — do not wait for a background `Worker` to pick it up. Test the `failed` event handler as a unit (see `artifacts/future-types.md → Queue Consumers / Processors`). When a test needs a job in a real BullMQ state (e.g., retained `failed`), drive it with a throwaway `new Worker(queueName, handler, { connection: queue.opts.connection, prefix: queue.opts.prefix })` and `await worker.close()`.

---

## FFmpeg — binário real + fixtures

**Strategy:** Real `ffprobe`/`ffmpeg` binaries, installed by the shared `Dockerfile.dev` (`apt install -y ... ffmpeg`) used by both `nestjs-api` and `video-worker`. Media tests are `*.integration-spec.ts` and run in the `nestjs-api` container — the host may not have FFmpeg.

**Fixtures:** small committed files in `nestjs-project/test/fixtures/videos/` — `sample-2s.mp4` (320x240, 25fps, H.264 + AAC), `no-audio-2s.mp4` and `invalid.mp4` (random bytes). The generation command is in that folder's `README.md`; never generate media at test runtime. Reference them from `src/**` specs with `join(__dirname, '<relative>/test/fixtures/videos')` (the unit Jest `rootDir` is `src`).

**Unit vs integration:**

| Concern | Layer | Example |
|---|---|---|
| Pure math / parsing (thumbnail timestamp clamp, `r_frame_rate` → fps) | Unit | `thumbnail.service.spec.ts` |
| Process runner behaviour (exit code + stderr, timeout kill) | Unit, using `process.execPath` (`node -e ...`) as a deterministic stand-in binary | `ffmpeg-runner.spec.ts` |
| Error classification (`UnrecoverableError` vs retry, `failed` handler) | Unit | `video-processing.processor.spec.ts` |
| Real metadata extraction / thumbnail generation | Integration (real ffprobe/ffmpeg over fixtures) | `media-probe.service.integration-spec.ts`, `thumbnail.service.integration-spec.ts` |
| Full job: original in MinIO → metrics in Postgres + thumbnail in MinIO | Integration | `video-processing.processor.integration-spec.ts` |

**Gotchas:**
- Classify by stderr, not by exit code: only "Invalid data found when processing input" / "moov atom not found" mean corrupt media (permanent). `Connection refused`, DNS failures, `Server returned 403/404` and timeouts are transient and must be retried — assert both sides.
- ffmpeg echoes its input in stderr. When the input is a presigned URL that leaks the signature; assert error messages contain `<input>` and not the URL.
- Use `-v error` and array args with `spawn` (no shell) so tests are deterministic and safe.

---

## Email — Mailpit (Real SMTP Capture)

**Strategy:** Mailpit — a local SMTP server that captures all emails for inspection via its API. No emails are actually delivered.

**Setup:**
- Add Mailpit to `compose.yaml`:
```yaml
mailpit:
  image: axllent/mailpit
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # Web UI / API
```

**NestJS configuration:**
```typescript
// In mail module or config
{
  transport: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
  },
}
```

**Integration test:**
```typescript
describe('MailService (integration)', () => {
  beforeEach(async () => {
    // Clear all captured emails via Mailpit API
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  });

  it('should send confirmation email', async () => {
    await mailService.sendConfirmation('user@test.com', 'token-123');

    // Query Mailpit API for captured emails
    const response = await fetch('http://localhost:8025/api/v1/messages');
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].To[0].Address).toBe('user@test.com');
    expect(data.messages[0].Subject).toContain('confirm');
  });
});
```

**Key points:**
- Mailpit captures ALL emails — no mocking, no side effects
- Use Mailpit's REST API (`http://localhost:8025/api/v1/messages`) to inspect sent emails
- Clear captured emails in `beforeEach` to ensure test isolation
- Web UI at `http://localhost:8025` for manual debugging
- Tests the full SMTP transport path — if the SMTP config is wrong, the test fails
