---
title: "Implementation Plan — Exception Monitor UI"
status: accepted
created: 2026-06-19
approved: 2026-06-19
implemented: 2026-06-19
author: ""
ai-assisted: true
human-reviewed: false
spec: docs/spec-exception-monitor-ui.md
---

# Implementation Plan: Exception Monitor UI + API JSON

## Overview

Estendere `cloudwatch-log-downloader` con un server HTTP locale (`127.0.0.1:3847`) che espone API JSON per eccezioni + contesto ±10 righe, e un frontend vanilla a 2 pannelli (albero sx, dettaglio dx). Tutto nello stesso processo Node del downloader, disabilitabile via `monitor.enabled`.

**Riferimenti:** [spec-exception-monitor-ui.md](./spec-exception-monitor-ui.md) · [API-contract-exception-monitor.md](./API-contract-exception-monitor.md) · [ADR-003](./ADR-003-exception-monitor-web-ui.md)

---

## Architecture Decisions (confermate in spec)

| Decisione | Rationale |
|-----------|-----------|
| HTTP nativo Node (`http`) | Zero nuove dipendenze npm (ADR-003) |
| Funzioni pure in modulo dedicato | Testabilità; riuso logica naming da `FileManager` |
| Lettura file intera in memoria v1 | File main ~2–3k righe accettabile; streaming in v2 se serve |
| `node:test` built-in | Node 18+; nessun jest da aggiungere |
| Riutilizzo `parseLogFileTimestamp` | Estrarre in `src/monitor/exception-file-utils.js` condiviso o delegare a `FileManager` |

---

## Dependency Graph

```
config.monitor + validateConfig
        │
        ▼
exception-file-utils.js  ◄── fixture tests
        │
        ├── exception-context.js  (contesto ±N)
        │
        └── exception-index.js    (scan tree)
                │
                ▼
        monitor-server.js  (routing API + static)
                │
                ▼
        index.js integration
                │
        ┌───────┴───────┐
        ▼               ▼
   curl/API tests   public/ UI
```

**Ordine:** foundation → backend API (vertical slice testabile via curl) → integrazione index → frontend → polish/docs.

---

## Parallelization

| Può procedere in parallelo | Deve essere sequenziale |
|----------------------------|-------------------------|
| Fixture log (Task 2) mentre si scrive utils (Task 3) | API server prima di frontend |
| CSS layout (Task 10) dopo contratto API congelato | index.js integration dopo monitor-server |
| QUICK_START docs (Task 14) a fine implementazione | Test integrazione API dopo server |

---

## Task List

### Phase 1: Foundation

---

## Task 1: Config `monitor` + validazione

**Description:** Aggiungere sezione `monitor` a `config.sample.json` con default approvati. Estendere `validateConfig()` in `index.js` per normalizzare default (`enabled`, `port`, `contextLines*`, ecc.).

**Acceptance criteria:**
- [ ] `config.sample.json` contiene blocco `monitor` completo
- [ ] Default applicati se campi omessi: `enabled: true`, `host: 127.0.0.1`, `port: 3847`, `contextLinesBefore/After: 10`, `treeRefreshSeconds: 30`, `maxExceptionFiles: 50`
- [ ] Config senza sezione `monitor` → monitor disabilitato o default safe (decidere: **default enabled con valori sopra**)

**Verification:**
- [ ] Avvio con config sample non crasha
- [ ] Log init mostra `monitorEnabled: true/false`

**Dependencies:** None

**Files likely touched:**
- `cloudwatch-log-downloader/config.sample.json`
- `cloudwatch-log-downloader/src/index.js`

**Estimated scope:** S (1–2 file)

---

## Task 2: Fixture log per test

**Description:** Creare file di test minimali in `tests/fixtures/logs/` per unit e integration test.

**Acceptance criteria:**
- [ ] `my-app-logs-prod-exceptions_fixture.log` — 2 righe eccezione
- [ ] `my-app-logs-prod_fixture.log` — ≥20 righe; eccezioni identiche a linee 5 e 15
- [ ] Una riga duplicata opzionale per test Q7 (prima occorrenza)

