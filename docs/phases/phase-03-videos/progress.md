# phase-03-videos — Progress

**Status:** completed
**SIs:** 12/12 completed

### SI-03.1 — Infra: dependências, serviços Compose, FFmpeg e configuração
- **Status:** completed
- **Tests:** 8 passing (env.validation.integration-spec.ts)
- **Observations:**
  - Porta 5432 do host estava ocupada pelo container `aquamagic-pg` (outro projeto); parado com autorização do usuário para o `db` subir.
  - `video-worker` sobe e compila em watch, mas o entrypoint `src/worker.main.ts` só nasce em SI-03.10 — até lá o processo não executa nada (esperado pelo plano).
  - Credenciais locais do MinIO: `MINIO_ROOT_USER=streamtube` / `MINIO_ROOT_PASSWORD=streamtube-secret`, espelhadas em `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` no `.env` e `.env.example`.

### SI-03.2 — Implementar o StorageModule (S3/MinIO)
- **Status:** completed
- **Tests:** 9 passing (storage.module.spec, storage.service.spec, storage.service.integration-spec)
- **Observations:**
  - `StorageModule` ainda não é importado pelo `AppModule`; o bucket passa a ser criado no boot quando o `VideosModule` (SI-03.5) importar o módulo.

### SI-03.3 — Criar a entidade Video, a migration e o gerador de publicId
- **Status:** completed
- **Tests:** 12 passing (video.entity.integration-spec, public-id.util.spec, migrations.integration-spec) + channel.entity.integration-spec verde
- **Observations:**
  - Como `Channel` ganhou `OneToMany` para `Video`, `Video` foi adicionado às listas locais `ALL_ENTITIES` de 10 testes existentes (auth, channels, users) — sem isso o metadata do TypeORM falha em qualquer DataSource com `Channel`.
  - Migration gerada: `1792948501271-CreateVideos.ts`; `up`/`down` confirmados com `migration:run`/`migration:revert` no container.
  - Colunas `bigint`/`numeric` usam um `ValueTransformer` para voltar como `number` (o pg devolve string).

### SI-03.4 — Configurar a fila `video-processing` e o publisher
- **Status:** completed
- **Tests:** 4 passing (video-processing.publisher.integration-spec, video-processing-queue.module.spec)
- **Observations:**
  - **Desvio do plano:** `bullmq@6` tornou o `ioredis` peer opcional (changelog 6.0.0) — instalado `ioredis@^5.11.1` explicitamente; sem ele a fila não conecta.
  - **Desvio do plano:** `@nestjs/bullmq@12` e `@nestjs/bull-shared@12` são ESM puros. O runtime (Node 25, `require(esm)`) carrega normalmente, mas o Jest não: adicionados `transformIgnorePatterns` e um transform `.js` via `ts-jest` com `allowJs` em `package.json#jest` e `test/jest-e2e.json`.
  - Conexão Redis compartilhada em `src/queue/queue.module.ts` (`QueueModule`, `BullModule.forRootAsync`), já importada no `AppModule`; o `WorkerModule` (SI-03.10) reutiliza o mesmo módulo.

### SI-03.5 — Implementar o VideosService do handshake de upload
- **Status:** completed
- **Tests:** 17 passing (videos.service.spec 11, videos.service.integration-spec 3, videos.module.spec 1, channels.service.integration-spec +2)
- **Observations:**
  - `ChannelsService` já era exportado pelo `ChannelsModule`; só `findByUserId` foi adicionado.
  - Helper novo `src/test/video-test-module.ts` monta Config + TypeORM + BullMQ (prefixo único) para os testes que usam Postgres/MinIO/Redis reais e aplica o override `S3_PUBLIC_ENDPOINT=http://minio:9000`.
  - AC de `abortUpload` verificado por `ListParts` → `NoSuchUpload` (equivalente ao `UploadId` sumir de `ListMultipartUploads`).

### SI-03.6 — Expor os endpoints de pré-cadastro e handshake de upload
- **Status:** completed
- **Tests:** 18 passing (parse-public-id.pipe.spec 7, test/videos-upload.e2e-spec.ts 11)
- **Observations:**
  - E2E gerado a partir de `nestjs-project/specs/videos-upload.plan.md` (10 cenários → 11 `test()`; o grupo 3 ganhou o caso 401 do cenário 3.3).
  - Helper compartilhado `test/utils/video-e2e.ts`: boot do `AppModule` como no `main.ts`, bucket dedicado `streamtube-e2e`, override `S3_PUBLIC_ENDPOINT=http://minio:9000`, login de usuários e `emptyE2eBucket`. Timeout dos suites de vídeo em 60s (boot conecta Postgres/MinIO/Redis).
  - Request DTO sem `@ApiProperty` (regra `nestjs-dtos.md`); response DTOs e `partNumbers` (string no fio, `number[]` após transform) com `@ApiProperty` explícito.
  - Pré-existente, fora de escopo: `npm run openapi:export` roda via `ts-node` sem o plugin do Swagger, então request DTOs (inclusive os de auth) saem com `properties: {}` no `openapi.json`.
  - `openapi.json` regenerado: as quatro operações aparecem sob a tag `videos` com 400/401/404/409 documentados.

### SI-03.7 — Concluir o upload e enfileirar o processamento
- **Status:** completed
- **Tests:** videos.service.spec +6, videos.service.integration-spec +1 (upload real de 2 partes, 64MiB + 1KiB), test/videos-upload-complete.e2e-spec.ts 5 — todos verdes
- **Observations:**
  - **Fora do plano (necessário):** `QUEUE_PREFIX` opcional em `queue.config`/`env.validation`/`.env*` (default `bull`, o padrão do BullMQ). Os e2e usam um prefixo único para não dividir a fila `video-processing` com o container `video-worker`, que consome o mesmo Redis e o mesmo banco.
  - Troca de status para `processing` feita num único `UPDATE` (atômico) seguido do enqueue; não foi preciso `dataSource.transaction` explícita para um só statement.
  - E2E gerado a partir de `nestjs-project/specs/videos-upload-complete.plan.md` (5 cenários).

