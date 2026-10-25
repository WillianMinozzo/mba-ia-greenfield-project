---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 13
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-24T23:24:09-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T21:40:19-03:00"
issues:
  - id: AMB-1
    status: open
    summary: "Quais metadados o processamento extrai e persiste além da duração"
  - id: OQ-1
    status: open
    summary: "TD-01 pending — Tecnologia de Fila"
  - id: OQ-2
    status: open
    summary: "TD-02 pending — Estratégia de Upload de até 10GB"
  - id: OQ-3
    status: open
    summary: "TD-03 pending — Organização do Storage (Buckets, Chaves e Acesso)"
  - id: OQ-4
    status: open
    summary: "TD-04 pending — Origem da Imagem MinIO no Docker Compose"
  - id: OQ-5
    status: open
    summary: "TD-05 pending — Endpoint Interno vs Público para Assinar URLs"
  - id: OQ-6
    status: open
    summary: "TD-06 pending — Pré-cadastro do Vídeo e Ciclo de Status"
  - id: OQ-7
    status: open
    summary: "TD-07 pending — Gatilho do Processamento após o Upload"
  - id: OQ-8
    status: open
    summary: "TD-08 pending — Retries e Tratamento de Falha no Processamento"
  - id: OQ-9
    status: open
    summary: "TD-09 pending — Estratégia de URL Única e Curta por Vídeo"
  - id: OQ-10
    status: open
    summary: "TD-10 pending — Streaming (Range / 206) e Download"
  - id: OQ-11
    status: open
    summary: "TD-11 pending — Execução do Worker e Invocação do FFmpeg"
  - id: OQ-12
    status: open
    summary: "TD-12 pending — Estratégia de Testes para Storage, Fila e FFmpeg"
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

- **AMB-1** — A capability "Processamento automático do vídeo após upload (extração de duração e metadados)" nomeia só a duração. "Metadados" não está definido em `## Scope` nem em nenhum TD: `phase-03-videos/TD-11` define *como* extrair (ffprobe JSON), não *quais* campos são persistidos. O conjunto de campos é um contrato: vira colunas da entidade `Video` (migration), campos da resposta da API (OpenAPI, consumido na Fase 04 pelo painel "thumbnail, título, …, status") e asserções dos testes de integração do processor. Explicit choice: definir o conjunto mínimo persistido. Candidatos: `durationSeconds`, `width`, `height`, `videoCodec`, `audioCodec`, `container/formatName`, `bitrate`, `sizeBytes`, `frameRate`. Também decidir se o JSON bruto do ffprobe é guardado (ex.: coluna `jsonb`) ou descartado. Registrar como revisão de `phase-03-videos/TD-11` ou de `phase-03-videos/TD-06` via `/plan-resolve 03`.

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

- **OQ-1** — TD-01 pending — Tecnologia de Fila. Resolution: fill the **Decision:** field of TD-01 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-2** — TD-02 pending — Estratégia de Upload de até 10GB (Contrato de Upload Direto ao Storage). Resolution: fill the **Decision:** field of TD-02 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-3** — TD-03 pending — Organização do Storage (Buckets, Chaves e Política de Acesso). Resolution: fill the **Decision:** field of TD-03 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-4** — TD-04 pending — Origem da Imagem MinIO no Docker Compose. Resolution: fill the **Decision:** field of TD-04 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-5** — TD-05 pending — Endpoint Interno vs Público para Assinar URLs. Resolution: fill the **Decision:** field of TD-05 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-6** — TD-06 pending — Pré-cadastro do Vídeo e Ciclo de Status. Resolution: fill the **Decision:** field of TD-06 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-7** — TD-07 pending — Gatilho do Processamento após o Upload. Resolution: fill the **Decision:** field of TD-07 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-8** — TD-08 pending — Retries e Tratamento de Falha no Processamento. Resolution: fill the **Decision:** field of TD-08 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-9** — TD-09 pending — Estratégia de URL Única e Curta por Vídeo. Resolution: fill the **Decision:** field of TD-09 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-10** — TD-10 pending — Streaming (Range / 206 Partial Content) e Download. Resolution: fill the **Decision:** field of TD-10 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-11** — TD-11 pending — Execução do Worker (Processo/Container) e Invocação do FFmpeg. Resolution: fill the **Decision:** field of TD-11 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03.
- **OQ-12** — TD-12 pending — Estratégia de Testes para Storage, Fila e FFmpeg. Resolution: fill the **Decision:** field of TD-12 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run /plan-validate 03. _Nota:_ `## Testing Requirements` em `context.md` reproduz a linha atual do testing guide ("Service with side-effect dep (email, storage) → … or local adapter"). Se TD-12 for decidido como Option B (MinIO real), essa linha passa a divergir da decisão até o testing guide ser atualizado (entregável desta fase, segundo a recomendação de TD-12).

### UI Coverage Gaps

_None._ _(Phase has no UI scope — `## UI Inventory` absent; check not applicable.)_

## Resolved Issues

_No issues resolved yet._