**Verification:**
- [ ] Fixture leggibili manualmente; path documentati in test

**Dependencies:** None

**Files likely touched:**
- `cloudwatch-log-downloader/tests/fixtures/logs/*`

**Estimated scope:** XS

---

## Task 3: `exception-file-utils.js` + unit test

**Description:** Modulo pure functions: parse filename timestamp, `getPairedMainFilename`, parse exception `id`, parse log line metadata (`timestamp`, `source`, `preview` 120 char), `findLineInMain(lines, excLine)` (prima occorrenza trim).

**Acceptance criteria:**
- [ ] `getPairedMainFilename('my-app-logs-prod-exceptions_2026-06-19_11-49.log', prefix)` → `my-app-logs-prod_2026-06-19_11-49.log`
- [ ] `parseExceptionId('2026-06-19_11-49:2')` → `{ fileId, indexInFile: 2 }`
- [ ] `buildPreview(line, 120)` tronca correttamente
- [ ] `findLineInMain` restituisce indice 0-based prima match

**Verification:**
- [ ] `npm test` esegue `node --test tests/exception-file-utils.test.js` — tutti pass

**Dependencies:** Task 2

**Files likely touched:**
- `cloudwatch-log-downloader/src/monitor/exception-file-utils.js`
- `cloudwatch-log-downloader/tests/exception-file-utils.test.js`
- `cloudwatch-log-downloader/package.json` (script `test`)

**Estimated scope:** S

---

### Checkpoint: Foundation

- [ ] `npm test` passa su utils
- [ ] Config sample aggiornato
- [ ] Nessuna regressione avvio downloader (`monitor` non ancora avviato OK)

---

### Phase 2: Backend API (vertical slice — curl)

---

## Task 4: `exception-context.js` + unit test

**Description:** Implementare risoluzione contesto: legge file eccezione + main accoppiato, estrae before/after con `contextLinesBefore/After` da config. Gestisce `warning`: `main_file_missing`, `main_line_not_found`.

**Acceptance criteria:**
- [ ] Riga 2 fixture → contesto con linee 5±10 nel main (indice corretto)
- [ ] Main assente → `{ warning: 'main_file_missing', context: { before: [], after: [] } }`
- [ ] Riga non trovata → `warning: 'main_line_not_found'`
- [ ] Output conforme a schema API contract

**Verification:**
- [ ] `node --test tests/exception-context.test.js` pass

**Dependencies:** Task 3

**Files likely touched:**
- `cloudwatch-log-downloader/src/monitor/exception-context.js`
- `cloudwatch-log-downloader/tests/exception-context.test.js`

**Estimated scope:** S

---

## Task 5: `exception-index.js` + unit test

**Description:** Scan `logDirectory` per `{filePrefix}-exceptions_*.log`, ordina per timestamp desc (più recenti prima), limit `maxExceptionFiles`. Per ogni file: elenco eccezioni con id, preview, `lineNumberInMain` (lookup opzionale lazy o eager — **eager in v1** per tree).

**Acceptance criteria:**
- [ ] Tree JSON conforme a `GET /exceptions/tree` contract
- [ ] File vuoti / righe blank ignorate
- [ ] `exceptionCount` corretto
- [ ] Ordine file: più recente prima

**Verification:**
- [ ] `node --test tests/exception-index.test.js` pass con fixture

**Dependencies:** Task 3, Task 4 (per lineNumberInMain)

**Files likely touched:**
- `cloudwatch-log-downloader/src/monitor/exception-index.js`
- `cloudwatch-log-downloader/tests/exception-index.test.js`

**Estimated scope:** M (3 file)

---

## Task 6: `monitor-server.js` — HTTP routing

**Description:** Server `http` su `monitor.host:monitor.port`. Routes:
- `GET /api/v1/health`
- `GET /api/v1/exceptions/tree?limit=`
- `GET /api/v1/exceptions/:id`
- `GET /` → `public/index.html`
- `GET /css/*`, `GET /js/*` → static da `public/`
- JSON errors `{ error, code }` per 400/404/500
- Content-Type corretto; CORS non necessario (same origin)

