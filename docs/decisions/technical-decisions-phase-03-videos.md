---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-10-24
scope_description: "Upload direto de vídeos de até 10GB para storage S3-compatível (MinIO local), fila e worker FFmpeg para metadados/thumbnail, ciclo de status, URL curta única, streaming/download e estratégia de testes com serviços reais via Compose."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — dono de todas as decisões de backend: integração S3 (assinatura de URLs, multipart), entidade/ciclo de status do vídeo, publicação na fila, worker FFmpeg (mesmo código-base, processo separado) e novos serviços no `compose.yaml` (MinIO, Redis, worker).
- `next-frontend/` — **sem entregável na Fase 03.** O desafio desta fase é só backend (API, worker, infra). Os TDs Cross-layer (TD-02, TD-05, TD-09, TD-10) só definem o contrato HTTP que o frontend vai consumir numa fase futura (handshake de upload multipart, URLs assinadas com host público, formato da URL curta, `streamUrl`/`downloadUrl`). Nada é instalado nem implementado em `next-frontend/` nesta fase.

**Premissa fixa (não é decisão aberta):** object storage é S3-compatível (API S3 via `@aws-sdk/client-s3` v3), com MinIO no Docker local. Os TDs abaixo decidem *como* usá-lo.

**Fatos verificados em 2026-10-24 sobre a imagem MinIO** (insumo de TD-04):

- A Community Edition parou de publicar binários/imagens em out/2025, entrou em "maintenance mode" em dez/2025 e o repositório GitHub foi arquivado (somente leitura) em 25/04/2026.
- `minio/minio` e `minio/mc` **foram removidos do Docker Hub** (~11–12/09/2026). Confirmado: `hub.docker.com/v2/repositories/minio/minio/` retorna 404.
- `quay.io/minio/minio` foi o substituto mais citado, mas `docker manifest inspect` em `quay.io/minio/minio:latest`, `:RELEASE.2025-09-07T16-13-09Z` e `:RELEASE.2025-04-22T22-12-26Z` retornou `no such manifest`. **Não dá para contar com ele.**
- `bitnami/minio:latest` também não existe mais.
- Disponíveis: `pgsty/minio` (fork comunitário "SILO", AGPLv3, drop-in, última tag `RELEASE.2026-08-04T00-00-00Z`, com `pgsty/mc`) e `cgr.dev/chainguard/minio` / `minio-client` (no plano gratuito só `:latest`; fixar versão exige plano pago).

**Versões de referência (npm, 2026-10-24) — nenhuma instalada ainda:** `bullmq` 6.4.2, `@nestjs/bullmq` 12.0.0 (peer: `bullmq ^3–^6`, `@nestjs/* ^10–^12`), `pg-boss` 12.38.0, `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` 3.1156.0, `@uppy/aws-s3` 6.3.0. `fluent-ffmpeg` 2.1.3 está **marcado como deprecated no npm** ("Package no longer supported").

---

## TD-01: Tecnologia de Fila

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O diagrama C4 deixa a fila como "TBD". Ela liga a API (que publica o job ao fim do upload) ao Video Worker (que consome). É a principal escolha de stack da fase: define um novo container (ou não), a integração com NestJS, a semântica de retry e a forma dos testes de integração. A carga esperada é baixa (um job por vídeo enviado), mas cada job é longo (segundos a minutos de FFmpeg) e precisa sobreviver a quedas do worker.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Fila em Redis com locks por job, `attempts` + `backoff` exponencial, `UnrecoverableError` para falhas que não devem ser repetidas, eventos `failed`/`completed` e `jobId` customizado para deduplicação. Integração oficial do NestJS (`BullModule.forRoot/registerQueue`, `@Processor` + `WorkerHost`).
- **Pros:** integração oficial e documentada no NestJS 11/12; o testing guide do projeto já usa BullMQ como exemplo (`BullModule.registerQueue({ name: 'video-processing' })`); retry/backoff/stalled-job recovery prontos; dashboards (Bull Board) disponíveis; o mesmo Redis pode servir depois ao `@nestjs/throttler` em produção com várias instâncias.
- **Cons:** novo serviço stateful (Redis) no Compose e em produção; publicar o job e atualizar o Postgres não ficam numa mesma transação (exige `jobId` idempotente + reconciliação, ver TD-07); licença do Redis 8 é tri-licença (RSALv2/SSPLv1/AGPLv3) — sem impacto para uso interno, mas Valkey (BSD) é a alternativa se isso pesar.

### Option B: pg-boss (fila sobre o PostgreSQL existente)
- Jobs ficam em tabelas do próprio Postgres, consumidos com `SKIP LOCKED`. Suporta `retryLimit`, `retryDelay`, `retryBackoff`, `expireInSeconds`, `deadLetter` e `singletonKey`.
- **Pros:** zero infraestrutura nova; o enqueue pode acontecer **na mesma transação** que muda o status do vídeo (elimina a janela de inconsistência DB↔fila); testes reaproveitam o Postgres que já existe.
- **Cons:** sem integração oficial com NestJS (wrapper próprio de módulo/provider/lifecycle); joga carga de polling/escrita na base transacional; ecossistema e exemplos NestJS bem menores; diverge do container "Message Queue" separado previsto no diagrama.

