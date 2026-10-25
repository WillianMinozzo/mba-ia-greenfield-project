---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-25T01:15:44-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-25T01:14:29-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T01:13:33-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-10T12:23:06-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar, no `nestjs-project`, o upload de vídeos de até 10GB direto do cliente para o storage S3-compatível (MinIO local) com pré-cadastro automático do vídeo como rascunho, o processamento automático em segundo plano via fila (extração de duração e metadados + geração de thumbnail a partir de um frame) executado por um worker FFmpeg separado, uma URL única e curta por vídeo e as URLs assinadas de streaming (Range/206) e download — sem entregável de frontend nesta fase.

---

## Step Implementations

### SI-03.1 — Infra: dependências, serviços Compose, FFmpeg e configuração

**Description:** Instala as bibliotecas decididas, adiciona MinIO, Redis e o serviço `video-worker` ao Compose, coloca o FFmpeg na imagem compartilhada e cria os namespaces de configuração `storage` e `queue` — a base de infraestrutura de que todas as demais SIs dependem.

**Technical actions:**

1. Instalar no container (`docker compose exec nestjs-api npm install ...`): `bullmq@^6.4.2`, `@nestjs/bullmq@^12.0.0`, `@aws-sdk/client-s3@^3.1156.0`, `@aws-sdk/s3-request-presigner@^3.1156.0` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-05`). Uppy **não** é instalado nesta fase (`phase-03-videos/TD-02`).
2. Atualizar `nestjs-project/Dockerfile.dev` — `apt install -y ffmpeg` (traz `ffmpeg` e `ffprobe`) na mesma camada do `procps curl`; a imagem é compartilhada por `nestjs-api` e `video-worker` (per `phase-03-videos/TD-11`).
3. Atualizar `nestjs-project/compose.yaml`: (a) serviço `minio` com `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` fixado também pela digest `sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372`, comando `server /data --console-address :9001`, portas `9000:9000` e `9001:9001`, volume nomeado, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:3001` e healthcheck em `/minio/health/live` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`); (b) serviço `redis` com `redis:8-alpine`, **sem `ports:`** (só rede interna, host `redis`) e healthcheck `redis-cli ping` (per `phase-03-videos/TD-01`); (c) serviço `video-worker` com o mesmo `build` e bind-mount do `nestjs-api`, comando `npm run start:worker:dev`, `depends_on` `db`/`redis`/`minio` saudáveis (per `phase-03-videos/TD-11`); (d) `nestjs-api` passa a depender de `redis` e `minio`.
4. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `S3_ENDPOINT` (default `http://minio:9000`), `S3_PUBLIC_ENDPOINT` (default `http://localhost:9000`), `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (default `streamtube-media`), `S3_FORCE_PATH_STYLE` (default `true`) (per `phase-03-videos/TD-05`) — e `src/config/queue.config.ts` — `registerAs('queue', ...)` com `REDIS_HOST` (default `redis`) e `REDIS_PORT` (default `6379`). Registrar ambos em `ConfigModule.forRoot({ load: [...] })`, estender `src/config/env.validation.ts` (credenciais S3 obrigatórias, demais com default) e `.env.example` (seguindo as convenções `registerAs` + Joi herdadas de `phase-01-configuracao-base/TD-01`, `phase-01-configuracao-base/TD-02`, `phase-01-configuracao-base/TD-03`).
5. Atualizar também o `nestjs-project/.env` local (ignorado pelo git, não versionado) com as mesmas chaves `S3_*` e `REDIS_*` do `.env.example`: `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` iguais a `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` do serviço `minio` no `compose.yaml`, `S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `REDIS_HOST=redis` e `REDIS_PORT=6379` — sem isso a validação de ambiente da ação 4 impede a API de subir.
6. Isolar a saída de compilação do worker: o `video-worker` compartilha o bind mount do `nestjs-api` e o `nest-cli.json` usa `deleteOutDir: true`, então compilar os dois no mesmo `dist/` faz um apagar a saída do outro. Criar `nestjs-project/tsconfig.worker.json` estendendo `tsconfig.build.json` com `compilerOptions.outDir: "./dist-worker"` e `exclude` incluindo `dist` e `dist-worker`; acrescentar `dist-worker` ao `exclude` de `tsconfig.build.json` e incluir `"exclude": ["node_modules", "dist", "dist-worker"]` em `tsconfig.json`, para que nem o build da API nem o `npx tsc --noEmit` leiam os `.d.ts` gerados pelo worker. Adicionar `/dist-worker` ao `nestjs-project/.gitignore`.
7. Adicionar scripts em `package.json`: `start:worker` (`node dist-worker/worker.main`) e `start:worker:dev` (`nest start --watch --path tsconfig.worker.json --entryFile worker.main`); o arquivo `src/worker.main.ts` nasce em SI-03.10.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` (chaves `S3_*` e `REDIS_*`) | Integration: obrigatoriedade das credenciais S3 e defaults de `storage`/`queue` | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose ps` lista `minio`, `redis` e `video-worker` em execução, com `minio` e `redis` saudáveis.
- `docker compose port redis 6379` não retorna mapeamento (a porta do Redis não é publicada no host).
- `docker compose exec nestjs-api ffprobe -version` e `docker compose exec video-worker ffmpeg -version` respondem com sucesso.
- `curl -f http://localhost:9000/minio/health/live` no host retorna `200`.
- A aplicação recusa iniciar quando `S3_ACCESS_KEY_ID` ou `S3_SECRET_ACCESS_KEY` estão ausentes, com erro de validação de ambiente.
- Com o `.env` local atualizado, `nestjs-api` sobe sem erro de validação de ambiente.
- Com `nestjs-api` e `video-worker` em execução, `dist/main.js` e `dist-worker/worker.main.js` coexistem; reiniciar um dos serviços não apaga a saída do outro, e `git status` não lista `dist-worker/`.

---

### SI-03.2 — Implementar o StorageModule (S3/MinIO)

**Description:** Encapsula todo acesso ao storage S3-compatível em um módulo próprio — clientes interno e público, bucket privado, operações de multipart e assinatura de URLs — para que vídeos e worker nunca falem com o SDK diretamente.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` com dois providers `S3Client` (tokens em `storage.constants.ts`): o **interno** com `endpoint = S3_ENDPOINT` para chamadas reais e o **público** com `endpoint = S3_PUBLIC_ENDPOINT` usado **só** por `getSignedUrl`; ambos com `forcePathStyle: true`, região e credenciais de `storageConfig` (per `phase-03-videos/TD-05`).
2. Criar `src/storage/storage-keys.ts` — `videoOriginalKey(id)` → `videos/{id}/original` e `videoThumbnailKey(id)` → `videos/{id}/thumbnail.jpg`; nenhuma chave deriva do nome do arquivo do usuário (per `phase-03-videos/TD-03`).
3. Criar `src/storage/storage.service.ts` com operações sobre o cliente interno: `ensureBucket()` em `onModuleInit` (`CreateBucketCommand` tolerando `BucketAlreadyOwnedByYou`), `createMultipartUpload(key, contentType)`, `listParts(key, uploadId)` (paginando `ListPartsCommand`), `completeMultipartUpload(key, uploadId, parts)` (partes ordenadas por `PartNumber`), `abortMultipartUpload`, `headObject`, `putObject(key, body, contentType)`, `deleteObject` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-07`).
4. Adicionar ao `StorageService` a assinatura: `presignUploadPart(key, uploadId, partNumber)` (3600s) e `presignGetObject(key, { expiresIn, downloadFilename? })` (com `ResponseContentDisposition: attachment; filename="..."` quando `downloadFilename` vem preenchido) usando o cliente **público**, e `presignInternalGetObject(key)` usando o cliente **interno** para o ffprobe/ffmpeg do worker (per `phase-03-videos/TD-05`, `phase-03-videos/TD-10`, `phase-03-videos/TD-11`).
5. Nos testes que rodam dentro do container, sobrescrever `S3_PUBLIC_ENDPOINT=http://minio:9000` no setup da suíte: o host público real (`localhost:9000`) só existe no host, e a SigV4 assina o `Host` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-12`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real): multipart com 2 partes de 5MiB + 1 menor → `listParts` → `completeMultipartUpload` → `headObject`; `PUT` via URL de `presignUploadPart`; `ensureBucket` idempotente | `src/storage/storage.service.integration-spec.ts` |
| `StorageService` (assinatura) | Unit: URL de `presignGetObject` usa o host de `S3_PUBLIC_ENDPOINT` e inclui `response-content-disposition` só quando há `downloadFilename`; `presignInternalGetObject` usa o host de `S3_ENDPOINT` | `src/storage/storage.service.spec.ts` |
| `StorageModule` | Unit: compilation test | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 (MinIO no Compose, SDK instalado e `storageConfig`)

**Acceptance criteria:**

- Ao subir a aplicação, o bucket `S3_BUCKET` passa a existir no MinIO; reiniciar não gera erro.
- O bucket não aceita leitura anônima: `curl http://localhost:9000/{S3_BUCKET}/videos/{id}/original` sem assinatura retorna `403`.
- Um multipart de 3 partes enviado por `PUT` nas URLs de `presignUploadPart` e concluído por `completeMultipartUpload` resulta em objeto cujo `headObject` reporta o tamanho somado das partes.
- URLs emitidas por `presignUploadPart` e `presignGetObject` carregam o host de `S3_PUBLIC_ENDPOINT`; URLs de `presignInternalGetObject` carregam o host de `S3_ENDPOINT`.
- Uma URL de `presignGetObject` com `downloadFilename` faz o storage responder com `Content-Disposition: attachment; filename="..."`.

