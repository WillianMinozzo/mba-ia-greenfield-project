# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, storage, queue) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

```bash
# Infrastructure only (the nestjs-api container idles with `tail -f /dev/null`)
docker compose up -d db mailpit redis minio nestjs-api
```

The `video-worker` service is processing infrastructure, but it **runs application code** (it consumes the `video-processing` queue as soon as it boots), so it follows the same rule as the API server: start it only when the user asks to run the application or when verifying the processing pipeline (`docker compose up -d video-worker`). A bare `docker compose up -d` starts it too.

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"; db, redis and minio "healthy"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG` (the port is not published to the host)
- **MinIO:** `curl -f http://localhost:9000/minio/health/live` — expect `200`
- **FFmpeg (in the shared image):** `docker compose exec nestjs-api ffprobe -version`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `video-worker` — Video Worker: same image and bind mount as `nestjs-api`, command `npm run start:worker:dev` (entrypoint `src/worker.main.ts`, application context only — no HTTP port). Compiles to `dist-worker/` (via `tsconfig.worker.json`) so it never wipes the API's `dist/`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `redis` — Redis 8 for BullMQ, internal network only (host `redis`, port `6379` **not** published)
- `minio` — S3-compatible storage (`pgsty/minio`, pinned by tag + digest), API on `9000`, console on `9001`, credentials `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in `compose.yaml` (mirrored by `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` in `.env`)

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs video-worker
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

Storage, queue and media tests use the **real** services, so `minio`, `redis` and the FFmpeg binary of the shared image must be available (run them inside `nestjs-api`, never on the host):

- Suites that follow a presigned URL set `S3_PUBLIC_ENDPOINT=http://minio:9000` before building the module (inside a container `localhost:9000` is the container itself, and SigV4 signs the `Host`).
- Queue suites use a unique BullMQ prefix (`BullModule.forRoot({ prefix })` in integration tests, `QUEUE_PREFIX` in e2e) so `video-worker` never consumes test jobs.
- Media fixtures live in `test/fixtures/videos/` (generation command in its `README.md`).
- Helpers: `src/test/video-test-module.ts` (Config + TypeORM + BullMQ for integration) and `test/utils/video-e2e.ts` (full app boot, dedicated `streamtube-e2e` bucket, login helper).

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module
- Two entrypoints share the codebase: `src/main.ts` (`AppModule`, HTTP API) and `src/worker.main.ts` (`WorkerModule`, application context for `video-worker`). Config and TypeORM options are shared via `CONFIG_MODULE_OPTIONS` and `TYPEORM_MODULE_OPTIONS`.

## Videos

Bytes of video **never pass through the API**: the client uploads parts and streams media directly from storage with presigned URLs; the API only signs URLs, completes the multipart upload and publishes the processing job.

| Endpoint | Status | Purpose |
|---|---|---|
| `POST /videos` | 201 | Pre-register an `awaiting_upload` draft in the caller's channel and start the multipart upload (`partSize` 64MiB, `partCount`) |
| `GET /videos/:publicId/upload/part-urls?partNumbers=1,2` | 200 | Presigned `UploadPart` URLs (1h), up to 100 per call |
| `GET /videos/:publicId/upload/parts` | 200 | Parts already received (resume) |
| `POST /videos/:publicId/upload/complete` | 202 | Complete the multipart, check `HeadObject` size, move to `processing`, enqueue — idempotent |
| `DELETE /videos/:publicId/upload` | 204 | Abort the multipart and remove the draft |
| `GET /videos/:publicId` | 200 | Owner view; `streamUrl` / `downloadUrl` / `thumbnailUrl` (4h) only when `ready` |

All routes require JWT and only answer the channel owner — anyone else (or a malformed `publicId`) gets `404 VIDEO_NOT_FOUND`. `publicId` is 11 base64url characters.

- **Status cycle:** `processingStatus` `awaiting_upload → processing → ready | failed` (`failed` is terminal; the original is never deleted by processing). `publicationStatus` is always `draft` in this phase.
- **Queue:** `video-processing`, job `process-video` with `data = { videoId }` and `jobId = videoId` (deduplication). `attempts: 3`, exponential backoff from 30s, `removeOnComplete: true`, `removeOnFail: 1000`. Corrupt media throws `UnrecoverableError` (`MEDIA_INVALID` / `THUMBNAIL_FAILED`, no retry); anything else is retried and ends as `PROCESSING_FAILED`. The worker's reconciler re-enqueues `processing` videos without a pending job on boot. The API registers the queue without a processor.
- **Storage keys:** `videos/{id}/original` and `videos/{id}/thumbnail.jpg` in the private bucket `S3_BUCKET` — keys never derive from the user's filename. Real calls use `S3_ENDPOINT` (internal); URLs for clients are signed with `S3_PUBLIC_ENDPOINT` (browser host).
- **Media:** `ffprobe` extracts duration, resolution, codecs, bitrate and frame rate; `ffmpeg` grabs the thumbnail at 10% of the duration (clamped to ≥ 1s). Processes run via `spawn` with array args and a timeout; presigned URLs are redacted from any error message.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