### Option C: RabbitMQ (AMQP via `@nestjs/microservices` ou `amqplib`)
- Broker dedicado com filas duráveis, ack manual, dead-letter exchanges e TTL para retry.
- **Pros:** broker padrão de mercado, roteamento rico, desacoplamento real entre linguagens (útil se o worker um dia for escrito em outra stack).
- **Cons:** retry com backoff exige montar topologia DLX/TTL à mão; o transporte do `@nestjs/microservices` foca em mensagens/eventos, não em job queue (sem estado de job consultável, progresso ou retry por job); mais um serviço pesado (Erlang) no Compose; bem mais complexidade que o volume do projeto pede.

**Recommendation:** **Option A (BullMQ + Redis)** — é a única opção com integração oficial NestJS *e* semântica de job queue pronta (retry exponencial, stalled jobs, `UnrecoverableError`, `jobId` idempotente), bate com o container separado do diagrama e com o testing guide atual; o custo é um container Redis (`redis:8-alpine`, ou `valkey/valkey` se a licença incomodar). **Compose:** o serviço `redis` **não publica a porta 6379 no host** (sem `ports:`), fica acessível só pela rede interna do Compose (host `redis`). Isso evita conflito com outros Redis locais, e API, worker e testes, que rodam em containers, não precisam da porta no host. pg-boss é a alternativa honesta: troca a integração oficial e o broker dedicado pela garantia transacional — se o time valorizar mais "zero infra nova" do que a integração NestJS, B é defensável. Ganha-se maturidade de ferramenta; perde-se atomicidade DB+fila, compensada em TD-07.

**Decision:** _[pending]_

---

## TD-02: Estratégia de Upload de até 10GB (Contrato de Upload Direto ao Storage)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O arquivo não pode passar pela API (nem pelo BFF do Next): 10GB de proxy prendem conexão, memória e banda dos dois processos. Um único `PUT` pré-assinado não serve: o S3 limita PUT único a **5GB** e uma falha no meio perde tudo. Restrições do S3 multipart: partes de 5MiB a 5GiB (a última pode ser menor), no máximo 10.000 partes. Afeta os dois lados: a API expõe o handshake (iniciar / assinar partes / completar / abortar / listar) e o navegador fatia e envia as partes direto ao MinIO. É uma exceção consciente ao BFF estrito (`next-frontend-config-base/TD-03`): o BFF continua sendo o único caminho de *controle*, e os *bytes* vão do navegador direto ao storage, como o diagrama já prevê (`frontend → storage`).

**Options:**

### Option A: S3 Multipart com URLs pré-assinadas por parte + Uppy (`@uppy/aws-s3`, `shouldUseMultipart: true`)
- A API cria o vídeo e o multipart (`CreateMultipartUpload`), guarda o `uploadId` na linha do vídeo e devolve URLs pré-assinadas de `UploadPart` sob demanda. O Uppy cuida do fatiamento, paralelismo, retry por parte e progresso. A retomada chama `ListParts` (via API) e reenvia só as partes que faltam.
- **Pros:** padrão S3 nativo, sem servidor extra; falha de rede custa só uma parte; o Uppy já implementa `createMultipartUpload` / `signPart` / `listParts` / `completeMultipartUpload` / `abortMultipartUpload` como callbacks que apontam para os Route Handlers do BFF; credenciais nunca chegam ao navegador.
- **Cons:** nova dependência no frontend (`@uppy/core` + `@uppy/aws-s3`); o MinIO precisa de CORS que exponha o header `ETag`; retomar depois de recarregar a página exige persistir `uploadId` + `File` (plugin Golden Retriever ou o usuário re-seleciona o arquivo e a API reconcilia via `ListParts`).

### Option B: S3 Multipart pré-assinado com cliente próprio (sem Uppy)
- Mesmo contrato de backend da Option A, mas o frontend implementa à mão o fatiamento (`File.slice`), a fila de concorrência, o retry com backoff e o progresso via `XMLHttpRequest`.
- **Pros:** zero dependência nova; controle total da UX.
- **Cons:** reimplementa lógica não trivial e sujeita a bugs (concorrência, retry, limites de parte, abort); mais testes para manter; nenhum ganho funcional sobre A.

### Option C: Protocolo tus via servidor `tusd` com backend S3
- O navegador fala tus (resumable upload aberto) com um container `tusd`, que grava no MinIO via multipart; hooks HTTP avisam a API (pre-create, post-finish).
- **Pros:** retomada padronizada e robusta, inclusive entre sessões; cliente maduro (`tus-js-client` / Uppy Tus).
- **Cons:** mais um serviço para operar; os bytes passam pelo `tusd` (não pela API, mas é outro salto e outro gargalo); autenticação/autorização via hooks é mais um contrato; duplica algo que o S3 multipart já resolve.

**Recommendation:** **Option A (multipart pré-assinado + Uppy)** — atende 10GB sem passar bytes pela API nem pelo BFF, contorna o limite de 5GB e retoma por parte usando só a API S3 que o projeto já assume. O Uppy evita reescrever concorrência/retry, e o contrato de backend é idêntico ao da Option B, então trocar o cliente depois é barato. **Escopo da Fase 03:** o Uppy é a recomendação para o cliente *futuro* e **não é instalado agora**. Nesta fase só o lado backend do contrato é entregue (endpoints de iniciar / assinar partes / listar partes / completar / abortar), e os testes e2e simulam o navegador: pedem as URLs assinadas das partes e fazem `PUT` HTTP direto nelas (lendo o `ETag` da resposta), antes de chamar o `complete`. Parâmetros sugeridos: partes fixas de **64MiB** (10GB ≈ 160 partes, bem abaixo de 10.000); validar `size ≤ 10GB` e `content-type video/*` na criação; `uploadId` persistido no vídeo. Dependências: TD-05 (endpoint usado para assinar) e TD-07 (quem completa).

