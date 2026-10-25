---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-10T12:23:06-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T01:13:33-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-10T12:23:06-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-10T12:23:06-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-10T12:23:06-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-10T12:23:06-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-10T12:23:06-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** _The phase text names no subproject paths, and there is no `Subprojetos:` line._

**Deferred subprojects:** _None._

**Sequencing notes:** > Depende de: Fase 01, Fase 02 — "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (> Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (> Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Tecnologia de Fila | decided | A (BullMQ + Redis via `@nestjs/bullmq`; serviço `redis` sem porta publicada no host) | bullmq, @nestjs/bullmq |
| phase-03-videos/TD-02 | phase | Cross-layer | Estratégia de Upload de até 10GB (Contrato de Upload Direto…) | decided | A (S3 multipart com URL pré-assinada por parte, partes de 64MiB; Uppy só no cliente futuro, não instalado na Fase 03) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-03 | phase | Backend | Organização do Storage (Buckets, Chaves e Política de Acesso) | decided | A (um bucket privado, chaves `videos/{videoId}/original` e `videos/{videoId}/thumbnail.jpg`) | @aws-sdk/client-s3 |
| phase-03-videos/TD-04 | phase | Repo-wide | Origem da Imagem MinIO no Docker Compose | decided | A (`pgsty/minio` com tag `RELEASE.*` fixada) | — |
| phase-03-videos/TD-05 | phase | Cross-layer | Endpoint Interno vs Público para Assinar URLs | decided | A (`S3_ENDPOINT` interno para operações + `S3_PUBLIC_ENDPOINT` só para assinatura) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-06 | phase | Cross-layer | Pré-cadastro do Vídeo e Ciclo de Status | decided | B (eixos ortogonais `processingStatus` + `publicationStatus = draft`) | — |
| phase-03-videos/TD-07 | phase | Backend | Gatilho do Processamento após o Upload | decided | A (API completa o multipart e enfileira com `jobId = videoId` + reconciliador) | @aws-sdk/client-s3, bullmq |
| phase-03-videos/TD-08 | phase | Backend | Retries e Tratamento de Falha no Processamento | decided | B (transitória com 3× backoff exponencial vs permanente com `UnrecoverableError`) | bullmq |
| phase-03-videos/TD-09 | phase | Cross-layer | Estratégia de URL Única e Curta por Vídeo | decided | B (id público aleatório de 11 caracteres base64url, `UNIQUE` + retry) | — |
| phase-03-videos/TD-10 | phase | Cross-layer | Streaming (Range / 206 Partial Content) e Download | decided | A (GET pré-assinado direto ao storage para stream e download; só para o dono autenticado na Fase 03) | @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-11 | phase | Backend | Execução do Worker (Processo/Container) e Invocação do FFmpeg | decided | A (mesmo código-base, entrypoint e container `video-worker` separados; `spawn` de ffprobe/ffmpeg; FFmpeg no `Dockerfile.dev` compartilhado) | — |
|     └─ Last revision: 2026-10-25 — Fixa o conjunto de metadados extraídos pelo ffprobe e persistidos no vídeo (AMB-1) | | | | | | |
| phase-03-videos/TD-12 | phase | Backend | Estratégia de Testes para Storage, Fila e FFmpeg | decided | B (MinIO, Redis e FFmpeg reais via Compose, isolamento por bucket/prefixo de fila) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-12 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-05 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-11, phase-03-videos/TD-12 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-09 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-05, phase-03-videos/TD-10 |
| Download do vídeo pelo usuário | phase-03-videos/TD-05, phase-03-videos/TD-10 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** é a única opção com integração oficial NestJS *e* semântica de job queue pronta (retry exponencial, stalled jobs, `UnrecoverableError`, `jobId` idempotente), bate com o container separado do diagrama e com o testing guide atual; o custo é um container Redis (`redis:8-alpine`, ou `valkey/valkey` se a licença incomodar). **Compose:** o serviço `redis` **não publica a porta 6379 no host** (sem `ports:`), fica acessível só pela rede interna do Compose (host `redis`). Isso evita conflito com outros Redis locais, e API, worker e testes, que rodam em containers, não precisam da porta no host. pg-boss é a alternativa honesta: troca a integração oficial e o broker dedicado pela garantia transacional — se o time valorizar mais "zero infra nova" do que a integração NestJS, B é defensável. Ganha-se maturidade de ferramenta; perde-se atomicidade DB+fila, compensada em TD-07.
**Libraries:** bullmq, @nestjs/bullmq

