> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Future Types

Proactive guidance for NestJS artifact types not yet present in the project but likely to be added based on the project plan (authentication, video processing, email, queues).

---

## Custom Decorators (`*.decorator.ts`)

Custom decorators in NestJS are typically parameter decorators (e.g., `@CurrentUser()`) or composition decorators (combining multiple decorators into one).

**What to test:**
- Parameter decorators that extract data from the request context
- Composition decorators that combine multiple decorators

**Layer assignment:**
- **Parameter decorators** (e.g., `@CurrentUser()`): **E2E only** — test that the extracted value is correctly passed to the handler by testing the endpoint response
- **Composition decorators** (e.g., `@Public()` combining `@SetMetadata()` + others): **Skip** — these are declarative wrappers; test the behavior they enable via E2E

**When to skip:** Most custom decorators are thin wrappers around `createParamDecorator()` or `applyDecorators()` — they have no testable logic.

---

## Event Listeners / Handlers

If the project adopts NestJS's `@nestjs/event-emitter` for internal events (e.g., "user registered" triggers channel creation):

**What to test:**
- Event handler correctly processes the event data
- Side effects (DB writes, emails, queue publishing) occur as expected

**Layer assignment:**
- **Handlers with business logic**: Unit (mock dependencies) + Integration (real DB/external systems)
- **Handlers with only side effects**: Integration (real systems)

**Setup pattern:**
```typescript
// Test the handler directly by calling its method, not by emitting the event
// Event emission is framework behavior; the handler's logic is your code
describe('UserRegisteredHandler', () => {
  it('should create a channel for the new user', async () => {
    await handler.handleUserRegistered({ userId: 'u1', email: 'test@x.com' });
    // Assert channel was created in the database
  });
});
```

---

## Queue Consumers / Processors

BullMQ processors (`@Processor(...)` extending `WorkerHost`) run only in the `video-worker` process (`WorkerModule`); the API registers queues without processors. Reference implementation: `src/video-processing/video-processing.processor.ts`.

**What to test:**
- `process(job)` produces the side effects against real systems — DB row updated, objects written to MinIO — for a valid input
- Idempotency — a redelivered or stale job (video missing / no longer in the expected status) is a no-op
- Error classification — permanent errors become `UnrecoverableError` (no retry); transient errors propagate so the queue's `attempts`/`backoff` retries them
- The `@OnWorkerEvent('failed')` handler persists the final failure only on the last attempt **or** on `UnrecoverableError`, never on an intermediate attempt, and logs (does not throw) when persisting fails

**Layer assignment:**
- **`process(job)`**: Integration — real Postgres + MinIO + FFmpeg, called directly with a minimal `{ data }` job (do not wait for a background worker to pick it up)
- **`failed` handler / error classification**: Unit — fake `job` with `attemptsMade` / `opts.attempts`, mocked repository
- **Reconcilers / re-enqueue on boot**: Integration — real Postgres + Redis with a unique BullMQ `prefix`
- **Worker root module**: Unit compilation test (`compile()` without `init()`, so no worker starts consuming)

**`UnrecoverableError` vs retry:**
```typescript
it('should throw UnrecoverableError with MEDIA_INVALID for invalid.mp4', async () => {
  const video = await arrangeVideo('invalid.mp4'); // original uploaded to MinIO, status processing

  const promise = processor.process({ data: { videoId: video.id } } as Job);

  await expect(promise).rejects.toBeInstanceOf(UnrecoverableError);
  await expect(promise).rejects.toThrow(/^MEDIA_INVALID: /);
});

it('should not mark the video failed on an intermediate transient attempt', async () => {
  await processor.onFailed(
    { attemptsMade: 1, opts: { attempts: 3 }, data: { videoId } } as Job,
    new Error('storage down'),
  );
  expect(videoRepository.update).not.toHaveBeenCalled();
});
```

See `references/external-systems.md` → "Message Queue — Real (Docker)" for queue isolation and "FFmpeg — binário real + fixtures" for media fixtures.

---

## Scheduled Tasks (Cron)

If the project adds `@nestjs/schedule` for periodic tasks:

**What to test:**
- The scheduled method's logic executes correctly
- Side effects (cleanup, reports, notifications) work as expected

**Layer assignment:**
- Test the method directly as a regular service method (Unit and/or Integration)
- Do NOT test that the cron schedule triggers — trust `@nestjs/schedule`

---

## Health Checks

If the project adds `@nestjs/terminus` for health endpoints:

**What to test:**
- Health endpoint returns 200 when all services are healthy
- Health endpoint returns 503 when a dependency is down

**Layer assignment:** **E2E** — test the `/health` endpoint with supertest

---

## Config Validation

If the project adds `@nestjs/config` with schema validation (e.g., Joi or class-validator):

**What to test:**
- App fails to start with missing required env vars
- App fails to start with invalid env var values

**Layer assignment:** **Unit** (module compilation) — the module should fail to compile with bad config