**Decision:** _[pending]_

---

## TD-03: Organização do Storage (Buckets, Chaves e Política de Acesso)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** API e worker precisam concordar sobre bucket(s) e formato das chaves: a API gera chaves para o upload, o worker lê o original e grava a thumbnail, e o compose/test setup cria os buckets. É um contrato entre componentes (API, worker, compose, testes). Também define se algo é lido anonimamente ou tudo via URL assinada, o que conversa com a visibilidade unlisted/rascunho da Fase 04.

**Options:**

### Option A: Um bucket privado, prefixo por vídeo
- Bucket único (ex.: `streamtube-media`), sem acesso anônimo. Chaves derivadas só do id interno: `videos/{videoId}/original` e `videos/{videoId}/thumbnail.jpg`. Nome do arquivo e content-type originais ficam no banco (e em `Content-Type`/`Content-Disposition` do objeto).
- **Pros:** um só lugar para configurar CORS, ciclo de vida e credenciais; apagar ou reprocessar um vídeo é operar num prefixo; chaves sem input do usuário (sem path traversal, unicode ou colisão); tudo privado, então rascunho e unlisted nunca vazam por URL adivinhável.
- **Cons:** thumbnails também precisam de URL assinada (custo de CPU desprezível, mas a URL muda a cada emissão e reduz o cache do navegador/CDN).

### Option B: Dois buckets — `videos` privado e `thumbnails` com leitura pública
- Originais privados via URL assinada; thumbnails servidas por URL pública estável.
- **Pros:** thumbnails cacheáveis com URL fixa; listagens (home, canal) não precisam assinar dezenas de URLs.
- **Cons:** thumbnail de rascunho/unlisted fica acessível a quem souber a chave (exige chave não adivinhável); duas políticas e duas configs de CORS; a "custom thumbnail" da Fase 04 herda essa exposição.

### Option C: Bucket por canal/usuário
- Um bucket criado dinamicamente por canal.
- **Pros:** isolamento forte por tenant.
- **Cons:** criação dinâmica de bucket em runtime, limites de buckets no S3 (default de conta) e configuração multiplicada; sem benefício real para o produto.

**Recommendation:** **Option A (um bucket privado, `videos/{videoId}/…`)** — é a mais simples e a única sem risco de vazamento para rascunho/unlisted (Fase 04). O custo de assinar thumbnails é só HMAC local. Se o cache de thumbnail virar problema medido (Fase 06, listagens), adicionar um prefixo público é uma evolução isolada. Bucket criado de forma idempotente no boot/test setup via SDK (`CreateBucket` tolerando "already owned"), sem depender da imagem `mc`.

**Decision:** _[pending]_

---

## TD-04: Origem da Imagem MinIO no Docker Compose

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O MinIO foi fixado como storage local, mas a imagem oficial **não existe mais** nos registries públicos (ver "Fatos verificados" no topo). A escolha aparece em `compose.yaml` (dev e testes) e define atualização de segurança e reprodutibilidade. O código usa só a API S3, então a imagem é trocável sem tocar no código.

**Options:**

### Option A: `pgsty/minio` (fork comunitário SILO), tag fixada
- Fork drop-in do MinIO CE mantido pela comunidade Pigsty, com builds próprios, correções de CVE e o console admin restaurado. Tags `RELEASE.*` (última: `RELEASE.2026-08-04T00-00-00Z`) + `pgsty/mc`.
- **Pros:** disponível hoje e com versões fixáveis; recebe correções após o arquivamento do upstream; mesmo binário, flags e variáveis (`MINIO_ROOT_USER`…), então é troca de uma linha.
- **Cons:** mantido por um indivíduo/comunidade, sem SLA; não é afiliado à MinIO Inc.; risco de o fork também parar (mitigado por ser só dev/test).

### Option B: `cgr.dev/chainguard/minio:latest`
- Imagem minimal/hardened da Chainguard, reconstruída continuamente a partir do fonte.
- **Pros:** imagem enxuta e com poucas CVEs; fornecedor com histórico de manutenção.
- **Cons:** o plano gratuito só oferece `:latest` (fixar versão é pago), então o ambiente deixa de ser reprodutível e um rebuild pode mudar o comportamento sem aviso; entrypoint/usuário podem diferir da imagem oficial.

### Option C: Build próprio a partir do código-fonte arquivado
- Um `Dockerfile` no repo compila o MinIO a partir da última tag do repositório arquivado.
- **Pros:** controle total e reprodutibilidade, sem depender de registry de terceiros.
- **Cons:** build lento e com toolchain Go; congelado sem correções; manutenção de infra que não agrega ao produto.

**Recommendation:** **Option A (`pgsty/minio` com tag `RELEASE.*` fixada)** — é a única opção hoje que junta disponibilidade, versão fixável e correções contínuas. O uso é só local/testes (produção aponta para S3 real ou outro serviço S3-compatível via env), então a falta de SLA é aceitável. Fallback documentado: Option B se o fork parar. Vale registrar a digest no compose para blindar contra retag.

**Decision:** _[pending]_

---

## TD-05: Endpoint Interno vs Público para Assinar URLs

**Scope:** Cross-layer

**Capability:** Transversal — covers: Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** A API roda em container e fala com o MinIO por `http://minio:9000` (regra Docker do projeto: nome do serviço, nunca `localhost`). O navegador roda no host e só alcança o MinIO pela porta publicada (`http://localhost:9000`). Uma URL pré-assinada SigV4 **assina o header `Host`**: uma URL gerada com `minio:9000` não resolve no navegador, e trocar o host depois invalida a assinatura. O contrato afeta o schema Joi/env (`nestjs-project`), o `compose.yaml` e as URLs consumidas pelo `next-frontend` (upload, `<video src>`, download).

