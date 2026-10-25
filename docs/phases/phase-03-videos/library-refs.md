---
libs:
  "bullmq":
    version: "^6.4.2"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-10-25T01:14:01-03:00"
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-25T01:14:01-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1156.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-25T01:14:01-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1156.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-25T01:14:01-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T01:13:33-03:00"
---

# Library References

Trechos de documentação destilados via Context7, focados nas superfícies usadas pelos TDs de `phase-03-videos`. Versões são as publicadas no npm em 2026-10-24 (nenhuma instalada ainda); `@nestjs/bullmq@12` declara peer `bullmq ^3–^6` e `@nestjs/* ^10–^12`, compatível com o NestJS 11 do projeto.

### bullmq

_Usado por: phase-03-videos/TD-01, TD-07, TD-08._

- **Retry com backoff exponencial** — por job ou na fila via `defaultJobOptions`:
  ```ts
  new Queue('video-processing', {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  });
  ```
  Exponencial = `2^(attempts-1) * delay` ms entre tentativas.
- **Falha permanente sem retry** — lançar `UnrecoverableError` (de `bullmq`) no processor move o job direto para `failed`, ignorando `attempts`. Base de TD-08 para mídia inválida.
- **Deduplicação por `jobId`** — `queue.add(name, data, { jobId: videoId })`: um segundo `add` com o mesmo `jobId` é ignorado enquanto o job existir. **Cuidado:** com `removeOnComplete`/`removeOnFail`, jobs removidos deixam de contar como existentes e um duplicado pode entrar (relevante para o `complete` idempotente e o reconciliador de TD-07).
- **Retenção** — `removeOnComplete: true`, `removeOnFail: 1000` (manter os últimos N falhos para diagnóstico).
- **Jobs longos** — `lockDuration` default 30s; o worker renova o lock automaticamente enquanto processa. Aumentar (ex.: `lockDuration: 60_000`) reduz falsos "stalled" quando o event loop fica ocupado; o FFmpeg roda em processo filho (`spawn`), então o loop não bloqueia.
- **Conexão** — workers exigem `maxRetriesPerRequest: null` no ioredis (o BullMQ aplica por padrão e avisa se sobrescrito).
- **Isolamento em testes** — opção `prefix` por fila/suíte + `queue.obliterate({ force: true })` no teardown (TD-12).

### @nestjs/bullmq

_Usado por: phase-03-videos/TD-01, TD-11._

- **Config global assíncrona** (alinha com a convenção `registerAs` + `ConfigType` herdada):
  ```ts
  BullModule.forRootAsync({
    inject: [queueConfig.KEY],
    useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
      connection: { host: cfg.host, port: cfg.port }, // host = 'redis' (serviço Compose)
    }),
  });
  BullModule.registerQueue({ name: 'video-processing' });
  ```
- **Processor** — classe com `@Processor('video-processing')` que estende `WorkerHost` e implementa `async process(job: Job)`. Retorno vira `returnvalue`; rejeição marca falha sujeita a `attempts/backoff`.
- **Eventos do worker** — `@OnWorkerEvent('failed')` (ou `'completed'`, `'stalled'`, `'error'`) em métodos da classe do processor; usado para gravar `processingStatus = failed` + `processingError` na falha final (TD-08). O getter `this.worker` só está disponível a partir de `onApplicationBootstrap`.
- **Publisher** — `@InjectQueue('video-processing') private queue: Queue` no serviço da API.
- **Worker em processo separado (TD-11)** — o entrypoint `worker.main.ts` usa `NestFactory.createApplicationContext(WorkerModule)`; só o módulo que registra o `@Processor` cria `Worker`s. A API registra a fila sem processor (só publica).
- **Testes** — `getQueueToken('video-processing')` resolve o token DI da fila (`BullQueue_video-processing`) para inspecionar jobs (`queue.getJobs(['waiting'])`). `registerQueue` anexa `onApplicationShutdown` que fecha workers/fila — chamar `app.close()`/`module.close()` no `afterAll`.

### @aws-sdk/client-s3

_Usado por: phase-03-videos/TD-02, TD-03, TD-05, TD-07._

- **Cliente para MinIO** — `forcePathStyle: true` coloca o bucket no path (`host/bucket/key`), obrigatório no MinIO:
  ```ts
  new S3Client({
    endpoint: cfg.endpoint,          // interno: http://minio:9000
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  ```
  TD-05: um segundo `S3Client` idêntico com `endpoint: cfg.publicEndpoint` é usado **só** para assinar.
- **Multipart (TD-02/TD-07)** — `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → `UploadId`; partes enviadas pelo cliente via URL assinada de `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })`; `ListPartsCommand({ Bucket, Key, UploadId })` para retomada e para montar a lista na conclusão; `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber, ETag }] } })` com partes **ordenadas por `PartNumber`**; `AbortMultipartUploadCommand({ Bucket, Key, UploadId })` para cancelamento.
- **ETag precisa de CORS** — o navegador só lê o header `ETag` da resposta do `PUT` de parte se o storage o expuser via CORS (o próprio lib-storage acusa "Missing Bucket CORS configuration for ETag header?").
- **Validação pós-upload** — `HeadObjectCommand({ Bucket, Key })` → `ContentLength`, `ContentType` (TD-07).
- **Bucket idempotente** — `CreateBucketCommand({ Bucket })` no boot/test setup, tolerando `BucketAlreadyOwnedByYou` (TD-03).

### @aws-sdk/s3-request-presigner

_Usado por: phase-03-videos/TD-02, TD-05, TD-10._

- **API** — `getSignedUrl(client, command, { expiresIn })`; `expiresIn` default **900s**. A assinatura é cálculo local (HMAC), sem chamada de rede — por isso o cliente "público" de TD-05 não precisa alcançar o storage a partir do container.
- **Upload de parte** — `getSignedUrl(publicClient, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn })`.
- **Stream/download (TD-10)** — `getSignedUrl(publicClient, new GetObjectCommand({ Bucket, Key }), { expiresIn })` para `streamUrl`; para `downloadUrl` incluir `ResponseContentDisposition: 'attachment; filename="..."'` — parâmetros `response-*` **exigem** requisição assinada (não funcionam anônimos), o que casa com o bucket privado de TD-03.
- **Headers** — `Content-Type` não é assinado por padrão (opt-in via `signableHeaders: new Set(['content-type'])`); o payload vai como `UNSIGNED-PAYLOAD`, então `Content-Length` não é imposto pela assinatura — o limite de 10GB é validado na criação do upload e no `HeadObject` pós-conclusão, não na URL.