### phase-03-videos/TD-02

**Recommendation:** atende 10GB sem passar bytes pela API nem pelo BFF, contorna o limite de 5GB e retoma por parte usando só a API S3 que o projeto já assume. O Uppy evita reescrever concorrência/retry, e o contrato de backend é idêntico ao da Option B, então trocar o cliente depois é barato. **Escopo da Fase 03:** o Uppy é a recomendação para o cliente *futuro* e **não é instalado agora**. Nesta fase só o lado backend do contrato é entregue (endpoints de iniciar / assinar partes / listar partes / completar / abortar), e os testes e2e simulam o navegador: pedem as URLs assinadas das partes e fazem `PUT` HTTP direto nelas (lendo o `ETag` da resposta), antes de chamar o `complete`. Parâmetros sugeridos: partes fixas de **64MiB** (10GB ≈ 160 partes, bem abaixo de 10.000); validar `size ≤ 10GB` e `content-type video/*` na criação; `uploadId` persistido no vídeo. Dependências: TD-05 (endpoint usado para assinar) e TD-07 (quem completa).
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-03

**Recommendation:** é a mais simples e a única sem risco de vazamento para rascunho/unlisted (Fase 04). O custo de assinar thumbnails é só HMAC local. Se o cache de thumbnail virar problema medido (Fase 06, listagens), adicionar um prefixo público é uma evolução isolada. Bucket criado de forma idempotente no boot/test setup via SDK (`CreateBucket` tolerando "already owned"), sem depender da imagem `mc`.
**Libraries:** @aws-sdk/client-s3

### phase-03-videos/TD-04

**Recommendation:** é a única opção hoje que junta disponibilidade, versão fixável e correções contínuas. O uso é só local/testes (produção aponta para S3 real ou outro serviço S3-compatível via env), então a falta de SLA é aceitável. Fallback documentado: Option B se o fork parar. Vale registrar a digest no compose para blindar contra retag.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** é o único arranjo que cumpre ao mesmo tempo a regra Docker do CLAUDE.md, o "sem bytes pela API/BFF" de TD-02 e a portabilidade entre SOs, ao custo de uma variável extra. Chaves de env propostas (contrato Joi + `.env.example` + compose): `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true` (obrigatório no MinIO). CORS do MinIO restrito à origem do frontend (`http://localhost:3001`) e expondo `ETag`.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-06

