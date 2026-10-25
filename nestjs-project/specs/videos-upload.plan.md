---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: test/videos-upload.e2e-spec.ts
---

# Pré-cadastro e handshake de upload de vídeo — Test Plan

## Application Overview

O dono de um canal pré-cadastra um vídeo como rascunho (`POST /videos`), o que inicia um multipart upload no storage S3-compatível (MinIO). Em seguida o cliente pede URLs pré-assinadas por parte (`GET /videos/:publicId/upload/part-urls`), envia os bytes **direto** ao storage com `PUT` nessas URLs, consulta as partes já recebidas para retomar (`GET /videos/:publicId/upload/parts`) ou cancela o upload (`DELETE /videos/:publicId/upload`). Os bytes nunca passam pela API. Todas as rotas exigem JWT; as rotas com `:publicId` só respondem ao dono do canal — outro usuário autenticado, ou um `publicId` malformado, recebe `404 VIDEO_NOT_FOUND`. Erros seguem o envelope `{ statusCode, error, message }`.

## Test Scenarios

### 1. Pré-cadastrar vídeo — POST /videos

**Setup:** `beforeAll` — `Test.createTestingModule({ imports: [AppModule] }).compile()`, reproduzindo de `main.ts` o `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` e os filtros `DomainExceptionFilter` + `ValidationExceptionFilter`; `S3_PUBLIC_ENDPOINT=http://minio:9000` sobrescrito antes do bootstrap (as URLs assinadas precisam ser alcançáveis de dentro do container). `beforeEach` — `cleanAllTables(dataSource)` + `throttlerStorage.storage.clear()`; dois usuários confirmados e logados (dono e outro) via fluxo de auth com `MailService.sendConfirmationEmail` espionado. `afterAll` — aborta multiparts pendentes / limpa objetos do bucket de teste e `app.close()`.

#### 1.1. pre-cadastro-retorna-rascunho-aguardando-upload

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. POST /videos com `Authorization: Bearer <token do dono>` e body `{ filename: "aula.mp4", contentType: "video/mp4", sizeBytes: 15728640 }`
    - expect: status `201`
    - expect: `publicId` com 11 caracteres em `[A-Za-z0-9_-]` e `id` uuid
    - expect: `processingStatus: "awaiting_upload"`, `publicationStatus: "draft"`, `title: "aula.mp4"`
    - expect: `partSize: 67108864` e `partCount: 1`
    - expect: no banco, a linha de `videos` pertence ao canal do dono e tem `upload_id` não nulo

#### 1.2. pre-cadastro-rejeita-body-invalido

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. POST /videos com token válido e `contentType: "image/png"` (demais campos válidos)
    - expect: status `400` com `error: "VALIDATION_ERROR"` e `message` como array
  2. POST /videos com token válido e `sizeBytes: 10737418241`
    - expect: status `400` com `error: "VALIDATION_ERROR"`
    - expect: nenhuma linha criada em `videos`

#### 1.3. pre-cadastro-exige-autenticacao

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. POST /videos sem header `Authorization`, com body válido
    - expect: status `401`
    - expect: nenhuma linha criada em `videos`

### 2. Enviar partes e consultar o progresso — part-urls e parts

**Setup:** igual ao grupo 1; cada cenário pré-cadastra um vídeo do dono com `sizeBytes` pequeno (ex.: 1024, `partCount: 1`) via POST /videos.

#### 2.1. part-url-assinada-aceita-put-direto-no-storage

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. GET /videos/{publicId}/upload/part-urls?partNumbers=1 com token do dono
    - expect: status `200` com `parts` de 1 item `{ partNumber: 1, url }` e `expiresAt` ISO-8601 no futuro
  2. PUT de 1024 bytes na `url` retornada (HTTP direto ao storage, sem `Authorization`)
    - expect: status `200` com header `ETag` presente

#### 2.2. lista-partes-recebidas-apos-put

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Obter a URL da parte 1 e fazer o PUT de 1024 bytes (como em 2.1)
  2. GET /videos/{publicId}/upload/parts com token do dono
    - expect: status `200` com `parts` contendo exatamente `{ partNumber: 1, sizeBytes: 1024, etag }`
    - expect: `etag` igual ao `ETag` devolvido pelo PUT (sem aspas ou normalizado de forma consistente)

#### 2.3. part-number-fora-do-intervalo-rejeitado

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. GET /videos/{publicId}/upload/part-urls?partNumbers=2 com token do dono, num vídeo com `partCount: 1`
    - expect: status `400` com `error: "INVALID_PART_NUMBER"`

#### 2.4. part-urls-rejeita-query-invalida

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. GET /videos/{publicId}/upload/part-urls sem `partNumbers`, com token do dono
    - expect: status `400` com `error: "VALIDATION_ERROR"`
  2. GET /videos/{publicId}/upload/part-urls?partNumbers=abc com token do dono
    - expect: status `400` com `error: "VALIDATION_ERROR"`

### 3. Isolamento por dono e publicId malformado

**Setup:** igual ao grupo 1; um vídeo pré-cadastrado pelo dono.

#### 3.1. outro-usuario-recebe-404-em-rotas-com-publicid

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. Com o token do outro usuário, chamar GET .../upload/part-urls?partNumbers=1, GET .../upload/parts e DELETE .../upload no `publicId` do dono
    - expect: cada chamada responde `404` com `error: "VIDEO_NOT_FOUND"`
    - expect: o vídeo do dono continua existindo em `videos` com `processingStatus = awaiting_upload`

#### 3.2. publicid-malformado-recebe-404

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. GET /videos/abc/upload/parts com token do dono (tamanho errado)
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. GET /videos/{11 caracteres com "!"}/upload/parts com token do dono (fora do alfabeto)
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 3.3. rotas-com-publicid-exigem-autenticacao

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. GET /videos/{publicId}/upload/parts sem `Authorization`
    - expect: status `401`

### 4. Cancelar upload — DELETE /videos/:publicId/upload

**Setup:** igual ao grupo 1; um vídeo pré-cadastrado pelo dono.

#### 4.1. cancelar-remove-pre-cadastro

**Covers AC:** #8
**Source:** auto
**Last sync:** 2026-10-25T17:00:36Z

**Steps:**
  1. DELETE /videos/{publicId}/upload com token do dono
    - expect: status `204` sem corpo
    - expect: a linha do vídeo não existe mais em `videos`
  2. GET /videos/{publicId}/upload/parts com token do dono
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