**Options:**

### Option A: Dois endpoints configurados — interno para operações, público só para assinar
- `S3_ENDPOINT=http://minio:9000` para chamadas reais (Create/Complete/ListParts/HeadObject, worker). `S3_PUBLIC_ENDPOINT=http://localhost:9000` num segundo `S3Client` usado **só** por `getSignedUrl`, que é cálculo local de HMAC e não abre conexão. Em produção, os dois apontam para o endpoint público do S3/CDN.
- **Pros:** respeita a regra Docker sem gambiarra de DNS; funciona igual em Windows/macOS/Linux; em produção vira uma só config (mesmo valor); sem proxy no caminho dos bytes.
- **Cons:** duas variáveis e dois clientes para manter coerentes; um teste precisa garantir que URLs pré-assinadas nunca saem com o host interno.

### Option B: Hostname único resolvível dentro e fora (ex.: `host.docker.internal:9000` ou entrada `minio` no hosts do SO)
- Um só endpoint cujo nome resolve tanto nos containers (`extra_hosts: host-gateway`, como o `next-frontend` já faz) quanto no navegador.
- **Pros:** um único `S3Client` e uma variável.
- **Cons:** `host.docker.internal` do lado do navegador não resolve por padrão no host (ou exige editar o `hosts` de cada dev); o tráfego API→MinIO sai pela rede do host em vez da rede do Compose; viola o espírito da regra "use o nome do serviço"; frágil entre sistemas operacionais.

### Option C: Proxy reverso na mesma origem do frontend (Next rewrites / nginx) preservando `Host`
- O navegador fala com `/storage/...` no domínio do frontend, e o proxy encaminha ao MinIO reescrevendo o host para o assinado.
- **Pros:** sem CORS (mesma origem); esconde o endpoint do storage.
- **Cons:** os 10GB voltam a passar por um processo intermediário (o Next), contrariando TD-02; reescrever `Host` sem quebrar a SigV4 é delicado; mais um componente no caminho do streaming.

**Recommendation:** **Option A (endpoint interno + endpoint público só para assinatura)** — é o único arranjo que cumpre ao mesmo tempo a regra Docker do CLAUDE.md, o "sem bytes pela API/BFF" de TD-02 e a portabilidade entre SOs, ao custo de uma variável extra. Chaves de env propostas (contrato Joi + `.env.example` + compose): `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true` (obrigatório no MinIO). CORS do MinIO restrito à origem do frontend (`http://localhost:3001`) e expondo `ETag`.

**Decision:** _[pending]_

---

## TD-06: Pré-cadastro do Vídeo e Ciclo de Status (Rascunho → Processando → Pronto/Erro)

**Scope:** Cross-layer

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** O vídeo nasce no banco ao *iniciar* o upload (antes de existir bytes) e precisa expor em que etapa está. O frontend mostra esse estado (enviando, processando, erro). A Fase 04 adiciona "rascunho → publicação" e visibilidade. Se upload/processamento e publicação forem misturados num enum só, a Fase 04 reabre esta modelagem. O status também é o que o worker atualiza e o que guia retries e limpeza.

**Options:**

### Option A: Enum único linear
- Um campo `status`: `draft` → `uploading` → `processing` → `ready` | `failed` (e depois a Fase 04 acrescenta `published`).
- **Pros:** uma coluna, fácil de ler e filtrar.
- **Cons:** mistura dois eixos independentes: um vídeo `ready` ainda é rascunho, e um vídeo publicado pode precisar de reprocessamento (thumbnail). A Fase 04 teria de inserir `published` no meio do fluxo ou criar combinações (`ready_published`…).

### Option B: Dois eixos ortogonais — `processingStatus` (Fase 03) e `publicationStatus` (nasce `draft`, transições na Fase 04)
- `publicationStatus = draft` desde a criação (cumpre "pré-cadastro como rascunho"). `processingStatus`: `awaiting_upload` → `processing` → `ready` | `failed`, com `processingError` (código/mensagem curta) e `processedAt`. A Fase 04 só adiciona a transição `draft → published`, exigindo `processingStatus = ready`.
- **Pros:** cada eixo tem dono e transições simples; a Fase 04 não reabre este modelo; o frontend mapeia cada eixo direto em UI (badge de processamento vs badge de publicação).
- **Cons:** duas colunas e uma regra cruzada (só publica se pronto) para testar.

### Option C: Máquina de estados com tabela de eventos (event log)
- Status atual na linha mais tabela `video_status_events` com cada transição, motivo e tentativa.
- **Pros:** auditoria completa e depuração de falhas.
- **Cons:** sobrecarga de modelagem para o MVP; os logs do worker + `processingError` + o histórico de jobs do BullMQ já cobrem a depuração.