---

### SI-03.3 — Criar a entidade Video, a migration e o gerador de publicId

**Description:** Materializa o modelo `Video` com os dois eixos de status, as métricas do ffprobe e o `public_id` curto e único — o contrato de persistência que API e worker compartilham.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` conforme `### Data Model → Video`: colunas snake_case existentes (`public_id`, `channel_id`, `title`, `original_filename`, `content_type`, `upload_id`, `created_at`, `updated_at`), propriedades nomeadas por TD com coluna mapeada (`processingStatus` → `processing_status`, `publicationStatus` → `publication_status`, `processingError` → `processing_error`, `processedAt` → `processed_at`, `sizeBytes` → `size_bytes`, `durationSeconds` → `duration_seconds`, `width`, `height`, `videoCodec` → `video_codec`, `audioCodec` → `audio_codec`, `formatName` → `format_name`, `bitrate`, `frameRate` → `frame_rate`), enums `video_processing_status` e `video_publication_status`, `ManyToOne` para `Channel` via `channel_id` com `onDelete: 'CASCADE'` e o inverso `OneToMany` em `Channel` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-11`).
2. Gerar a migration `CreateVideos` com `npm run migration:generate` (enums, tabela, FK, unique em `public_id`, índices em `channel_id` e `processing_status`), revisar o SQL gerado e confirmar `up`/`down` com `migration:run`/`migration:revert` no container (segue `synchronize: false` herdado de `phase-01-configuracao-base/TD-04`).
3. Criar `src/videos/public-id.util.ts` — `generatePublicId()` retorna 11 caracteres base64url a partir de `crypto.randomBytes`, sem `nanoid` (per `phase-03-videos/TD-09`).
4. Incluir `Video` na lista de entidades e na limpeza de `src/test/create-test-data-source.ts` (`cleanAllTables`), respeitando a ordem de FK.
5. Atualizar `src/database/migrations.integration-spec.ts`: incluir `Video` nas entidades e `CreateVideos` na lista de `migrations`; no `beforeAll`, além dos drops atuais, executar `DROP TABLE IF EXISTS "videos" CASCADE` e `DROP TYPE IF EXISTS ... CASCADE` para `video_processing_status`, `video_publication_status` e `verification_tokens_type_enum` (tipos enum sobrevivem ao `DROP TABLE` e fariam a migration falhar com "type already exists"); o teste de aplicação passa a esperar `toHaveLength(3)` migrations e a tabela `videos` entre as tabelas criadas, e o teste de revert passa a desfazer `CreateVideos`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique em `public_id`, defaults `awaiting_upload`/`draft`, rejeição de valor fora do enum, cascade ao remover o canal, `audio_codec` nulo aceito | `src/videos/entities/video.entity.integration-spec.ts` |
| `generatePublicId` | Unit: 11 caracteres em `[A-Za-z0-9_-]`, valores distintos em chamadas sucessivas | `src/videos/public-id.util.spec.ts` |
| Migrations | Integration: `beforeAll` dropa `videos` e os enums `video_processing_status`, `video_publication_status` e `verification_tokens_type_enum`; as 3 migrations aplicam (`toHaveLength(3)`) criando também `videos`; o revert desfaz `CreateVideos` sobre o schema existente | `src/database/migrations.integration-spec.ts` |

**Dependencies:** none _(depende apenas das entidades `Channel`/`User` da Fase 02)_

**Acceptance criteria:**

- Após `migration:run`, a tabela `videos` existe com os tipos enum `video_processing_status` e `video_publication_status` e as colunas do Data Model.
- Inserir dois vídeos com o mesmo `public_id` — a segunda inserção é rejeitada por violação de unicidade.
- Inserir um vídeo sem informar status — a linha nasce com `processing_status = 'awaiting_upload'` e `publication_status = 'draft'`.
- Remover um canal — os vídeos daquele canal são removidos em cascata.
- `migration:revert` remove a tabela `videos` e os dois tipos enum sem afetar `users`/`channels`.

---

### SI-03.4 — Configurar a fila `video-processing` e o publisher

**Description:** Conecta a aplicação ao Redis via `@nestjs/bullmq` e registra a fila `video-processing` com a política de retry decidida, expondo um publisher que tanto a API quanto o reconciliador do worker usam para enfileirar `process-video`.

**Technical actions:**

