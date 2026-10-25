---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-upload-complete.e2e-spec.ts
---

# Conclusão do upload e enfileiramento do processamento — Test Plan

## Application Overview

`POST /videos/:publicId/upload/complete` é o gatilho do processamento. A API lista as partes recebidas pelo storage, completa o multipart, confere o tamanho do objeto final contra o `sizeBytes` declarado, muda o vídeo para `processing` e, só depois do commit, publica o job `process-video` na fila `video-processing` com `jobId = videoId`. A chamada é idempotente: repeti-la com o vídeo fora de `awaiting_upload` responde `202` com o estado atual, sem novo job. Partes faltando respondem `409 UPLOAD_INCOMPLETE` sem completar nada; tamanho divergente responde `409 UPLOAD_SIZE_MISMATCH`, remove o objeto e marca o vídeo `failed`. Só o dono do canal pode chamar a rota.

## Test Scenarios

### 1. Concluir upload e enfileirar process-video

**Setup:** `beforeAll` — `Test.createTestingModule({ imports: [AppModule] }).compile()`, reproduzindo de `main.ts` o `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` e os filtros `DomainExceptionFilter` + `ValidationExceptionFilter`; `S3_PUBLIC_ENDPOINT=http://minio:9000` sobrescrito antes do bootstrap; fila obtida por `app.get(getQueueToken('video-processing'))` (a API só publica — nenhum worker consome durante o teste). `beforeEach` — `cleanAllTables(dataSource)` + `throttlerStorage.storage.clear()` + `queue.obliterate({ force: true })`; dono e outro usuário confirmados e logados. Helper: pré-cadastrar (`POST /videos`), pedir a URL da parte (`GET .../upload/part-urls`) e fazer `PUT` dos bytes direto no storage. `afterAll` — `queue.obliterate({ force: true })`, limpa objetos do bucket de teste e `app.close()`.

#### 1.1. complete-retorna-202-e-publica-job

**Covers AC:** #1, #5
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Pré-cadastrar um vídeo com `sizeBytes: 1024` (`partCount: 1`) e enviar a parte 1 com exatamente 1024 bytes
  2. POST /videos/{publicId}/upload/complete com token do dono
    - expect: status `202` com `{ id, publicId, processingStatus: "processing" }`
    - expect: `queue.getJob(id)` retorna um job de nome `process-video`, `data = { videoId: id }` e `id` igual ao `id` do vídeo
    - expect: no banco, `videos.upload_id` é `null` e `videos.size_bytes` é `1024`
    - expect: o objeto `videos/{id}/original` existe no bucket

#### 1.2. complete-repetido-e-idempotente

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Executar o fluxo de 1.1 até o primeiro `complete` responder `202`
  2. POST /videos/{publicId}/upload/complete de novo, com token do dono
    - expect: status `202` com `processingStatus: "processing"`
    - expect: a fila continua com exatamente um job para esse vídeo (`queue.getJobCounts()` soma 1 entre `waiting`/`delayed`/`active`)

### 2. Upload incompleto ou com tamanho divergente

**Setup:** igual ao grupo 1.

#### 2.1. partes-faltando-retorna-409-e-upload-segue-retomavel

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Pré-cadastrar um vídeo com `sizeBytes` maior que um `partSize` (ex.: `67108864 + 1024`, `partCount: 2`) e enviar só a parte 1 (bytes pequenos)
  2. POST /videos/{publicId}/upload/complete com token do dono
    - expect: status `409` com `error: "UPLOAD_INCOMPLETE"`
    - expect: o vídeo continua `processingStatus = awaiting_upload` com `upload_id` não nulo
    - expect: nenhum job foi adicionado à fila
  3. GET /videos/{publicId}/upload/parts com token do dono
    - expect: status `200` com a parte 1 listada

#### 2.2. tamanho-divergente-retorna-409-e-marca-failed

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Pré-cadastrar um vídeo com `sizeBytes: 2048` (`partCount: 1`) e enviar a parte 1 com só 1024 bytes
  2. POST /videos/{publicId}/upload/complete com token do dono
    - expect: status `409` com `error: "UPLOAD_SIZE_MISMATCH"`
    - expect: no banco, `processing_status = failed` e `processing_error` começa com `UPLOAD_SIZE_MISMATCH`
    - expect: o objeto `videos/{id}/original` não existe no bucket (`HeadObject` responde not found)
    - expect: nenhum job foi adicionado à fila

### 3. Autorização

**Setup:** igual ao grupo 1; um vídeo do dono com a parte 1 enviada.

#### 3.1. complete-por-outro-usuario-ou-sem-token

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. POST /videos/{publicId}/upload/complete com o token do outro usuário
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. POST /videos/{publicId}/upload/complete sem `Authorization`
    - expect: status `401`
    - expect: em ambos os casos o vídeo segue `awaiting_upload` e a fila está vazia