### SI-03.8 — Expor o detalhe do vídeo com URLs de streaming e download
- **Status:** completed
- **Tests:** videos.service.spec +5 (22 no arquivo), test/videos-detail.e2e-spec.ts 6 — verdes; `tsc --noEmit` limpo
- **Observations:**
  - E2E gerado a partir de `nestjs-project/specs/videos-detail.plan.md` (6 cenários); o estado `ready` é montado gravando original/thumbnail no bucket e atualizando a linha, sem worker.
  - Mapeamento entidade → `VideoResponseDto` isolado em `src/videos/video-response.mapper.ts` para manter o controller fino.

### SI-03.9 — Implementar a extração de metadados e a geração de thumbnail com FFmpeg
- **Status:** completed
- **Tests:** 18 passing (ffmpeg-runner.spec, thumbnail.service.spec, media-probe.service.integration-spec, thumbnail.service.integration-spec)
- **Observations:**
  - Classificação de erro: só stderr com `Invalid data found when processing input`/`moov atom not found` vira `MediaInvalidError`/`ThumbnailFailedError`; `Connection refused`, DNS, 403 e timeout ficam transitórios — necessário para a AC de SI-03.10 "MinIO indisponível → PROCESSING_FAILED".
  - Fixtures geradas com `-pix_fmt yuv420p` (H.264 compatível) em `test/fixtures/videos/`, comando registrado no README.

### SI-03.10 — Implementar o worker de processamento (entrypoint, processor, falhas e reconciliador)
- **Status:** completed
- **Tests:** 37 passing em src/video-processing (processor.spec 6, processor.integration-spec 4, reconciler.integration-spec 3, worker.module.spec 1 + suites anteriores) + verificação de runtime com o container video-worker
- **Observations:**
  - **Bug encontrado e corrigido:** o stderr do ffprobe/ffmpeg ecoa a URL pré-assinada (com assinatura) e ela ia parar em `processing_error` (exposto no `GET /videos/:publicId`) e no `failedReason` do Redis. Adicionado `redactInput` (`media.errors.ts`) — a URL vira `<input>`; coberto por teste em `media-probe.service.integration-spec`.
  - Runtime verificado com o `video-worker` real: `sample-2s.mp4` → `ready` (2.000s, 320x240, 25fps, thumbnail `image/jpeg`); `invalid.mp4` → `failed`/`MEDIA_INVALID` com 1 tentativa; original ausente (404) → 3 tentativas com backoff e `PROCESSING_FAILED`; vídeo `processing` sem job reprocessado até `ready` após `docker compose restart video-worker`; logs sem servidor HTTP; `dist/main.js` e `dist-worker/worker.main.js` coexistem e ambos são ignorados pelo git.
  - A AC "MinIO indisponível" foi exercitada pelo mesmo caminho transitório (objeto ausente → 404), sem derrubar o MinIO.
  - **Fora do plano (necessário):** `publisher.requeue` remove um job retido `completed`/`failed` antes de reenfileirar — senão o `jobId` igual tornaria o `add` do reconciliador um no-op silencioso.
  - Fábricas `CONFIG_MODULE_OPTIONS` (`src/config/config-module.options.ts`) e `TYPEORM_MODULE_OPTIONS` (`src/database/typeorm-module.options.ts`) extraídas do `AppModule` e reutilizadas no `WorkerModule` (sem mudança de comportamento).
  - Observação: integration/e2e e o `video-worker` usam o mesmo banco `streamtube`; resíduos `processing` deixados por testes são reenfileirados pelo reconciliador no boot do worker. Inofensivo (terminam `failed`), mas um banco de teste separado resolveria — tarefa futura.

### SI-03.11 — Atualizar o testing-guide-nestjs-project para storage, fila e FFmpeg reais
- **Status:** completed
- **Tests:** no tests (documentation) — grep de "Local Filesystem|local adapter|local filesystem" no guia sem ocorrências
- **Observations:**
  - Seções novas em `references/external-systems.md`: "Object Storage — MinIO real (Docker)", "Message Queue — Real (Docker)" (host `redis`, `prefix` único, `obliterate`, nota do ESM do `@nestjs/bullmq`) e "FFmpeg — binário real + fixtures".
  - Tabela do § 3 do `SKILL.md` ganhou as linhas de queue publisher e queue processor; `artifacts/future-types.md → Queue Consumers / Processors` reescrito com o caso `UnrecoverableError` vs retry.
  - Exemplos de Postgres/Mailpit com default `localhost` mantidos (tarefa separada, conforme o plano).

### SI-03.12 — Documentar vídeos, fila, worker e storage nos CLAUDE.md e no diagrama de arquitetura
- **Status:** completed
- **Tests:** no tests (documentation)
- **Observations:**
  - `CLAUDE.md` raiz: arquitetura com BullMQ + Redis, `video-worker`, MinIO `pgsty/minio` e a exceção documentada de `S3_PUBLIC_ENDPOINT` na seção Docker Networking.
  - `nestjs-project/CLAUDE.md`: verificação de `redis`/`minio`/FFmpeg, serviços `minio`/`redis`/`video-worker`, regras de teste com serviços reais e a seção "Videos".
  - `docs/diagrams/software-arch.mermaid`: fila `BullMQ + Redis`, worker `Node.js (BullMQ worker) + FFmpeg`, storage `MinIO (S3-compatible)` e relações de upload/stream direto via URL assinada; estilos mantidos.