**Recommendation:** **Option B (dois eixos)** — separa "o arquivo está pronto?" de "o dono publicou?", que são decisões de fases diferentes, e evita migração de enum na Fase 04. Política de falha: `failed` é terminal para o pipeline automático (ver TD-08 para retries), guarda o motivo e o vídeo continua editável/excluível. **Uploads abandonados na Fase 03:** a limpeza se limita às partes órfãs de multipart incompleto, feita pelo próprio storage. Em S3 isso é uma regra de lifecycle do bucket `AbortIncompleteMultipartUpload` (ex.: `DaysAfterInitiation: 1`). **No MinIO essa regra não é aceita:** testado em 2026-10-24 com `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, `mc ilm import` rejeita `AbortIncompleteMultipartUpload` ("XML … did not validate against our published schema"), enquanto uma regra `Expiration` de controle, no mesmo formato, é aceita. O equivalente no MinIO é a config de servidor `stale_uploads_expiry` (default `24h`, varredura a cada `6h`, ajustável via `MINIO_API_STALE_UPLOADS_EXPIRY`), que já vem ativa sem configuração. Um job de limpeza de vídeos presos em `awaiting_upload` (linhas no banco) **fica fora do escopo da Fase 03**. Valores de enum são parte do contrato OpenAPI consumido pelo frontend (codegen `next-frontend-openapi-typing/TD-01`).

**Decision:** _[pending]_

---

## TD-07: Gatilho do Processamento após o Upload

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Quando o último byte chega ao MinIO, alguém precisa (1) completar o multipart, (2) mudar o vídeo para `processing` e (3) enfileirar o job. Isso define quem confia em quê: cliente, storage ou API. Depende de TD-01 (fila) e TD-02 (multipart).

**Options:**

### Option A: API completa o multipart e enfileira (endpoint `complete` chamado pelo cliente)
- O cliente avisa `POST /videos/:id/upload/complete`. A API lista as partes (`ListParts`), chama `CompleteMultipartUpload`, valida tamanho/tipo com `HeadObject`, muda o status para `processing` e publica o job com `jobId = videoId`.
- **Pros:** a API é o único ator que completa (o cliente não pode declarar "terminei" sem os bytes estarem lá); validação pós-upload num ponto só; sem configuração extra no MinIO; fácil de testar com o MinIO real.
- **Cons:** se o cliente sumir após a última parte e antes do `complete`, o vídeo fica em `awaiting_upload` (resolvido pela limpeza de 24h ou por um `complete` idempotente na retomada); DB e fila não são atômicos (BullMQ) → `jobId` idempotente + reconciliação periódica de vídeos `processing` sem job.

### Option B: Notificação de bucket do MinIO (`s3:ObjectCreated:CompleteMultipartUpload`) → webhook/Redis
- O MinIO publica o evento num webhook da API ou numa lista Redis, e um consumidor enfileira o processamento.
- **Pros:** dispara mesmo se o cliente não chamar nada; padrão event-driven.
- **Cons:** o cliente (ou alguém) ainda precisa chamar `CompleteMultipartUpload`, que exigiria credenciais no navegador ou uma URL assinada de complete, abrindo a porta para completar com partes arbitrárias; configuração de notificação via `mc`/env acoplada ao MinIO e diferente no S3 real (S3 → SQS/EventBridge); dois caminhos de config para dev e prod; mais difícil de testar.

### Option C: Polling do worker/cron por uploads concluídos
- Um job periódico verifica vídeos `awaiting_upload` com objeto existente e enfileira.
- **Pros:** sem dependência do cliente.
- **Cons:** latência igual ao intervalo de polling; carga constante de `HeadObject`; não resolve quem completa o multipart.

**Recommendation:** **Option A (API completa e enfileira)** — mantém credenciais e validação no servidor, é portátil entre MinIO e S3 sem configurar eventos de storage, e o BullMQ dedup por `jobId = videoId` deixa o `complete` idempotente (retomada ou duplo clique não geram dois jobs). A janela "status mudou mas job não entrou" (falta de transação DB+Redis) fecha com: enfileirar *depois* do commit e um reconciliador leve (no boot do worker ou periódico) que re-enfileira vídeos `processing` sem job ativo. Se a escolha em TD-01 for pg-boss, o enqueue vai na mesma transação e o reconciliador deixa de ser necessário.

**Decision:** _[pending]_

---

## TD-08: Retries e Tratamento de Falha no Processamento

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Falhas no worker são de dois tipos: transitórias (MinIO/DB indisponível, worker morto no meio, timeout) e permanentes (arquivo corrompido, não é vídeo, sem stream de vídeo). Repetir falha permanente desperdiça CPU, e não repetir a transitória deixa vídeo bom em `failed`. Define também o que o usuário vê e o que fica no storage. Depende de TD-01 e TD-06.

**Options:**

### Option A: Retries uniformes, sem distinguir tipo de falha
- `attempts: N` com backoff exponencial para qualquer erro, e `failed` só após esgotar.
- **Pros:** configuração mínima.
- **Cons:** arquivo corrompido roda o FFmpeg N vezes antes de falhar; feedback ao usuário atrasado.

### Option B: Classificação transitória vs permanente
- Erros de validação de mídia (ffprobe sem stream de vídeo, exit code de arquivo inválido, duração 0) lançam `UnrecoverableError` → `failed` imediato com motivo. Demais erros usam `attempts: 3` + backoff exponencial (ex.: 30s base). No evento final `failed`, o worker grava `processingStatus = failed` + `processingError`. Processamento idempotente: rodar de novo sobrescreve a mesma chave de thumbnail e os mesmos campos.
- **Pros:** falha rápida para o que nunca vai funcionar e resiliência para o resto; usa recurso nativo do BullMQ; o motivo chega ao usuário.
- **Cons:** precisa mapear erros do ffprobe/ffmpeg para as duas classes (com testes por fixture inválida).

### Option C: Option B + reprocessamento manual pelo dono
- Além de B, um endpoint `POST /videos/:id/reprocess` re-enfileira um vídeo `failed`.
- **Pros:** recupera falhas transitórias que esgotaram retries sem reenviar 10GB.
- **Cons:** endpoint e autorização extras; escopo de UI pertence mais à Fase 04 (painel).

**Recommendation:** **Option B (transitória vs permanente)** — é o mínimo que dá feedback correto e rápido usando `UnrecoverableError` + `attempts/backoff` do BullMQ, sem custo de produto extra. O arquivo original **não é apagado** em falha (permite diagnóstico e reprocessamento futuro). O reprocessamento manual (C) fica como candidato a tarefa da Fase 04, junto do painel.

**Decision:** _[pending]_

---

## TD-09: Estratégia de URL Única e Curta por Vídeo

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de um identificador público, único e curto para a URL (`/watch/{id}` ou `/v/{id}` no frontend), separado do id interno. O formato vira contrato: coluna + índice único no banco, validação de parâmetro na API, rota dinâmica e links no Next. Unlisted (Fase 04) exige que o id **não seja enumerável**.

**Options:**

### Option A: UUID (o próprio id interno) na URL
- A URL usa o `uuid` primário.
- **Pros:** zero código e unicidade garantida.
- **Cons:** 36 caracteres (não é "curta"); expõe o id interno usado em FKs.

### Option B: Id público aleatório base62/base64url de tamanho fixo (estilo YouTube, ~11 caracteres)
- Gerado com `crypto.randomBytes` (ou `nanoid` com alfabeto URL-safe), coluna `public_id` com `UNIQUE`; em violação de unicidade, gera de novo (retry curto).
- **Pros:** curto, URL-safe, não enumerável (64^11 ≈ 7×10^19 combinações, colisão desprezível); desacoplado do id interno; unlisted fica seguro por obscuridade, como no YouTube.
- **Cons:** coluna + índice extras; tratamento de retry de colisão (trivial e testável).

### Option C: Codificação reversível de id sequencial (Sqids/Hashids)
- Codifica um `bigserial` em string curta com alfabeto embaralhado.
- **Pros:** curto, sem coluna extra, decodificável.
- **Cons:** é ofuscação, não segredo: sequencial e decodificável com a lib, então quebra o unlisted (dá para enumerar); exige id sequencial além do UUID atual.

**Recommendation:** **Option B (id público aleatório de 11 caracteres base64url com `UNIQUE` + retry)** — é a única curta *e* não enumerável, requisito implícito do unlisted da Fase 04. Gerado no pré-cadastro (TD-06), então a URL existe desde o início do upload. Preferir `crypto.randomBytes` nativo em vez de `nanoid`: o `nanoid` atual é ESM-only, e o backend é CommonJS (ts-jest), o que evita atrito de módulo.

**Decision:** _[pending]_

---

## TD-10: Streaming (Range / 206 Partial Content) e Download

**Scope:** Cross-layer

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** O `<video>` do navegador faz requisições `Range` e espera `206 Partial Content` para buscar trechos e permitir seek sem baixar tudo. O download precisa de `Content-Disposition: attachment` com nome amigável. Quem serve os bytes define a carga na API e o formato de URL que o frontend recebe. O diagrama prevê `frontend → storage: Streams`. Depende de TD-03 (bucket privado) e TD-05 (endpoint público).

**Options:**

### Option A: URL pré-assinada de GET direto ao storage (curta duração)
- A API (via BFF) devolve `streamUrl` (GET assinado, ex.: 1–4h) e `downloadUrl` (GET assinado com `ResponseContentDisposition=attachment; filename="..."`). O MinIO/S3 trata `Range` e responde `206` nativamente.
- **Pros:** zero bytes pela API/BFF; Range/206, `Accept-Ranges` e `Content-Length` corretos sem código próprio; mesma estratégia em produção (S3 + CDN com URL assinada); autorização continua na API, que só assina se o usuário pode ver o vídeo (rascunho só para o dono, Fase 04).
- **Cons:** a URL expira (sessões muito longas precisam renovar a URL); URLs que mudam reduzem cache de CDN (contornável com expiração alinhada ou CDN signed cookies no futuro).

### Option B: Proxy de streaming na API (`GetObject` com `Range` repassado → `StreamableFile` 206)
- A API lê o `Range`, chama `GetObject` com o mesmo range e faz pipe da resposta com status 206.
- **Pros:** URL estável e controle total (contagem de views, autorização por requisição).
- **Cons:** todo o tráfego de vídeo passa pela API (e pelo BFF), o que contradiz o "sem impacto na performance"; reimplementa semântica de Range (múltiplos ranges, `If-Range`, 416) que o storage já faz; escala a API pelo tráfego de mídia.

### Option C: Bucket/prefixo público com URL estável
- Objetos legíveis anonimamente, com URL fixa por chave.
- **Pros:** cache perfeito e nenhuma assinatura.
- **Cons:** rascunho e unlisted vazam para quem tiver a URL, sem revogação; contradiz TD-03.

**Recommendation:** **Option A (GET pré-assinado direto ao storage para stream e download)** — entrega Range/206 nativo sem código e sem tráfego de mídia na API, mantém a autorização na API e é idêntico em produção. Streaming adaptativo (HLS/DASH) **não** é requisito da fase (o plano pede só reprodução sem download completo e extração de metadados), então fica como evolução futura. Os campos `streamUrl`/`downloadUrl` só são emitidos com `processingStatus = ready`. **Regra de autorização da Fase 03:** todo vídeo ainda é rascunho, então `streamUrl` e `downloadUrl` só são emitidos para o **dono do canal autenticado**. Qualquer outro solicitante (anônimo ou outro usuário) não recebe as URLs. Acesso anônimo, público e unlisted fica para as Fases 04/05, quando existirem publicação e visibilidade.

**Decision:** _[pending]_

---

## TD-11: Execução do Worker (Processo/Container) e Invocação do FFmpeg

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo; Serviço de processamento em segundo plano (filas)

**Context:** O diagrama separa "Video Worker (FFmpeg)" da API. Duas escolhas acopladas: (1) onde o código do worker vive e como roda; (2) como chamar ffprobe/ffmpeg. FFmpeg é CPU-bound e não pode competir com a API por CPU nem derrubá-la. O binário precisa existir na imagem que roda o worker **e** nos testes de integração (TD-12).

**Options:**

### Option A: Mesmo código-base NestJS, entrypoint separado (`worker.main.ts` com `NestFactory.createApplicationContext`) em serviço Compose próprio; FFmpeg via `child_process.spawn` dos binários do sistema
- `nestjs-project` ganha um segundo entrypoint que carrega só o `VideoProcessingModule` (com `@Processor`), sem HTTP. Novo serviço `video-worker` no compose, com imagem baseada no `Dockerfile.dev` + `apt install ffmpeg`. Metadados: `ffprobe -v error -print_format json -show_format -show_streams <url>`. Thumbnail: `ffmpeg -ss <~10% da duração, mín. 1s> -i <url> -frames:v 1 -vf scale=1280:-2 thumb.jpg`, lendo o original **direto do MinIO por URL pré-assinada interna** (o ffmpeg faz range requests e não baixa os 10GB).
- **Pros:** reaproveita entidades, config Joi, TypeORM e testing guide; isolamento de CPU/crash por container; escala o worker de forma independente; `spawn` com args em array evita injeção de shell e não depende de wrapper; ffprobe JSON é parseado com tipos próprios.
- **Cons:** precisa de um wrapper fino próprio (spawn + timeout + captura de stderr + mapeamento de exit codes para TD-08); FFmpeg do apt (Debian) tem versão ditada pela distro.

### Option B: Mesmo processo da API (processor registrado no `AppModule`)
- O `@Processor` roda dentro do container da API.
- **Pros:** zero serviço novo.
- **Cons:** FFmpeg disputa CPU com as requisições HTTP e um crash afeta a API, contrariando o diagrama e o "sem impacto na performance".

### Option C: Projeto separado (`video-worker/` próprio) e/ou wrapper `fluent-ffmpeg`
- Worker como subprojeto isolado no monorepo; FFmpeg via `fluent-ffmpeg`, ou binários empacotados via `ffmpeg-static`/`ffprobe-static`.
- **Pros:** fronteira de deploy explícita; API fluente para montar comandos.
- **Cons:** duplica entidades/config/migrations, ou exige pacote compartilhado (decisão de monorepo ainda não tomada); **`fluent-ffmpeg` está deprecated no npm** ("Package no longer supported"); binários estáticos via npm inflam `node_modules` e divergem do FFmpeg da imagem.

**Recommendation:** **Option A (mesmo código-base, entrypoint e container separados; `spawn` de ffprobe/ffmpeg do sistema)** — cumpre a separação do diagrama sem duplicar o domínio, evita uma dependência abandonada e mantém o FFmpeg na imagem (mesmo binário em dev, testes e produção). Ler o original por URL interna evita copiar 10GB para o disco do worker. Frame da thumbnail em ~10% da duração (mínimo 1s, limitado à duração) evita telas pretas de abertura. **Imagem decidida:** o FFmpeg (`ffmpeg` + `ffprobe`) é instalado no `nestjs-project/Dockerfile.dev`, **compartilhado pelos serviços `nestjs-api` e `video-worker`**. Os dois serviços usam a mesma imagem e diferem só no comando/entrypoint, o que permite rodar os testes de integração do processor dentro do container `nestjs-api` (ver TD-12).

**Decision:** _[pending]_

---

## TD-12: Estratégia de Testes para Storage, Fila e FFmpeg (Reavaliação do Testing Guide)

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** `testing-guide-nestjs-project/references/external-systems.md` manda usar **filesystem local** para storage em dev/testes ("S3 em produção") com uma abstração de driver. Essa regra foi escrita antes do storage ser fixado como S3-compatível com MinIO local. Com upload multipart pré-assinado (TD-02), endpoint público para assinatura (TD-05) e Range/206 no storage (TD-10), um adapter de filesystem **não exercita nada disso**: não existe multipart, presign ou CORS em disco. A política atual do projeto já usa serviços reais via Compose para Postgres e e-mail (Mailpit), e a fila já está como "Real (Docker)".

**Options:**

### Option A: Manter o adapter de filesystem nos testes (guia atual)
- `StorageService` com driver `local` em testes e `s3` em produção.
- **Pros:** testes sem dependência de serviço; nenhuma mudança no guia.
- **Cons:** multipart, presign, `ListParts`, host público da assinatura, CORS e Range nunca são testados antes de produção; exige manter dois drivers e uma abstração só para teste; o driver S3 (o que vai para produção) fica sem cobertura de integração.

### Option B: Serviços reais via Compose (MinIO, Redis, FFmpeg na imagem) com isolamento por teste
- Integração e e2e rodam contra `minio`, `redis` e o `ffmpeg` instalado, como já se faz com `db` e `mailpit`. Isolamento: bucket por suíte (ou prefixo único por teste) criado/limpo no setup; BullMQ com `prefix` único por suíte e `queue.obliterate({ force: true })` no teardown; fixtures de vídeo minúsculas (poucos KB, ex.: 2s geradas uma vez com `ffmpeg -f lavfi -i testsrc`) commitadas, mais uma fixture inválida para o caminho `UnrecoverableError`. Testes unitários continuam mockando os clients (S3/Queue/spawn) para regras de status e mapeamento de erros. O 10GB **não** é testado com arquivo real: testa-se o contrato multipart com 2–3 partes de 5MiB (mínimo S3) e a validação de limite por metadado.
- **Pros:** cobre exatamente o que vai para produção (API S3, presign, multipart, Range, BullMQ, ffprobe/ffmpeg reais); coerente com a política já adotada (Postgres e Mailpit reais); remove a necessidade de um driver de filesystem.
- **Cons:** suíte de integração depende de mais serviços em pé (`docker compose up`); testes de FFmpeg ficam mais lentos (mitigado por fixtures de segundos); exige atualizar o testing guide.

### Option C: Testcontainers (MinIO/Redis efêmeros por suíte)
- Cada suíte sobe seus containers via `testcontainers`.
- **Pros:** isolamento total e nenhum serviço pré-existente necessário.
- **Cons:** os testes rodam **dentro** do container `nestjs-api`, então Testcontainers precisaria de acesso ao socket Docker do host (Docker-in-Docker/socket mount), o que é frágil no Windows; diverge do padrão Compose já usado para Postgres/Mailpit; mais lento.

**Recommendation:** **Option B (serviços reais via Compose com isolamento por bucket/prefixo de fila)** — o filesystem local deixou de testar o que importa assim que o upload virou multipart pré-assinado direto ao storage, e o projeto já segue "serviço real via Compose" para Postgres e e-mail. **FFmpeg nos testes:** como o FFmpeg fica no `Dockerfile.dev` compartilhado por `nestjs-api` e `video-worker` (TD-11), os testes de integração do processor (ffprobe/ffmpeg reais sobre as fixtures) rodam dentro do container `nestjs-api`, como o resto da suíte. **Entregável desta fase:** atualizar `testing-guide-nestjs-project` faz parte da Fase 03: a seção "Object Storage — Local Filesystem" vira "Object Storage — MinIO real (Docker)", a seção de fila passa a usar Redis com host `redis`, e entra uma seção nova para FFmpeg/fixtures. Fica como **tarefa separada** só a correção dos defaults `localhost` antigos nos exemplos já existentes do guia (Postgres, Mailpit), que conflitam com a regra Docker do CLAUDE.md.

**Decision:** _[pending]_

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Tecnologia de fila | A — BullMQ + Redis (`@nestjs/bullmq`) | _[pending]_ |
| TD-02 | Cross-layer | Upload de até 10GB direto ao storage | A — S3 multipart pré-assinado por parte, partes de 64MiB (Uppy só no cliente futuro, não instalado na Fase 03) | _[pending]_ |
| TD-03 | Backend | Buckets, chaves e política de acesso | A — um bucket privado, `videos/{videoId}/original` e `/thumbnail.jpg` | _[pending]_ |
| TD-04 | Repo-wide | Origem da imagem MinIO | A — `pgsty/minio` com tag `RELEASE.*` fixada (fallback Chainguard) | _[pending]_ |
| TD-05 | Cross-layer | Endpoint interno vs público para assinar URLs | A — `S3_ENDPOINT` interno + `S3_PUBLIC_ENDPOINT` só para presign | _[pending]_ |
| TD-06 | Cross-layer | Pré-cadastro e ciclo de status | B — eixos ortogonais `processingStatus` + `publicationStatus=draft` | _[pending]_ |
| TD-07 | Backend | Gatilho do processamento | A — API completa o multipart e enfileira (`jobId = videoId`) + reconciliador | _[pending]_ |
| TD-08 | Backend | Retries e falha no processamento | B — transitória (3× backoff) vs permanente (`UnrecoverableError`) | _[pending]_ |
| TD-09 | Cross-layer | URL única e curta | B — id público aleatório de 11 caracteres base64url, `UNIQUE` + retry | _[pending]_ |
| TD-10 | Cross-layer | Streaming (Range/206) e download | A — GET pré-assinado direto ao storage (stream + attachment) | _[pending]_ |
| TD-11 | Backend | Execução do worker e invocação do FFmpeg | A — mesmo código-base, entrypoint/container separado, `spawn` ffprobe/ffmpeg; FFmpeg no `Dockerfile.dev` compartilhado (`nestjs-api` + `video-worker`) | _[pending]_ |
| TD-12 | Backend | Testes de storage, fila e FFmpeg | B — MinIO/Redis/FFmpeg reais via Compose, isolamento por bucket/prefixo | _[pending]_ |

**Dependências entre TDs:** TD-07 e TD-08 dependem de TD-01; TD-02 depende de TD-05; TD-07 depende de TD-02; TD-10 depende de TD-03 e TD-05; TD-12 depende de TD-01, TD-04 e TD-11.

**Fontes principais:** docs BullMQ (retries, `UnrecoverableError`) e `@nestjs/bullmq` via context7; `@aws-sdk/client-s3` / `s3-request-presigner` v3 via context7; pg-boss (opções de job) via context7; docs Uppy `@uppy/aws-s3`; MinIO bucket notifications (docs.min.io); status da imagem MinIO: [StableBuild](https://www.stablebuild.com/blog/minio-images-disappeared-from-docker-hub), [SILO/pgsty](https://silo.pgsty.com/blog/post/minio-resurrect/), Docker Hub/quay verificados via `docker manifest inspect` em 2026-10-24; deprecação do `fluent-ffmpeg` via `npm view`.