**Acceptance criteria:**
- [ ] Tutti endpoint rispondono conforme API contract
- [ ] Path traversal bloccato su static (`..` rejected)
- [ ] `503` se monitor disabled (edge case test server standalone)

**Verification:**
- [ ] Server avviabile in isolation: script test o `node --test tests/monitor-server.test.js` con porta random
- [ ] curl manuale su fixture directory (mock config)

**Dependencies:** Task 4, Task 5

**Files likely touched:**
- `cloudwatch-log-downloader/src/monitor/monitor-server.js`
- `cloudwatch-log-downloader/tests/monitor-server.test.js` (opzionale integration)

**Estimated scope:** M (2–3 file)

---

### Checkpoint: Backend API

- [ ] `curl http://127.0.0.1:3847/api/v1/health` → 200 (con server standalone o integrato)
- [ ] `curl .../exceptions/tree` → JSON con fixture o log reali
- [ ] `curl .../exceptions/{id}` → contesto ±10 righe su file prod reali
- [ ] AC1, AC2, AC3, AC4, AC8 verificati via curl

---

### Phase 3: Integrazione downloader

---

## Task 7: Integrazione in `index.js`

**Description:** Dopo `init()`, se `monitor.enabled`, istanziare `MonitorServer` e `start()`. Log info con URL. Shutdown graceful su SIGINT/SIGTERM (chiudere server HTTP).

**Acceptance criteria:**
- [ ] `npm run start:prod` avvia downloader + monitor
- [ ] `monitor.enabled: false` → nessuna porta HTTP (AC7)
- [ ] Downloader cron invariato

**Verification:**
- [ ] Avvio prod locale; health OK
- [ ] Ctrl+C chiude entrambi senza hang

**Dependencies:** Task 1, Task 6

**Files likely touched:**
- `cloudwatch-log-downloader/src/index.js`

**Estimated scope:** S

---

### Phase 4: Frontend

---

## Task 8: Layout HTML + CSS

**Description:** `public/index.html` grid 35/65, header albero (titolo, badge count, last refresh). `public/css/monitor.css`: monospace log, `.active` foglia, colori ERROR (rosso) / WARN (giallo) nel dettaglio (Q6).

**Acceptance criteria:**
- [ ] Layout responsive minimo; pannello dx scrollabile
- [ ] Placeholder dx visibile a riposo
- [ ] Stile coerente light/dark semplice

**Verification:**
- [ ] Aprire `index.html` via server → layout corretto senza JS

**Dependencies:** Task 6 (server static)

**Files likely touched:**
- `cloudwatch-log-downloader/public/index.html`
- `cloudwatch-log-downloader/public/css/monitor.css`

**Estimated scope:** S

---

## Task 9: `monitor.js` — albero, dettaglio, polling

**Description:** Fetch `/api/v1/exceptions/tree` al load + ogni `treeRefreshSeconds`. Render albero `<details>`/`<ul>`. Click foglia → fetch `/api/v1/exceptions/:id`, render metadata + blocchi before/exception/after con highlight riga eccezione. Mantieni selezione al refresh se id ancora presente.

**Acceptance criteria:**
- [ ] AC5: click → dettaglio < 1s
- [ ] AC6: polling aggiorna count/nodi senza full reload
- [ ] Q5: nessun auto-open all'avvio
- [ ] Warning visualizzato se presente in response

**Verification:**
- [ ] Test manuale browser su log reali `./logs/`
- [ ] Simulare nuovo file eccezione → appare entro 30s

**Dependencies:** Task 7, Task 8

**Files likely touched:**
- `cloudwatch-log-downloader/public/js/monitor.js`

**Estimated scope:** M

---

### Checkpoint: End-to-end UI

- [ ] Browser `http://127.0.0.1:3847` — flusso completo albero → click → contesto
- [ ] AC5, AC6 verificati
- [ ] Review umana UI prima di polish

---

### Phase 5: Polish & Docs

---

## Task 10: Edge cases + hardening

