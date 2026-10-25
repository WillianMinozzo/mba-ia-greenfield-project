---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-detail.e2e-spec.ts
---

# Detalhe do vídeo com URLs de streaming e download — Test Plan

## Application Overview

`GET /videos/:publicId` entrega ao dono do canal o estado completo do vídeo: status de processamento e publicação, erro de processamento, metadados de mídia extraídos pelo worker e, **somente** quando `processingStatus = ready`, as URLs pré-assinadas `streamUrl`, `downloadUrl` e `thumbnailUrl` (válidas por 4h, com `urlsExpireAt`). As URLs apontam direto ao storage: o streaming usa o suporte nativo a `Range`/`206` do MinIO/S3 e o download força `Content-Disposition: attachment` com o nome original do arquivo. Nenhum byte de mídia passa pela API. Outro usuário autenticado recebe `404 VIDEO_NOT_FOUND`; sem token, `401`.

## Test Scenarios

### 1. Detalhe antes do processamento concluir

**Setup:** `beforeAll` — `Test.createTestingModule({ imports: [AppModule] }).compile()`, reproduzindo de `main.ts` o `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` e os filtros `DomainExceptionFilter` + `ValidationExceptionFilter`; `S3_PUBLIC_ENDPOINT=http://minio:9000` sobrescrito antes do bootstrap (as URLs assinadas são seguidas de dentro do container). `beforeEach` — `cleanAllTables(dataSource)` + `throttlerStorage.storage.clear()`; dono e outro usuário confirmados e logados. `afterAll` — limpa objetos do bucket de teste e `app.close()`.

#### 1.1. detalhe-sem-urls-fora-de-ready

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Pré-cadastrar um vídeo do dono (`POST /videos`) e chamar GET /videos/{publicId} com token do dono
    - expect: status `200` com `processingStatus: "awaiting_upload"`, `publicationStatus: "draft"`, `originalFilename`, `contentType` e `sizeBytes` do pré-cadastro
    - expect: `streamUrl`, `downloadUrl`, `thumbnailUrl` e `urlsExpireAt` iguais a `null`
  2. Atualizar a linha no banco para `processing_status = 'processing'` e chamar GET /videos/{publicId} de novo
    - expect: status `200` com `processingStatus: "processing"` e as três URLs `null`

### 2. Detalhe de vídeo pronto — URLs assinadas

**Setup:** igual ao grupo 1. Arrange de um vídeo `ready` sem depender do worker: pré-cadastrar, enviar e completar o upload de um arquivo de pelo menos 2048 bytes (ou gravar `videos/{id}/original` direto pelo `StorageService`), gravar `videos/{id}/thumbnail.jpg` no bucket e atualizar a linha para `processing_status = 'ready'` com `processed_at`, `duration_seconds`, `width`, `height`, `video_codec`, `format_name`, `bitrate`, `frame_rate` preenchidos.

#### 2.1. detalhe-ready-com-urls-e-metadados

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. GET /videos/{publicId} com token do dono
    - expect: status `200` com `processingStatus: "ready"` e `streamUrl`, `downloadUrl`, `thumbnailUrl` strings não vazias
    - expect: `urlsExpireAt` entre 3h55 e 4h05 a partir de agora
    - expect: `durationSeconds`, `width`, `height`, `videoCodec`, `formatName`, `bitrate`, `frameRate` iguais aos gravados e `processedAt` ISO-8601

#### 2.2. stream-url-responde-206-com-range

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Obter `streamUrl` via GET /videos/{publicId}
  2. GET na `streamUrl` (direto ao storage, sem `Authorization`) com `Range: bytes=0-1023`
    - expect: status `206 Partial Content`
    - expect: header `Content-Range` começando com `bytes 0-1023/`
    - expect: corpo com exatamente 1024 bytes

#### 2.3. download-url-forca-attachment-com-nome-original

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Obter `downloadUrl` via GET /videos/{publicId}
  2. GET na `downloadUrl` (direto ao storage)
    - expect: status `200`
    - expect: header `Content-Disposition` igual a `attachment; filename="{original_filename}"`

### 3. Autorização e falha de processamento

**Setup:** igual ao grupo 1.

#### 3.1. detalhe-por-outro-usuario-ou-sem-token

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Pré-cadastrar um vídeo do dono e chamar GET /videos/{publicId} com o token do outro usuário
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. GET /videos/{publicId} sem `Authorization`
    - expect: status `401`

#### 3.2. detalhe-failed-expoe-processing-error

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Pré-cadastrar um vídeo do dono e atualizar a linha para `processing_status = 'failed'` e `processing_error = 'MEDIA_INVALID: no video stream'`
  2. GET /videos/{publicId} com token do dono
    - expect: status `200` com `processingStatus: "failed"` e `processingError: "MEDIA_INVALID: no video stream"`
    - expect: as três URLs `null`