1. Registrar `BullModule.forRootAsync` (com `inject: [queueConfig.KEY]`, conexão `{ host: REDIS_HOST, port: REDIS_PORT }`) em um módulo de infraestrutura importável tanto pelo `AppModule` quanto pelo futuro `WorkerModule` (per `phase-03-videos/TD-01`, convenção `ConfigType` herdada de `phase-01-configuracao-base/TD-03`).
2. Criar `src/video-processing/video-processing.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing'`, `PROCESS_VIDEO_JOB = 'process-video'` e o tipo `ProcessVideoJobData = { videoId: string }` (per `### Events/Messages`).
3. Criar `src/video-processing/video-processing-queue.module.ts` — `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: true, removeOnFail: 1000 } })`, **sem processor** (a API só publica) (per `phase-03-videos/TD-08`).
4. Criar `src/video-processing/video-processing.publisher.ts` — `enqueue(videoId)` chama `queue.add(PROCESS_VIDEO_JOB, { videoId }, { jobId: videoId })`; `hasPendingJob(videoId)` retorna `true` quando o job existe em `waiting`, `active` ou `delayed` (usado pelo reconciliador) (per `phase-03-videos/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingPublisher` | Integration (Redis real, `prefix` único por suíte + `obliterate` no teardown): job criado com `name`, `data` e `jobId` corretos e `attempts`/`backoff` herdados de `defaultJobOptions`; segundo `enqueue` do mesmo `videoId` não cria outro job; `hasPendingJob` reflete o estado | `src/video-processing/video-processing.publisher.integration-spec.ts` |
| `VideoProcessingQueueModule` | Unit: compilation test | `src/video-processing/video-processing-queue.module.spec.ts` |

**Dependencies:** SI-03.1 (Redis no Compose, `@nestjs/bullmq` instalado e `queueConfig`)

**Acceptance criteria:**

- `enqueue(videoId)` cria na fila `video-processing` um job `process-video` com `data = { videoId }`, `id = videoId`, `opts.attempts = 3` e `opts.backoff = { type: 'exponential', delay: 30000 }`.
- Chamar `enqueue` duas vezes com o mesmo `videoId` enquanto o primeiro job está pendente — a fila contém um único job.
- Com a aplicação de pé e nenhum worker rodando, o job permanece em `waiting` (a API não registra processor).

---

### SI-03.5 — Implementar o VideosService do handshake de upload

**Description:** Concentra a regra de negócio do pré-cadastro e do multipart — criar o rascunho, emitir URLs de partes, listar partes e cancelar — com checagem de dono e de status, sem ainda expor HTTP.

**Technical actions:**

1. Adicionar a `src/common/exceptions/domain.exception.ts` as exceções `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `InvalidPartNumberException` (`INVALID_PART_NUMBER`, 400), `UploadNotInProgressException` (`UPLOAD_NOT_IN_PROGRESS`, 409), `UploadIncompleteException` (`UPLOAD_INCOMPLETE`, 409) e `UploadSizeMismatchException` (`UPLOAD_SIZE_MISMATCH`, 409), conforme `### Error Catalog` (envelope herdado de `phase-02-auth/TD-07`).
2. Adicionar `ChannelsService.findByUserId(userId)` e exportar `ChannelsService` em `ChannelsModule`, para que `VideosService` resolva o canal do usuário sem acessar o repositório de outro domínio.
3. Criar `src/videos/videos.service.ts` — `initiateUpload(userId, { filename, contentType, sizeBytes })`: resolve o canal, salva o `Video` com `generatePublicId()` (até 3 tentativas em violação de unicidade de `public_id`), `title` derivado do nome sem extensão, chama `createMultipartUpload(videoOriginalKey(id), contentType)`, persiste `upload_id` e devolve `partSize = 67108864` e `partCount = ceil(sizeBytes / partSize)`. Se o multipart falhar, remove a linha (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`, `phase-03-videos/TD-09`).
4. Implementar `findOwnedByPublicId(userId, publicId)` (404 para inexistente ou de outro canal), `signPartUrls(userId, publicId, partNumbers)` (409 fora de `awaiting_upload`, 400 para `partNumber` fora de `1..partCount`, URLs via `presignUploadPart`), `listUploadedParts(userId, publicId)` (`listParts` mapeado para `{ partNumber, sizeBytes, etag }`) e `abortUpload(userId, publicId)` (`abortMultipartUpload` + remoção da linha), conforme `### Authorization Matrix` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-10`).
5. Criar `src/videos/videos.module.ts` — `TypeOrmModule.forFeature([Video])`, importa `StorageModule`, `ChannelsModule` e `VideoProcessingQueueModule`; registrar `VideosModule` no `AppModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (handshake) | Unit (repo/storage mockados): 404 para não-dono, 409 por status, 400 por `partNumber`, retry de `public_id` em colisão, rollback da linha quando o multipart falha, cálculo de `partCount` | `src/videos/videos.service.spec.ts` |
| `VideosService` (handshake) | Integration (Postgres + MinIO reais): `initiateUpload` persiste `upload_id` de um multipart existente; `abortUpload` remove a linha e o multipart; `listUploadedParts` reflete partes enviadas por `PUT` | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário e `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |
| `VideosModule` | Unit: compilation test | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2 (StorageService), SI-03.3 (entidade `Video` e `generatePublicId`), SI-03.4 (`VideoProcessingQueueModule` importado pelo módulo)

**Acceptance criteria:**

- `initiateUpload` com `sizeBytes = 10737418240` — cria o vídeo em `awaiting_upload`/`draft` com `upload_id` preenchido e retorna `partCount = 160`.
- `initiateUpload` — o vídeo recebe um `public_id` de 11 caracteres e o `title` é o nome do arquivo sem extensão.
- `signPartUrls` com `partNumber = partCount + 1` — lança `INVALID_PART_NUMBER`; com o vídeo em `processing` — lança `UPLOAD_NOT_IN_PROGRESS`.
- `findOwnedByPublicId` com o `publicId` de um vídeo de outro canal — lança `VIDEO_NOT_FOUND`.
- `abortUpload` em vídeo `awaiting_upload` — a linha some de `videos` e o `UploadId` deixa de aparecer em `ListMultipartUploads` do bucket.

---

### SI-03.6 — Expor os endpoints de pré-cadastro e handshake de upload

**Route:** POST /videos · GET /videos/:publicId/upload/part-urls · GET /videos/:publicId/upload/parts · DELETE /videos/:publicId/upload
**Test Specs:** see `nestjs-project/specs/videos-upload.plan.md`
**Authorization:** Authenticated (POST /videos); Owner (demais) — per `### Authorization Matrix`

**Description:** Liga o `VideosService` ao HTTP com DTOs validados, `publicId` validado no path e documentação OpenAPI, entregando o lado servidor do contrato de upload direto que o cliente futuro (Uppy) e os testes e2e consomem.

**Technical actions:**

1. Criar `src/videos/dto/create-video-upload.dto.ts` (`filename`, `contentType`, `sizeBytes`), `src/videos/dto/part-urls-query.dto.ts` (`partNumbers` transformado de `"1,2,3"` para `number[]`, 1–100 itens distintos) e os DTOs de resposta, conforme `### API Contracts` e `#### Validation Rules — videos` (validação herdada de `phase-02-auth/TD-06`).
2. Criar `src/videos/pipes/parse-public-id.pipe.ts` — aceita só 11 caracteres em `[A-Za-z0-9_-]` e lança `VideoNotFoundException` fora disso (per `phase-03-videos/TD-09`).
3. Criar `src/videos/videos.controller.ts` — `@ApiTags('videos')` + `@Controller('videos')`, sem `@Public()` (guard global herdado de `phase-02-auth/TD-02`); handlers `POST /videos` (201), `GET :publicId/upload/part-urls` (200), `GET :publicId/upload/parts` (200), `DELETE :publicId/upload` (204), usando `@CurrentUser()` → `JwtPayload.sub` como `userId`.
4. Documentar cada handler com `@ApiOperation` e um `@ApiResponse` por status (sucesso + 400/401/404/409 aplicáveis), seguindo a revisão de 2026-05-12 de `openapi-docs-nestjs/TD-01`, e regenerar `openapi.json` com `npm run openapi:export` (per `openapi-docs-nestjs/TD-02`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ParsePublicIdPipe` | Unit: aceita 11 caracteres válidos; rejeita tamanho errado e caracteres fora do alfabeto com `VIDEO_NOT_FOUND` | `src/videos/pipes/parse-public-id.pipe.spec.ts` |

**Dependencies:** SI-03.5 (VideosService e exceções de domínio)

**Acceptance criteria:**

- `POST /videos` com `{ filename: "aula.mp4", contentType: "video/mp4", sizeBytes: 15728640 }` e token válido retorna `201` com `publicId` de 11 caracteres, `processingStatus: "awaiting_upload"`, `publicationStatus: "draft"`, `partSize: 67108864` e `partCount: 1`.
- `POST /videos` com `contentType: "image/png"` ou `sizeBytes: 10737418241` retorna `400` com `error: "VALIDATION_ERROR"`.
- `POST /videos` sem `Authorization` retorna `401`.
- `GET /videos/{publicId}/upload/part-urls?partNumbers=1` do dono retorna `200` com uma URL; um `PUT` de bytes nessa URL responde `200` com header `ETag`.
- `GET /videos/{publicId}/upload/parts` após o `PUT` retorna `200` com a parte `1`, seu tamanho e `etag`.
- `GET /videos/{publicId}/upload/part-urls?partNumbers=2` em vídeo com `partCount: 1` retorna `400` com `error: "INVALID_PART_NUMBER"`.
- Qualquer rota com `:publicId` chamada por outro usuário autenticado, ou com `publicId` malformado, retorna `404` com `error: "VIDEO_NOT_FOUND"`.
- `DELETE /videos/{publicId}/upload` do dono retorna `204`; um `GET /videos/{publicId}/upload/parts` seguinte retorna `404`.
- `openapi.json` exportado contém as quatro operações sob a tag `videos`, com os status de erro documentados.

---

### SI-03.7 — Concluir o upload e enfileirar o processamento

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner — per `### Authorization Matrix`

**Description:** Implementa o gatilho do processamento: a API completa o multipart, valida o objeto final, muda o vídeo para `processing` e só então publica `process-video`, de forma idempotente.

**Technical actions:**

1. Implementar `VideosService.completeUpload(userId, publicId)`: com o vídeo já em `processing`/`ready`/`failed`, retorna o estado atual sem efeito; em `awaiting_upload`, chama `listParts` e lança `UploadIncompleteException` se houver menos partes que `partCount` (nada é completado) (per `phase-03-videos/TD-07`).
2. Com as partes completas: `completeMultipartUpload` (partes ordenadas por `PartNumber`) → `headObject`; se `ContentLength ≠ sizeBytes`, remove o objeto (`deleteObject`), grava `processingStatus = failed` + `processingError = "UPLOAD_SIZE_MISMATCH: ..."` e lança `UploadSizeMismatchException` (per `### Error Catalog`).
3. Com o tamanho conferido: em uma transação, atualiza `processingStatus = processing`, `upload_id = null` e `sizeBytes = ContentLength`; **após o commit**, chama `VideoProcessingPublisher.enqueue(video.id)` (per `phase-03-videos/TD-07`, `### Events/Messages`).
4. Adicionar ao `VideosController` o handler `POST :publicId/upload/complete` com `@HttpCode(202)`, documentação OpenAPI (202, 401, 404, 409) e regenerar `openapi.json` (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit (storage/publisher mockados): idempotência por status, `UPLOAD_INCOMPLETE` sem chamar `completeMultipartUpload`, `UPLOAD_SIZE_MISMATCH` com remoção do objeto e status `failed`, enqueue só após a atualização | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (Postgres + MinIO + Redis reais): upload real de 2 partes → `completeUpload` deixa o vídeo em `processing`, objeto em `videos/{id}/original` e job `process-video` com `jobId = id`; segunda chamada não cria outro job | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6 (VideosController e handshake), SI-03.4 (VideoProcessingPublisher)

**Acceptance criteria:**

- `POST /videos/{publicId}/upload/complete` após todas as partes enviadas retorna `202` com `processingStatus: "processing"`, e a fila `video-processing` contém um job `process-video` com `id` igual ao `id` do vídeo.
- Repetir `POST /videos/{publicId}/upload/complete` retorna `202` com o status atual e não adiciona um segundo job.
- `POST /videos/{publicId}/upload/complete` com partes faltando retorna `409` com `error: "UPLOAD_INCOMPLETE"`, e o upload continua retomável (`GET .../upload/parts` segue respondendo `200`).
- Um upload cujo objeto final difere do `sizeBytes` declarado retorna `409` com `error: "UPLOAD_SIZE_MISMATCH"`; o vídeo fica `failed` e o objeto não existe mais no bucket.
- Após um `complete` bem-sucedido, `videos.upload_id` é `null` e `videos.size_bytes` é o tamanho real do objeto.

---

### SI-03.8 — Expor o detalhe do vídeo com URLs de streaming e download

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/videos-detail.plan.md`
**Authorization:** Owner — per `### Authorization Matrix`

**Description:** Entrega ao dono o estado completo do vídeo e, quando pronto, as URLs pré-assinadas de stream (Range/206 nativo do storage), download e thumbnail — sem tráfego de mídia pela API.

**Technical actions:**

1. Implementar `VideosService.getOwnedVideo(userId, publicId)` reaproveitando `findOwnedByPublicId` (404 para não-dono) (per `phase-03-videos/TD-10`).
2. Criar o mapeamento para `VideoResponseDto` conforme `### API Contracts → GET /videos/:publicId`: campos de status, metadados (`durationSeconds`, `width`, `height`, `videoCodec`, `audioCodec`, `formatName`, `bitrate`, `frameRate`, `sizeBytes`) e `streamUrl`/`downloadUrl`/`thumbnailUrl`/`urlsExpireAt` preenchidos **somente** com `processingStatus = ready` (caso contrário `null`) (per `phase-03-videos/TD-06`, `phase-03-videos/TD-11`).
3. Gerar as URLs com `presignGetObject` (cliente público, 14400s): `streamUrl` e `thumbnailUrl` sem disposition; `downloadUrl` com `downloadFilename = original_filename` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-10`).
4. Adicionar ao `VideosController` o handler `GET :publicId` (200) com documentação OpenAPI (200, 401, 404) e regenerar `openapi.json` (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getOwnedVideo` / mapeamento | Unit: URLs `null` fora de `ready`; três URLs presentes em `ready`; `downloadUrl` pede `downloadFilename = original_filename`; não-dono → `VIDEO_NOT_FOUND` | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.6 (VideosController, `findOwnedByPublicId`)

**Acceptance criteria:**

- `GET /videos/{publicId}` do dono com o vídeo em `awaiting_upload` ou `processing` retorna `200` com `streamUrl`, `downloadUrl` e `thumbnailUrl` iguais a `null`.
- `GET /videos/{publicId}` do dono com o vídeo em `ready` retorna `200` com as três URLs preenchidas, `urlsExpireAt` cerca de 4h no futuro e os metadados de mídia.
- Um `GET` na `streamUrl` com `Range: bytes=0-1023` responde `206 Partial Content` com `Content-Range` e 1024 bytes.
- Um `GET` na `downloadUrl` responde com `Content-Disposition: attachment; filename="{original_filename}"`.
- `GET /videos/{publicId}` chamado por outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`; sem token retorna `401`.
- Com o vídeo em `failed`, `GET /videos/{publicId}` retorna `processingError` com o código da falha (ex.: `"MEDIA_INVALID: ..."`).

---

### SI-03.9 — Implementar a extração de metadados e a geração de thumbnail com FFmpeg

**Description:** Isola a invocação de `ffprobe`/`ffmpeg` em serviços pequenos e testáveis, com classificação de erro permanente vs transitório, para que o processor do worker só orquestre.

**Technical actions:**

1. Criar `src/video-processing/media/ffmpeg-runner.ts` — executa um binário via `child_process.spawn` com args em array (sem shell), timeout configurável (mata o processo ao expirar), captura de `stdout`/`stderr` e rejeição com exit code + trecho do `stderr` (per `phase-03-videos/TD-11`).
2. Criar `src/video-processing/media/media-probe.service.ts` — `probe(url)` roda `ffprobe -v error -print_format json -show_format -show_streams <url>` e devolve `{ durationSeconds, width, height, videoCodec, audioCodec, formatName, bitrate, frameRate, sizeBytes }` (`frameRate` calculado de `r_frame_rate`; `audioCodec = null` sem trilha de áudio); JSON bruto descartado. Falha de leitura, ausência de stream de vídeo ou duração ≤ 0 lançam `MediaInvalidError` (revisão 2026-10-25 de `phase-03-videos/TD-11`, `phase-03-videos/TD-08`).
3. Criar `src/video-processing/media/thumbnail.service.ts` — `generate(url, durationSeconds)` calcula `t = clamp(durationSeconds × 0.10, 1, durationSeconds)` (`t = 0` para vídeos menores que 1s), roda `ffmpeg -ss <t> -i <url> -frames:v 1 -vf scale=1280:-2 <tmp>.jpg` em diretório temporário e devolve o caminho; frame ausente lança `ThumbnailFailedError` (per `phase-03-videos/TD-11`).
4. Gerar uma única vez e commitar as fixtures em `nestjs-project/test/fixtures/videos/`: `sample-2s.mp4` (`ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=25 -f lavfi -i sine=duration=2 -shortest`), `no-audio-2s.mp4` (só `testsrc`) e `invalid.mp4` (bytes aleatórios), com o comando de geração registrado em `test/fixtures/videos/README.md` (per `phase-03-videos/TD-12`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Integration (ffprobe real sobre as fixtures): `sample-2s.mp4` → `durationSeconds ≈ 2`, `320x240`, `frameRate = 25`, codecs presentes; `no-audio-2s.mp4` → `audioCodec = null`; `invalid.mp4` → `MediaInvalidError` | `src/video-processing/media/media-probe.service.integration-spec.ts` |
| `ThumbnailService` | Integration (ffmpeg real): gera um JPEG legível a partir de `sample-2s.mp4` | `src/video-processing/media/thumbnail.service.integration-spec.ts` |
| `ThumbnailService` / parsing | Unit: clamp do instante (vídeo de 0,5s, 5s e 2h) e conversão de `r_frame_rate` (`"30000/1001"` → `29.97`) | `src/video-processing/media/thumbnail.service.spec.ts` |
| `FfmpegRunner` | Unit: rejeita com exit code e `stderr` quando o processo falha; mata o processo e rejeita ao estourar o timeout | `src/video-processing/media/ffmpeg-runner.spec.ts` |

**Dependencies:** SI-03.1 (FFmpeg na imagem compartilhada)

**Acceptance criteria:**

- `probe` sobre `sample-2s.mp4` retorna `durationSeconds` entre 1.9 e 2.1, `width = 320`, `height = 240`, `frameRate = 25` e `videoCodec`/`audioCodec` não nulos.
- `probe` sobre `no-audio-2s.mp4` retorna `audioCodec = null` e os demais campos preenchidos.
- `probe` sobre `invalid.mp4` lança `MediaInvalidError`, sem ficar pendurado.
- `generate` sobre `sample-2s.mp4` produz um arquivo JPEG com largura ≤ 1280 px.
- Um processo `ffmpeg`/`ffprobe` que excede o timeout é encerrado e a promessa rejeita.

---

### SI-03.10 — Implementar o worker de processamento (entrypoint, processor, falhas e reconciliador)

**Description:** Entrega o Video Worker como processo/container separado no mesmo código-base: consome `process-video`, extrai metadados, gera e envia a thumbnail, aplica a política de falha e re-enfileira vídeos órfãos no boot.

**Technical actions:**

1. Criar `src/worker.main.ts` (`NestFactory.createApplicationContext(WorkerModule)`, `enableShutdownHooks()`, sem HTTP) e `src/video-processing/worker.module.ts` — importa `ConfigModule`, `TypeOrmModule` (mesma fábrica de `databaseConfig`, convenção herdada de `phase-01-configuracao-base/TD-04`), o módulo `BullModule.forRootAsync` de SI-03.4, `VideoProcessingQueueModule`, `StorageModule`, `TypeOrmModule.forFeature([Video])` e os serviços de mídia; só ele declara o processor (per `phase-03-videos/TD-11`).
2. Criar `src/video-processing/video-processing.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` estendendo `WorkerHost`; `process(job)` segue `### Events/Messages → Processamento (consumer)`: no-op se o vídeo não existe ou não está `processing`; `presignInternalGetObject(videoOriginalKey(id))` → `MediaProbeService.probe` → `ThumbnailService.generate` → `putObject(videoThumbnailKey(id), ..., 'image/jpeg')` → uma única atualização com métricas, `processingStatus = ready`, `processedAt = now()`, `processingError = null`; remove o temporário (per `phase-03-videos/TD-07`, `phase-03-videos/TD-11`).
3. Converter `MediaInvalidError`/`ThumbnailFailedError` em `UnrecoverableError('MEDIA_INVALID: ...' | 'THUMBNAIL_FAILED: ...')`; demais erros propagam para o retry com backoff da fila (per `phase-03-videos/TD-08`).
4. Implementar `@OnWorkerEvent('failed')` no processor: quando o erro é `UnrecoverableError` ou `job.attemptsMade >= job.opts.attempts`, grava `processingStatus = failed` e `processingError` (`MEDIA_INVALID`/`THUMBNAIL_FAILED` com a mensagem, `PROCESSING_FAILED` para transitórias esgotadas); o original nunca é apagado (per `phase-03-videos/TD-08`).
5. Criar `src/video-processing/video-processing.reconciler.ts` — em `onApplicationBootstrap`, busca vídeos `processing` e chama `VideoProcessingPublisher.enqueue` para cada um sem job pendente (`hasPendingJob = false`) (per `phase-03-videos/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor` | Integration (Postgres + MinIO + ffmpeg reais, `sample-2s.mp4` enviado ao bucket): `process` deixa o vídeo `ready` com métricas e cria `videos/{id}/thumbnail.jpg`; com `invalid.mp4` lança `UnrecoverableError` com `MEDIA_INVALID`; vídeo fora de `processing` é no-op | `src/video-processing/video-processing.processor.integration-spec.ts` |
| `VideoProcessingProcessor` (`failed`) | Unit: grava `failed` só na última tentativa ou em `UnrecoverableError`; não grava em tentativa intermediária; escolhe o código certo | `src/video-processing/video-processing.processor.spec.ts` |
| `VideoProcessingReconciler` | Integration (Postgres + Redis reais): re-enfileira vídeo `processing` sem job; não duplica quando o job já está `waiting` | `src/video-processing/video-processing.reconciler.integration-spec.ts` |
| `WorkerModule` | Unit: compilation test (processor e reconciler resolvidos; nenhum controller HTTP) | `src/video-processing/worker.module.spec.ts` |

**Dependencies:** SI-03.4 (fila e publisher), SI-03.7 (vídeos chegam a `processing` com o original no bucket), SI-03.9 (serviços de mídia), SI-03.2 (StorageService), SI-03.3 (entidade `Video`)

**Acceptance criteria:**

- Com `video-worker` em execução, um vídeo concluído via `POST /videos/{publicId}/upload/complete` a partir de `sample-2s.mp4` chega a `processingStatus = ready` com `durationSeconds`, `width`, `height`, `frameRate` e `processedAt` preenchidos.
- Após o processamento, o objeto `videos/{id}/thumbnail.jpg` existe no bucket com `Content-Type: image/jpeg`.
- Um upload de `invalid.mp4` termina em `processingStatus = failed` com `processingError` começando por `MEDIA_INVALID`, após uma única tentativa (job sem retries).
- Com o MinIO indisponível durante o processamento, o job é tentado 3 vezes com backoff e o vídeo termina `failed` com `processingError` começando por `PROCESSING_FAILED`; o original permanece no bucket.
- Reiniciar o `video-worker` com um vídeo em `processing` e sem job na fila faz o vídeo ser reprocessado até `ready`.
- `docker compose logs video-worker` não mostra servidor HTTP escutando porta.

---

### SI-03.11 — Atualizar o testing-guide-nestjs-project para storage, fila e FFmpeg reais

**Description:** Alinha o guia de testes à estratégia decidida — MinIO, Redis e FFmpeg reais via Compose — substituindo a orientação de filesystem local, para que fases seguintes testem storage, fila e mídia como esta fase testou.

**Technical actions:**

1. Em `.claude/skills/testing-guide-nestjs-project/references/external-systems.md`, substituir a seção "Object Storage — Local Filesystem" por "Object Storage — MinIO real (Docker)": `StorageService` contra o serviço `minio`, bucket por suíte (ou prefixo único por teste) criado no setup e limpo no teardown, override de `S3_PUBLIC_ENDPOINT=http://minio:9000` dentro do container e o padrão de upload multipart com partes de 5MiB (o limite de 10GB é validado por metadado, nunca com arquivo real) (per `phase-03-videos/TD-12`, `phase-03-videos/TD-05`).
2. Na mesma referência, reescrever "Message Queue — Real (Docker)" para BullMQ com conexão no host `redis` (porta não publicada no host), `prefix` único por suíte, `queue.obliterate({ force: true })` no teardown, `getQueueToken('video-processing')` para inspecionar jobs e `app.close()`/`module.close()` no `afterAll` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-12`).
3. Adicionar a seção "FFmpeg — binário real + fixtures": FFmpeg presente no `Dockerfile.dev` compartilhado, testes de mídia/processor como `*.integration-spec.ts` rodando no container `nestjs-api`, fixtures em `nestjs-project/test/fixtures/videos/` com o comando de geração, e quando usar unit (parsing, clamp, classificação de erro) vs integration (ffprobe/ffmpeg reais) (per `phase-03-videos/TD-11`, `phase-03-videos/TD-12`).
4. Atualizar as linhas que citam "local adapter"/"local filesystem" em `SKILL.md` (§ 2 e tabela do § 3), `artifacts/services.md` e `artifacts/future-types.md` (seção "Queue Consumers / Processors", incluindo o caso `UnrecoverableError` vs retry) para apontar para MinIO/Redis/FFmpeg reais. Os defaults `localhost` antigos dos exemplos de Postgres e Mailpit **não** são alterados aqui — ficam como tarefa separada (per `phase-03-videos/TD-12`).

**Tests:** _(empty — documentation; validated by the ACs below)_

**Dependencies:** SI-03.10 (o guia descreve os padrões efetivamente implementados em SI-03.2, SI-03.4, SI-03.9 e SI-03.10)

**Acceptance criteria:**

- `grep -rn "Local Filesystem\|local adapter\|local filesystem" .claude/skills/testing-guide-nestjs-project` não retorna ocorrências.
- `references/external-systems.md` contém as seções "Object Storage — MinIO real (Docker)", "Message Queue — Real (Docker)" com host `redis` e "FFmpeg — binário real + fixtures".
- A tabela do § 3 do `SKILL.md` indica integração real com MinIO para "Service with side-effect dep (email, storage)" e inclui as linhas de queue processor.
- Os exemplos de Postgres e Mailpit com default `localhost` permanecem como estavam (escopo da tarefa separada).

---

### SI-03.12 — Documentar vídeos, fila, worker e storage nos CLAUDE.md e no diagrama de arquitetura

**Description:** Registra nos dois CLAUDE.md e no diagrama C4 o que a Fase 03 adicionou ao ambiente e à arquitetura — serviços Compose, worker, storage, fila e endpoints — para que agentes e pessoas operem e estendam o fluxo sem redescobrir as decisões.

**Technical actions:**

1. Em `CLAUDE.md` (raiz), atualizar a seção "Architecture" com a fila decidida (BullMQ + Redis, em vez de "TBD"), o Video Worker como container `video-worker` no mesmo código-base do `nestjs-project`, o storage MinIO `pgsty/minio` fixado e a regra de endpoint interno vs público para URLs assinadas (exceção documentada à regra "use o nome do serviço": `S3_PUBLIC_ENDPOINT` aponta para o host) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`, `phase-03-videos/TD-05`, `phase-03-videos/TD-11`).
2. Em `nestjs-project/CLAUDE.md`, atualizar "Environment Startup Verification" e "Development Environment": serviços `minio` (9000 API / 9001 console), `redis` (sem porta no host; checagem com `docker compose exec redis redis-cli ping`) e `video-worker` (comando `npm run start:worker:dev`, logs com `docker compose logs video-worker`); o worker é infraestrutura de processamento, mas segue a regra de só subir aplicações quando pedido.
3. Em `nestjs-project/CLAUDE.md`, adicionar a seção "Videos": tabela de endpoints de `/videos` (pré-cadastro, part-urls, parts, complete, abort, detalhe), ciclo de status `awaiting_upload → processing → ready | failed` + `publicationStatus = draft`, fila `video-processing`/job `process-video` com `jobId = videoId`, `attempts: 3` e `UnrecoverableError`, chaves `videos/{id}/original` e `videos/{id}/thumbnail.jpg`, e a regra de que bytes de vídeo nunca passam pela API (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-06`, `phase-03-videos/TD-07`, `phase-03-videos/TD-08`).
4. Em `nestjs-project/CLAUDE.md` § "Commands"/"Test execution", registrar que testes de storage, fila e FFmpeg exigem `minio`, `redis` e o FFmpeg da imagem em pé, e o override de `S3_PUBLIC_ENDPOINT` nos testes (per `phase-03-videos/TD-12`).
5. Em `docs/diagrams/software-arch.mermaid`, trocar a tecnologia do `ContainerQueue(queue, ...)` de `"TBD"` para `"BullMQ + Redis"`, a do `Container(worker, ...)` para `"Node.js (BullMQ worker) + FFmpeg"` e a do `ContainerDb(storage, ...)` para `"MinIO (S3-compatible)"`; atualizar as relações para o fluxo decidido: `Rel(frontend, storage, ...)` passa a "Uploads (presigned multipart) / Streams (presigned URL)" e `Rel(api, storage, ...)` passa a "Signs URLs, completes multipart" — a API não envia bytes de vídeo. Os blocos `UpdateElementStyle`/`UpdateRelStyle` ficam como estão (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, `phase-03-videos/TD-05`, `phase-03-videos/TD-11`).

**Tests:** _(empty — documentation; validated by the ACs below)_

**Dependencies:** SI-03.10 (worker e fila implementados), SI-03.8 (conjunto final de endpoints)

**Acceptance criteria:**

- O `CLAUDE.md` raiz não descreve mais a fila como "TBD" e cita BullMQ + Redis, o container `video-worker` e o MinIO `pgsty/minio`.
- O `CLAUDE.md` raiz documenta a exceção `S3_PUBLIC_ENDPOINT` (host do navegador) ao lado da regra de usar o nome do serviço Compose.
- `nestjs-project/CLAUDE.md` lista os serviços `minio`, `redis` e `video-worker` com seus comandos de verificação.
- `nestjs-project/CLAUDE.md` contém a seção "Videos" com os seis endpoints de `/videos`, o ciclo de status e a configuração do job `process-video`.
- `docs/diagrams/software-arch.mermaid` não contém mais `"TBD"`; fila, worker e storage citam BullMQ + Redis, FFmpeg e MinIO, e as relações mostram o upload direto do frontend ao storage via URL assinada.

---

## Technical Specifications

### Data Model

#### Video

Tabela `videos`. Propriedades com nome definido por TD (`processingStatus`, `publicationStatus`, `processingError`, `processedAt` — `phase-03-videos/TD-06`; métricas do ffprobe — revisão 2026-10-25 de `phase-03-videos/TD-11`) são transcritas verbatim como propriedades da entidade e campos da API; a coluna física segue a convenção snake_case já usada em `channels`/`users` (`user_id`, `created_at`) via `@Column({ name: ... })`. Os demais campos seguem a convenção existente (propriedade = coluna, snake_case).

| Field (entity property) | Column | Type | Constraints |
|-------------------------|--------|------|-------------|
| id | id | uuid | PK, generated |
| public_id | public_id | varchar(11) | unique, not null — 11 caracteres base64url gerados com `crypto.randomBytes`; retry em violação de unicidade (`phase-03-videos/TD-09`) |
| channel_id | channel_id | uuid | not null, FK → `channels.id` ON DELETE CASCADE |
| title | title | varchar(100) | not null — inicializado com o nome do arquivo original sem extensão (truncado em 100); editável na Fase 04 |
| original_filename | original_filename | varchar(255) | not null |
| content_type | content_type | varchar(100) | not null — `video/*` validado na criação (`phase-03-videos/TD-02`) |
| upload_id | upload_id | varchar(1024) | nullable — `UploadId` do multipart S3 persistido no pré-cadastro; zerado (`null`) após `CompleteMultipartUpload` ou abort (`phase-03-videos/TD-02`) |
| processingStatus | processing_status | enum `video_processing_status` (`awaiting_upload`, `processing`, `ready`, `failed`) | not null, default `awaiting_upload` (`phase-03-videos/TD-06`) |
| publicationStatus | publication_status | enum `video_publication_status` (`draft`) | not null, default `draft` — só o valor `draft` existe na Fase 03; a Fase 04 adiciona a transição `draft → published` (`phase-03-videos/TD-06`) |
| processingError | processing_error | varchar(255) | nullable — código curto + mensagem da falha final (ver Error Catalog → códigos de processamento) (`phase-03-videos/TD-06`, `phase-03-videos/TD-08`) |
| processedAt | processed_at | timestamptz | nullable — preenchido quando `processingStatus` vira `ready` (`phase-03-videos/TD-06`) |
| sizeBytes | size_bytes | bigint | not null — tamanho declarado no pré-cadastro (≤ 10GB); sobrescrito pelo `ContentLength` real do `HeadObject` na conclusão e confirmado pelo ffprobe (`phase-03-videos/TD-02`, `phase-03-videos/TD-07`, `phase-03-videos/TD-11`) |
| durationSeconds | duration_seconds | numeric(10,3) | nullable — preenchido pelo worker (`phase-03-videos/TD-11`) |
| width | width | integer | nullable (`phase-03-videos/TD-11`) |
| height | height | integer | nullable (`phase-03-videos/TD-11`) |
| videoCodec | video_codec | varchar(50) | nullable (`phase-03-videos/TD-11`) |
| audioCodec | audio_codec | varchar(50) | nullable — permanece `null` em vídeos sem trilha de áudio (`phase-03-videos/TD-11`) |
| formatName | format_name | varchar(100) | nullable (`phase-03-videos/TD-11`) |
| bitrate | bitrate | bigint | nullable — bits/s (`phase-03-videos/TD-11`) |
| frameRate | frame_rate | numeric(8,3) | nullable — fps calculado de `r_frame_rate` (`phase-03-videos/TD-11`) |
| created_at | created_at | timestamptz | default now() |
| updated_at | updated_at | timestamptz | default now(), on update |

**Relations:** `Channel` has many `Video` (one-to-many; `Video.channel` ManyToOne via `channel_id`).
**Indexes:** unique on `public_id`; index on `channel_id`; index on `processing_status` (consultas do reconciliador por vídeos `processing`, `phase-03-videos/TD-07`).
**Storage keys (derivadas, não persistidas):** original em `videos/{id}/original`, thumbnail em `videos/{id}/thumbnail.jpg`, no bucket privado único configurado em `S3_BUCKET` (`phase-03-videos/TD-03`). A chave usa só o `id` interno — nunca o nome do arquivo do usuário.
**Invariantes de status:** `awaiting_upload → processing → ready | failed` (`phase-03-videos/TD-06`); `failed` é terminal para o pipeline automático e o original não é apagado (`phase-03-videos/TD-08`); `publicationStatus` não muda nesta fase.

### API Contracts

Todas as rotas abaixo são protegidas pelo `JwtAuthGuard` global (nenhuma usa `@Public()`) e exigem `Authorization: Bearer <access_token>`. O recurso é identificado pelo `publicId` (11 caracteres base64url, `phase-03-videos/TD-09`) — a mesma URL curta que a Fase 05 usará na página pública. Erros seguem o envelope herdado `{ statusCode, error, message }` (`phase-02-auth/TD-07`); erros de validação usam `error: 'VALIDATION_ERROR'` com `message: string[]`. Um vídeo de outro canal responde `404 VIDEO_NOT_FOUND` (não revela existência). Os bytes do vídeo nunca passam pela API: o cliente faz `PUT` direto nas URLs pré-assinadas das partes (`phase-03-videos/TD-02`), assinadas com `S3_PUBLIC_ENDPOINT` (`phase-03-videos/TD-05`). Nesta fase o cliente é simulado pelos testes e2e (nenhum entregável em `next-frontend/`).

#### POST /videos (SI-03.6)

Pré-cadastra o vídeo como rascunho e inicia o multipart (`CreateMultipartUploadCommand`) — `phase-03-videos/TD-02`, `phase-03-videos/TD-06`.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- filename: string, required — 1 a 255 caracteres; usado só para `original_filename` e `title` inicial
- contentType: string, required — deve começar com `video/`
- sizeBytes: integer, required — 1 a 10737418240 (10GB)

**Response 201:**
- id: string (uuid)
- publicId: string (11 caracteres)
- title: string
- processingStatus: `"awaiting_upload"`
- publicationStatus: `"draft"`
- partSize: integer — `67108864` (64MiB fixos, `phase-03-videos/TD-02`)
- partCount: integer — `ceil(sizeBytes / partSize)`

**Error responses:**
- 400 VALIDATION_ERROR: body inválido (`contentType` fora de `video/*`, `sizeBytes` fora de 1..10737418240, `filename` vazio/longo)
- 401 Unauthorized: token ausente ou inválido

---

#### GET /videos/:publicId/upload/part-urls (SI-03.6)

Emite URLs pré-assinadas de `UploadPartCommand` sob demanda (`phase-03-videos/TD-02`, `phase-03-videos/TD-05`). Sem efeito colateral — a assinatura é cálculo local.

**Request headers:**
- Authorization: Bearer {access_token}

**Request query parameters:**
- partNumbers: string, required — lista separada por vírgula de inteiros distintos (ex.: `1,2,3`), 1 a 100 itens, cada um em `1..partCount`

**Response 200:**
- parts: array of `{ partNumber: integer, url: string }` — `url` assinada com host público, válida por 3600s
- expiresAt: string (ISO-8601)

**Error responses:**
- 400 VALIDATION_ERROR: `partNumbers` ausente, malformado ou com mais de 100 itens
- 400 INVALID_PART_NUMBER: algum `partNumber` fora de `1..partCount`
- 401 Unauthorized: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: `publicId` inexistente ou de outro canal
- 409 UPLOAD_NOT_IN_PROGRESS: `processingStatus` diferente de `awaiting_upload`

---

#### GET /videos/:publicId/upload/parts (SI-03.6)

Lista as partes já recebidas pelo storage (`ListPartsCommand`), base da retomada de upload (`phase-03-videos/TD-02`).

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- parts: array of `{ partNumber: integer, sizeBytes: integer, etag: string }` — ordenado por `partNumber`; vazio quando nenhuma parte chegou

**Error responses:**
- 401 Unauthorized: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: `publicId` inexistente ou de outro canal
- 409 UPLOAD_NOT_IN_PROGRESS: `processingStatus` diferente de `awaiting_upload`

---

#### POST /videos/:publicId/upload/complete (SI-03.7)

A API completa o multipart e enfileira o processamento (`phase-03-videos/TD-07`): `ListPartsCommand` → `CompleteMultipartUploadCommand` (partes ordenadas por `PartNumber`) → `HeadObjectCommand` (valida `ContentLength` = `sizeBytes` declarado) → `processingStatus = processing`, `upload_id = null` (commit) → `queue.add('process-video', { videoId }, { jobId: videoId })` **após** o commit. Idempotente: com o vídeo já em `processing`, `ready` ou `failed`, responde 202 com o estado atual sem novo enqueue.

**Request headers:**
- Authorization: Bearer {access_token}

**Request body:** nenhum.

**Response 202:**
- id: string (uuid)
- publicId: string
- processingStatus: `"processing"` (ou o status atual, na chamada idempotente)

**Error responses:**
- 401 Unauthorized: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: `publicId` inexistente ou de outro canal
- 409 UPLOAD_INCOMPLETE: `ListParts` retorna menos partes que `partCount` (nada é completado; o upload continua retomável)
- 409 UPLOAD_SIZE_MISMATCH: `HeadObject.ContentLength` ≠ `sizeBytes` declarado após completar — o objeto é removido e o vídeo vai para `processingStatus = failed` com `processingError = UPLOAD_SIZE_MISMATCH`

---

#### DELETE /videos/:publicId/upload (SI-03.6)

Cancela um upload em andamento: `AbortMultipartUploadCommand` e remoção do pré-cadastro (a linha em `videos`), já que não há arquivo associado.

**Request headers:**
- Authorization: Bearer {access_token}

**Response 204:** No content.

**Error responses:**
- 401 Unauthorized: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: `publicId` inexistente ou de outro canal
- 409 UPLOAD_NOT_IN_PROGRESS: `processingStatus` diferente de `awaiting_upload`

---

#### GET /videos/:publicId (SI-03.8)

Detalhe do vídeo para o dono do canal. Na Fase 03 todo vídeo é rascunho, então só o dono autenticado o enxerga (`phase-03-videos/TD-10`). `streamUrl`, `downloadUrl` e `thumbnailUrl` são GETs pré-assinados direto ao storage (Range/206 nativo do MinIO/S3), emitidos **somente** quando `processingStatus = ready`; caso contrário vêm `null`.

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- id: string (uuid)
- publicId: string
- title: string
- originalFilename: string
- contentType: string
- sizeBytes: integer
- processingStatus: `"awaiting_upload" | "processing" | "ready" | "failed"`
- publicationStatus: `"draft"`
- processingError: string | null
- processedAt: string (ISO-8601) | null
- durationSeconds: number | null
- width: integer | null
- height: integer | null
- videoCodec: string | null
- audioCodec: string | null
- formatName: string | null
- bitrate: integer | null
- frameRate: number | null
- streamUrl: string | null — `GetObjectCommand` em `videos/{id}/original`, assinado com host público, válido por 14400s (4h)
- downloadUrl: string | null — idem, com `ResponseContentDisposition: attachment; filename="{original_filename}"` (parâmetro `response-*` exige requisição assinada)
- thumbnailUrl: string | null — `GetObjectCommand` em `videos/{id}/thumbnail.jpg`, válido por 14400s
- urlsExpireAt: string (ISO-8601) | null
- createdAt: string (ISO-8601)

**Error responses:**
- 401 Unauthorized: token ausente ou inválido
- 404 VIDEO_NOT_FOUND: `publicId` inexistente ou de outro canal

---

#### Validation Rules — videos

- `publicId` (path): exatamente 11 caracteres em `[A-Za-z0-9_-]`; fora disso responde `404 VIDEO_NOT_FOUND` (não é um id válido de nenhum vídeo).
- `filename`: string, 1–255 caracteres.
- `contentType`: string, regex `^video\/[\w.+-]+$`.
- `sizeBytes`: inteiro, `1 ≤ sizeBytes ≤ 10737418240`.
- `partNumbers`: lista separada por vírgula, 1–100 inteiros distintos ≥ 1; o teto `partCount` é regra de domínio (`INVALID_PART_NUMBER`), não de DTO.

### Authorization Matrix

"Owner" = usuário autenticado cujo canal (`channels.user_id = JwtPayload.sub`) é o `channel_id` do vídeo. Autenticado não-dono recebe `404 VIDEO_NOT_FOUND` (não `403`), para não revelar a existência de rascunhos. Acesso anônimo/público/unlisted fica para as Fases 04/05 (`phase-03-videos/TD-10`).

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ (401) | ✓ (cria no próprio canal) | — |
| GET /videos/:publicId/upload/part-urls | ✗ (401) | ✗ (404) | ✓ |
| GET /videos/:publicId/upload/parts | ✗ (401) | ✗ (404) | ✓ |
| POST /videos/:publicId/upload/complete | ✗ (401) | ✗ (404) | ✓ |
| DELETE /videos/:publicId/upload | ✗ (401) | ✗ (404) | ✓ |
| GET /videos/:publicId (inclui `streamUrl` / `downloadUrl` / `thumbnailUrl`) | ✗ (401) | ✗ (404) | ✓ |

**Fora da API:** as URLs pré-assinadas (partes, stream, download, thumbnail) são a autorização em si — quem possui a URL acessa o objeto até `expiresIn`. Elas só são emitidas pelos endpoints acima, depois da checagem de dono. O bucket não tem leitura anônima (`phase-03-videos/TD-03`).

### Error Catalog

Formato herdado de `phase-02-auth/TD-07`: `{ statusCode, error, message }`, com o código no campo `error`. Novas exceções estendem `DomainException` em `src/common/exceptions/domain.exception.ts` e são mapeadas pelo `DomainExceptionFilter` existente.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | `publicId` inexistente, malformado ou pertencente a outro canal |
| INVALID_PART_NUMBER | 400 | `partNumbers` contém número fora de `1..partCount` do vídeo |
| UPLOAD_NOT_IN_PROGRESS | 409 | Assinar partes, listar partes ou abortar com `processingStatus ≠ awaiting_upload` |
| UPLOAD_INCOMPLETE | 409 | `complete` com menos partes recebidas (`ListParts`) que `partCount`; nada é completado |
| UPLOAD_SIZE_MISMATCH | 409 | Após `CompleteMultipartUpload`, `HeadObject.ContentLength` ≠ `sizeBytes` declarado; objeto removido e vídeo marcado `failed` |
| VALIDATION_ERROR | 400 | Body/query inválido (herdado — `ValidationExceptionFilter`) |

**Códigos de falha de processamento** (não são respostas HTTP; gravados em `videos.processing_error` como `"{CODE}: {mensagem curta}"` e expostos em `processingError` no `GET /videos/:publicId` — `phase-03-videos/TD-08`):

| Code | Classe | Trigger |
|------|--------|---------|
| MEDIA_INVALID | permanente → `UnrecoverableError` | ffprobe falha ao ler o arquivo, não há stream de vídeo, ou duração ausente/≤ 0 |
| THUMBNAIL_FAILED | permanente → `UnrecoverableError` | ffmpeg conclui sem gerar o frame (ex.: duração menor que o instante calculado após clamp) |
| PROCESSING_FAILED | transitória esgotada | qualquer outro erro (storage, banco, timeout do processo, worker morto) após as 3 tentativas |
| UPLOAD_SIZE_MISMATCH | permanente (síncrona) | gravado pelo `complete` (ver tabela HTTP acima) |

### Events/Messages

#### Job `process-video` (fila `video-processing`)

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:**
- `jobId`: o próprio `videoId` — deduplicação do BullMQ: um segundo `add` com o mesmo `jobId` é ignorado enquanto o job existir, o que torna o `complete` e o reconciliador idempotentes (`phase-03-videos/TD-07`).
- `attempts: 3`, `backoff: { type: 'exponential', delay: 30000 }` — definidos em `defaultJobOptions` no registro da fila (`phase-03-videos/TD-08`).
- `removeOnComplete: true`, `removeOnFail: 1000` — mantém os últimos falhos para diagnóstico. Como jobs removidos deixam de contar para a deduplicação, a idempotência final é garantida pela checagem de `processingStatus` antes de enfileirar, não só pelo `jobId`.

**Producer:** `VideosService.completeUpload` (API, após o commit) e `VideoProcessingReconciler` (worker, no boot) (per `phase-03-videos/TD-07`)
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing')`, estende `WorkerHost`), carregado apenas pelo entrypoint `worker.main.ts` no serviço Compose `video-worker` (per `phase-03-videos/TD-11`); a API registra a fila sem processor (só publica).
**Trigger:** conclusão bem-sucedida do multipart em `POST /videos/:publicId/upload/complete`; re-enqueue pelo reconciliador para vídeos em `processing` sem job ativo na fila.
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-01`, `phase-03-videos/TD-08`). O processamento é idempotente: reprocessar sobrescreve a mesma chave `videos/{id}/thumbnail.jpg` e os mesmos campos de metadados.

**Processamento (consumer):**
1. Carrega o vídeo; se não existir ou `processingStatus ≠ processing`, conclui o job sem efeito (no-op idempotente).
2. Gera URL pré-assinada **interna** (`S3_ENDPOINT`) de `GetObject` para `videos/{id}/original` e roda `ffprobe -v error -print_format json -show_format -show_streams <url>` via `spawn` (args em array, sem shell) — o ffprobe faz range requests e não baixa o arquivo (`phase-03-videos/TD-11`).
3. Extrai e valida `durationSeconds`, `width`, `height`, `videoCodec`, `audioCodec`, `formatName`, `bitrate`, `frameRate`, `sizeBytes` (revisão 2026-10-25 de `phase-03-videos/TD-11`); JSON bruto descartado. Sem stream de vídeo ou duração ≤ 0 → `UnrecoverableError('MEDIA_INVALID: ...')`.
4. Gera a thumbnail: `ffmpeg -ss <t> -i <url> -frames:v 1 -vf scale=1280:-2 <tmp>.jpg`, com `t = clamp(durationSeconds × 0.10, 1, durationSeconds)` (para vídeos menores que 1s, `t = 0`); envia para `videos/{id}/thumbnail.jpg` com `ContentType: image/jpeg`; remove o temporário.
5. Persiste métricas + `processingStatus = ready` + `processedAt = now()` + `processingError = null` em uma única atualização.

**Falha:**
- `UnrecoverableError` → o job vai direto para `failed`, sem retry (`phase-03-videos/TD-08`).
- Demais erros → retry com backoff exponencial até `attempts: 3`.
- `@OnWorkerEvent('failed')`: quando `job.attemptsMade >= job.opts.attempts` **ou** o erro é `UnrecoverableError`, grava `processingStatus = failed` e `processingError` (`MEDIA_INVALID` / `THUMBNAIL_FAILED` com a mensagem; `PROCESSING_FAILED` para as transitórias esgotadas). O original nunca é apagado.

**Reconciliador (`VideoProcessingReconciler`, worker):** no `onApplicationBootstrap` do worker, busca vídeos com `processingStatus = processing` e chama `queue.add('process-video', { videoId }, { jobId: videoId })` para cada um que não tenha job `waiting`/`active`/`delayed` na fila. Fecha a janela "status mudou mas o job não entrou" entre o commit e o enqueue (`phase-03-videos/TD-07`).

---

## Dependency Map

```
SI-03.1 (root — dependências, Compose, FFmpeg, configuração)
├── SI-03.2 — depends on SI-03.1 (MinIO, SDK e storageConfig)
├── SI-03.4 — depends on SI-03.1 (Redis, @nestjs/bullmq e queueConfig)
└── SI-03.9 — depends on SI-03.1 (FFmpeg na imagem compartilhada)
SI-03.3 (root — entidade Video, migration, publicId; depende só da Fase 02)

SI-03.5 — depends on SI-03.2 + SI-03.3 + SI-03.4 (StorageService, entidade, módulo da fila)
└── SI-03.6 — depends on SI-03.5 (VideosService do handshake)
    ├── SI-03.7 — depends on SI-03.6 + SI-03.4 (controller + publisher)
    │   └── SI-03.10 — depends on SI-03.7 + SI-03.4 + SI-03.9 + SI-03.2 + SI-03.3 (vídeos em processing, fila, mídia, storage)
    │       ├── SI-03.11 — depends on SI-03.10 (guia descreve os padrões implementados)
    │       └── SI-03.12 — depends on SI-03.10 + SI-03.8 (worker e endpoints finais)
    └── SI-03.8 — depends on SI-03.6 (controller e findOwnedByPublicId)
```

---

## Deliverables

- [ ] SI-03.1 — Infra: dependências, serviços Compose, FFmpeg e configuração
- [ ] SI-03.2 — Implementar o StorageModule (S3/MinIO)
- [ ] SI-03.3 — Criar a entidade Video, a migration e o gerador de publicId
- [ ] SI-03.4 — Configurar a fila `video-processing` e o publisher
- [ ] SI-03.5 — Implementar o VideosService do handshake de upload
- [ ] SI-03.6 — Expor os endpoints de pré-cadastro e handshake de upload
- [ ] SI-03.7 — Concluir o upload e enfileirar o processamento
- [ ] SI-03.8 — Expor o detalhe do vídeo com URLs de streaming e download
- [ ] SI-03.9 — Implementar a extração de metadados e a geração de thumbnail com FFmpeg
- [ ] SI-03.10 — Implementar o worker de processamento (entrypoint, processor, falhas e reconciliador)
- [ ] SI-03.11 — Atualizar o testing-guide-nestjs-project para storage, fila e FFmpeg reais
- [ ] SI-03.12 — Documentar vídeos, fila, worker e storage nos CLAUDE.md e no diagrama de arquitetura

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