**Description:** File main molto grande (solo test performance manuale). ID malformato → 400. Eccezione id valido ma file rimosso → 404. Log errori server in italiano.

**Acceptance criteria:**
- [ ] Nessun crash su directory logs vuota → tree `{ files: [] }`
- [ ] Messaggi errore JSON strutturati

**Verification:**
- [ ] Test manuali checklist edge case

**Dependencies:** Task 7, Task 9

**Files likely touched:**
- `cloudwatch-log-downloader/src/monitor/*.js`

**Estimated scope:** S

---

## Task 11: Script npm + README/QUICK_START

**Description:** Aggiungere `"test": "node --test tests/"`. Documentare sezione Monitor in `README.md` e `QUICK_START.md`. Aggiornare `docs/NEXT-STEPS.md` (P2 in progress/done).

**Acceptance criteria:**
- [ ] SC3: demo curl + browser documentata
- [ ] Comandi `npm test`, URL monitor, config `monitor.*` spiegati

**Verification:**
- [ ] Developer segue QUICK_START senza aiuto

**Dependencies:** Task 7, Task 9

**Files likely touched:**
- `cloudwatch-log-downloader/package.json`
- `cloudwatch-log-downloader/README.md`
- `cloudwatch-log-downloader/QUICK_START.md`
- `docs/NEXT-STEPS.md`

**Estimated scope:** S

---

### Checkpoint: Complete

- [ ] Tutti AC1–AC8 soddisfatti
- [ ] `npm test` verde
- [ ] `/review` pronto
- [ ] Config locali (`config.prod.json`) aggiornate manualmente con blocco `monitor` (non committate)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| File log grandi → memoria | Med | v1: readFileSync accettabile; monitorare; v2 streaming |
| Duplicazione parse filename vs FileManager | Low | Estrarre utils condiviso o metodo pubblico su FileManager |
| Porta 3847 occupata | Low | Log errore chiaro; config `port` |
| Race: file in scrittura durante read | Low | v1 accettabile; retry al prossimo poll |
| Stack trace multilinea spezzato | Med | Documentato out of scope Q7; contesto ±10 righe fisiche |
| Test senza framework esistente | Low | `node:test` + script npm |

---

## Implementation Order Summary

| # | Task | Size | Dipende da |
|---|------|------|------------|
| 1 | Config monitor | S | — |
| 2 | Fixture log | XS | — |
| 3 | exception-file-utils + test | S | 2 |
| 4 | exception-context + test | S | 3 |
| 5 | exception-index + test | M | 3, 4 |
| 6 | monitor-server | M | 4, 5 |
| 7 | index.js integration | S | 1, 6 |
| 8 | HTML + CSS | S | 6 |
| 9 | monitor.js frontend | M | 7, 8 |
| 10 | Edge cases | S | 7, 9 |
| 11 | Docs + npm test | S | 7, 9 |

**Sessioni consigliate `/build`:**
1. Tasks 1–3 (foundation)
2. Tasks 4–6 + checkpoint curl
3. Tasks 7–9 + checkpoint browser
4. Tasks 10–11

---

## Open Questions (implementazione)

| # | Domanda | Proposta |
|---|---------|----------|
| I1 | Estrarre utils da FileManager o duplicare? | **Estrarre** in `exception-file-utils.js`; FileManager può importare in refactor follow-up |
| I2 | `monitor.enabled` default se sezione assente? | **`true`** con default port/host |
| I3 | Esporre `treeRefreshSeconds` al frontend via `/health`? | **Sì** — campo in health response per sync polling |

---

## Verification Checklist (pre-merge)

- [ ] `npm test` — tutti pass
- [ ] `npm run start:prod` + browser E2E
- [ ] `monitor.enabled: false` — solo downloader
- [ ] curl tree + detail su log prod reali
- [ ] Nessuna nuova dipendenza npm
- [ ] `config.sample.json` aggiornato; prod/uat locali aggiornati manualmente

---

## Prossimo passo

**Review umana di questo plan** → poi **`/build`** seguendo l'ordine Tasks 1–11.

**STOP:** non implementare finché il plan non è approvato.