**Recommendation:** separa "o arquivo está pronto?" de "o dono publicou?", que são decisões de fases diferentes, e evita migração de enum na Fase 04. Política de falha: `failed` é terminal para o pipeline automático (ver TD-08 para retries), guarda o motivo e o vídeo continua editável/excluível. **Uploads abandonados na Fase 03:** a limpeza se limita às partes órfãs de multipart incompleto, feita pelo próprio storage. Em S3 isso é uma regra de lifecycle do bucket `AbortIncompleteMultipartUpload` (ex.: `DaysAfterInitiation: 1`). **No MinIO essa regra não é aceita:** testado em 2026-10-24 com `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, `mc ilm import` rejeita `AbortIncompleteMultipartUpload` ("XML … did not validate against our published schema"), enquanto uma regra `Expiration` de controle, no mesmo formato, é aceita. O equivalente no MinIO é a config de servidor `stale_uploads_expiry` (default `24h`, varredura a cada `6h`, ajustável via `MINIO_API_STALE_UPLOADS_EXPIRY`), que já vem ativa sem configuração. Um job de limpeza de vídeos presos em `awaiting_upload` (linhas no banco) **fica fora do escopo da Fase 03**. Valores de enum são parte do contrato OpenAPI consumido pelo frontend (codegen `next-frontend-openapi-typing/TD-01`).
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** mantém credenciais e validação no servidor, é portátil entre MinIO e S3 sem configurar eventos de storage, e o BullMQ dedup por `jobId = videoId` deixa o `complete` idempotente (retomada ou duplo clique não geram dois jobs). A janela "status mudou mas job não entrou" (falta de transação DB+Redis) fecha com: enfileirar *depois* do commit e um reconciliador leve (no boot do worker ou periódico) que re-enfileira vídeos `processing` sem job ativo. Se a escolha em TD-01 for pg-boss, o enqueue vai na mesma transação e o reconciliador deixa de ser necessário.
**Libraries:** @aws-sdk/client-s3, bullmq

### phase-03-videos/TD-08

**Recommendation:** é o mínimo que dá feedback correto e rápido usando `UnrecoverableError` + `attempts/backoff` do BullMQ, sem custo de produto extra. O arquivo original **não é apagado** em falha (permite diagnóstico e reprocessamento futuro). O reprocessamento manual (C) fica como candidato a tarefa da Fase 04, junto do painel.
**Libraries:** bullmq

### phase-03-videos/TD-09

**Recommendation:** é a única curta *e* não enumerável, requisito implícito do unlisted da Fase 04. Gerado no pré-cadastro (TD-06), então a URL existe desde o início do upload. Preferir `crypto.randomBytes` nativo em vez de `nanoid`: o `nanoid` atual é ESM-only, e o backend é CommonJS (ts-jest), o que evita atrito de módulo.
**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** entrega Range/206 nativo sem código e sem tráfego de mídia na API, mantém a autorização na API e é idêntico em produção. Streaming adaptativo (HLS/DASH) **não** é requisito da fase (o plano pede só reprodução sem download completo e extração de metadados), então fica como evolução futura. Os campos `streamUrl`/`downloadUrl` só são emitidos com `processingStatus = ready`. **Regra de autorização da Fase 03:** todo vídeo ainda é rascunho, então `streamUrl` e `downloadUrl` só são emitidos para o **dono do canal autenticado**. Qualquer outro solicitante (anônimo ou outro usuário) não recebe as URLs. Acesso anônimo, público e unlisted fica para as Fases 04/05, quando existirem publicação e visibilidade.
**Libraries:** @aws-sdk/s3-request-presigner

### phase-03-videos/TD-11

**Recommendation:** cumpre a separação do diagrama sem duplicar o domínio, evita uma dependência abandonada e mantém o FFmpeg na imagem (mesmo binário em dev, testes e produção). Ler o original por URL interna evita copiar 10GB para o disco do worker. Frame da thumbnail em ~10% da duração (mínimo 1s, limitado à duração) evita telas pretas de abertura. **Imagem decidida:** o FFmpeg (`ffmpeg` + `ffprobe`) é instalado no `nestjs-project/Dockerfile.dev`, **compartilhado pelos serviços `nestjs-api` e `video-worker`**. Os dois serviços usam a mesma imagem e diferem só no comando/entrypoint, o que permite rodar os testes de integração do processor dentro do container `nestjs-api` (ver TD-12).
**Libraries:** —

**Revisions:**
- 2026-10-25 — Fixa o conjunto de metadados extraídos pelo ffprobe e persistidos no vídeo: `durationSeconds`, `width`, `height`, `videoCodec`, `audioCodec` (nullable), `formatName`, `bitrate`, `frameRate`, `sizeBytes`; a saída JSON bruta do ffprobe é descartada (não persistida). Rationale: resolve AMB-1 de `phase-03-videos` (validation.md) — o conjunto é contrato entre entidade/migration, resposta da API (OpenAPI, consumida pelo painel da Fase 04) e asserções dos testes de integração do processor.

### phase-03-videos/TD-12

**Recommendation:** o filesystem local deixou de testar o que importa assim que o upload virou multipart pré-assinado direto ao storage, e o projeto já segue "serviço real via Compose" para Postgres e e-mail. **FFmpeg nos testes:** como o FFmpeg fica no `Dockerfile.dev` compartilhado por `nestjs-api` e `video-worker` (TD-11), os testes de integração do processor (ffprobe/ffmpeg reais sobre as fixtures) rodam dentro do container `nestjs-api`, como o resto da suíte. **Entregável desta fase:** atualizar `testing-guide-nestjs-project` faz parte da Fase 03: a seção "Object Storage — Local Filesystem" vira "Object Storage — MinIO real (Docker)", a seção de fila passa a usar Redis com host `redis`, e entra uma seção nova para FFmpeg/fixtures. Fica como **tarefa separada** só a correção dos defaults `localhost` antigos nos exemplos já existentes do guia (Postgres, Mailpit), que conflitam com a regra Docker do CLAUDE.md.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).

**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.

**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.

**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.

**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.

**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.

**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.

**Libraries:** @nestjs/swagger

**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env validation: `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })` with the Joi schema in `src/config/env.validation.ts`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

_(from `testing-guide-nestjs-project` § 3 Feature Implementation Checklist, plus `artifacts/future-types.md` § Queue Consumers / Processors)_

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
| Queue processor with business logic | Unit (mock deps) + Integration (real DB/storage) |
| Queue processor with only external system calls | Integration (real systems) |
