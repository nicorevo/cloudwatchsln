---
title: "ADR-003: Exception Monitor UI integrato nel downloader"
status: accepted
date: 2026-06-19
approved: 2026-06-19
deciders: []
---

# ADR-003: Web UI eccezioni nello stesso processo Node del downloader

## Context

Il downloader scrive file eccezione (`*-exceptions_*.log`) e file principali accoppiati. Serve una UI per navigare errori con contesto (±10 righe). L’utente preferisce **tutto nello stesso programma Node** senza servizi aggiuntivi.

## Decision Drivers

- Minimo overhead operativo (un solo `npm run start:prod`)
- Riuso directory `./logs` e naming già implementato (`preserveExceptionPairs`)
- API JSON riutilizzabile per Q5 (LLM) in futuro
- Nessun build frontend complesso

## Considered Options

1. **Processo Node unico** — HTTP server + cron downloader + static UI nello stesso `index.js`
2. **Due processi** — downloader + `exception-api` separato (secondo package.json script)
3. **Frontend-only** — pagina statica che legge file via File System Access API (browser)

## Decision Outcome

**Scelta: Opzione 1 — Processo Node unico**

Perché:

- Richiesta esplicita dell’utente (“includere tutto in questo prog node”)
- File già locali su disco; API server-side è naturale
- Opzione 3 non funziona headless / senza permessi browser su `./logs`
- Opzione 2 aggiunge complessità operativa senza benefici v1

**HTTP stack:** modulo **`http` nativo Node** + routing manuale leggero. Evita nuova dipendenza `express` in v1; se il routing cresce, rivalutare in v2.

**Frontend:** cartella `public/` con HTML/CSS/JS vanilla (no React/Vite).

## Consequences

### Positive

- Un comando avvia download + monitor
- API pronta per integrazioni future
- Zero build step frontend

### Negative

- Processo più affaccendato (cron + HTTP)
- Nessuna auth in v1 — solo uso locale trusted
- Matching eccezione→main per exact string può fallire su edge case multilinea (Q7)

## Pros and Cons of the Options

### Opzione 1 (monolite Node) — scelta

- Pro: semplice da avviare, allineata alla richiesta
- Con: accoppiamento UI ↔ downloader

### Opzione 2 (due processi)

- Pro: separazione concern
- Con: due terminali, sync config duplicata

### Opzione 3 (browser FS API)

- Pro: zero server
- Con: UX pessima, permessi manuali, non automatable

## Follow-up

- Implementare secondo [spec-exception-monitor-ui.md](./spec-exception-monitor-ui.md)
- Valutare WebSocket vs polling dopo v1
- Q5: riusare `GET /exceptions/:id` come input LLM
