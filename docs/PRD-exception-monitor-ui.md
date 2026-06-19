---
title: "Exception Monitor UI — Product Requirements Document"
status: accepted
created: 2026-06-19
approved: 2026-06-19
author: ""
ai-assisted: true
human-reviewed: true
---

# PRD: Exception Monitor UI

## Objective

Estendere **cloudwatch-log-downloader** con un mini **frontend web** e un **servizio HTTP JSON** per monitorare eccezioni estratte dai log CloudWatch, con **contesto** (righe sopra/sotto) senza grep manuale.

## Problem Statement

Oggi le eccezioni sono in file `-exceptions_*.log` e il contesto nel file principale accoppiato (`{filePrefix}_*.log`). Serve aprire entrambi manualmente. Non c'è vista unificata né navigazione rapida.

## User Stories

```
AS A developer/ops che monitora un'applicazione
I WANT TO vedere un albero delle eccezioni rilevate nei file locali
SO THAT individuo rapidamente quali errori richiedono attenzione
```

```
AS A developer/ops che investiga un incidente
I WANT TO cliccare su un'eccezione e vedere la riga di errore con 10 righe sopra e sotto
SO THAT capisco il contesto operativo senza grep manuale
```

```
AS A servizio di monitoraggio (futuro)
I WANT TO consumare un endpoint JSON con eccezione + contesto
SO THAT posso integrare alerting o analisi LLM (Q5)
```

## Acceptance Criteria

- [ ] **AC1** — Server HTTP avviato nello stesso processo del downloader (configurabile on/off)
- [ ] **AC2** — `GET /api/exceptions/tree` restituisce albero file → eccezioni
- [ ] **AC3** — `GET /api/exceptions/:id` restituisce eccezione + 10 righe before/after dal file principale accoppiato
- [ ] **AC4** — Frontend: pannello sinistro ad albero, pannello destro con contesto formattato
- [ ] **AC5** — Click su foglia albero → caricamento dettaglio a destra
- [ ] **AC6** — Funziona con file reali prod (`*-exceptions_*` + coppia principale conservata)
- [ ] **AC7** — Aggiornamento periodico albero (polling) quando arrivano nuove eccezioni
- [ ] **AC8** — Nessuna autenticazione richiesta in v1 (tool locale)

## Out of Scope (v1)

- Autenticazione / multi-utente
- Notifiche push, email, Slack
- Analisi LLM automatica (Q5 — fase successiva)
- Ricomposizione stack trace multilinea (Q7)
- Deploy Docker separato dal downloader
- Framework frontend React/Vue (build step)
- Modifiche alle applicazioni monitorate o a CloudWatch

## Technical Constraints

- **Stack esistente:** Node.js 16+, stesso package `cloudwatch-log-downloader`
- **Frontend:** HTML/CSS/JS vanilla servito staticamente (no bundler)
- **API:** REST JSON, prefisso `/api/v1`
- **Sorgente dati:** `./logs/*-exceptions_*.log` + file principale accoppiato per timestamp
- **Config:** sezione `monitor` in `config.*.json` / `config.sample.json`
- **SDLC:** spec → `/plan` → `/build` → `/test`

## Open Questions

Risolte — vedi tabella Q1–Q8 in [spec-exception-monitor-ui.md](./spec-exception-monitor-ui.md) (approvate 2026-06-19).

## Documenti correlati

- [spec-exception-monitor-ui.md](./spec-exception-monitor-ui.md) — spec tecnica completa
- [API-contract-exception-monitor.md](./API-contract-exception-monitor.md) — contratto REST
- [ADR-003-exception-monitor-web-ui.md](./ADR-003-exception-monitor-web-ui.md) — decisione architetturale

## ADR References

- [ADR-001-two-component-log-pipeline.md](./ADR-001-two-component-log-pipeline.md)
- [ADR-003-exception-monitor-web-ui.md](./ADR-003-exception-monitor-web-ui.md)
