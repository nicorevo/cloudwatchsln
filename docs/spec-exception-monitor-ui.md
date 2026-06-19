---
title: "Spec: Exception Monitor UI + API JSON"
status: accepted
created: 2026-06-19
approved: 2026-06-19
author: ""
ai-assisted: true
human-reviewed: true
related: PRD-exception-monitor-ui.md, API-contract-exception-monitor.md, ADR-003-exception-monitor-web-ui.md
---

# Spec: Exception Monitor — UI web + servizio JSON contesto eccezioni

## Assunzioni (validate — approvate 2026-06-19)

1. **Contesto dal file principale** — Le 10 righe sopra/sotto si leggono da `my-app-logs-prod_{timestamp}.log`, non dal file `-exceptions_*`. Il file eccezione contiene solo le righe di errore; la coppia si risolve dal timestamp nel nome file (già usato da `preserveExceptionPairs`).
2. **Matching riga** — Si trova la riga eccezione nel file main con **uguaglianza esatta** del testo riga (dopo trim). Verificato su dati reali: stessa riga a linea 995 nel main e linea 1 nel file eccezioni.
3. **±10 = righe fisiche** — Non eventi log CloudWatch né entry multilinea ricomposte (Q7 resta fuori scope v1).
4. **Tool locale** — Nessuna auth HTTP in v1; bind su `localhost` only.
5. **Stesso processo** — HTTP server avviato da `index.js` dopo init downloader; disabilitabile via config.
6. **Frontend vanilla** — HTML/CSS/JS in `public/`, nessun bundler.
7. **Polling** — Frontend aggiorna l’albero ogni N secondi (default 30); no WebSocket in v1.
8. **Albero a 2 livelli** — Radice = file eccezione (per timestamp); foglie = singole righe eccezione nel file.
9. **FilePrefix da config** — Si scansionano solo `{filePrefix}-exceptions_*.log` in `files.logDirectory`.
10. **Italiano** — Messaggi log del server monitor in italiano (coerente con downloader).

→ Correggere ora se qualcosa non torna.

---

## Objective

**Cosa costruiamo:** estensione di `cloudwatch-log-downloader` con:

1. **Servizio JSON** che espone eccezioni + contesto (10 righe before/after)
2. **Mini frontend web** — albero a sinistra, dettaglio contesto a destra

**Perché:** accelerare il monitoraggio operativo degli errori e preparare integrazione LLM (consumer JSON).

**Successo:** con `npm run start:prod` aperto, il developer visita `http://localhost:3847`, vede le eccezioni in albero, clicca una foglia e legge errore + contesto senza aprire file manualmente.

---

## User flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser  http://localhost:3847                               │
├──────────────────────┬──────────────────────────────────────────┤
│  ALBERO (sx)         │  DETTAGLIO (dx)                          │
│                      │                                          │
│  ▼ 11-49 (1 err)     │  Eccezione #1 — 2026-06-19 09:39:34     │
│    └ Error retrieve..│  ─────────────────────────────────────   │
│  ▼ 11-41 (3 err)     │  [985] ... riga contesto ...             │
│    └ Error on main   │  [986] ...                               │
│    └ Failed Kafka    │  ...                                     │
│    └ Traceback...    │  ▶ [995] ERROR ... SinistroUtils ...     │  ← evidenziata
│                      │  ...                                     │
│                      │  [996] ...                               │
│                      │  [997] ...                               │
└──────────────────────┴──────────────────────────────────────────┘
         ▲ polling 30s
         │
┌────────┴────────┐     legge      ┌─────────────────────────────┐
│  Monitor API    │ ◄───────────── │  ./logs/                    │
│  (Node http)    │                │  *-exceptions_*.log         │
└────────┬────────┘                │  my-app-logs-prod_*  │
         │                          └─────────────────────────────┘
┌────────┴────────┐
│  Downloader     │  (cron CloudWatch — esistente)
│  index.js       │
└─────────────────┘
```

---

## Tech Stack

| Layer | Scelta |
|-------|--------|
| Runtime | Node.js 16+ (esistente) |
| HTTP | `http` nativo Node (ADR-003) |
| Frontend | HTML5 + CSS + vanilla JS |
| File I/O | `fs-extra` (già presente) |
| Nessuna nuova dipendenza npm in v1 | |

---

## Commands (post-implementazione)

```bash
cd cloudwatch-log-downloader

# Avvio completo: downloader + monitor UI
npm run start:prod
# → CloudWatch download + http://localhost:3847

# Solo verifica API (manuale)
curl http://localhost:3847/api/v1/exceptions/tree
curl http://localhost:3847/api/v1/exceptions/2026-06-19_11-49:1

# Health
curl http://localhost:3847/api/v1/health
```

---

## Project Structure (delta)

```
cloudwatch-log-downloader/
├── src/
│   ├── index.js                    # avvia anche MonitorServer se enabled
│   ├── monitor/
│   │   ├── monitor-server.js       # HTTP server + routing
│   │   ├── exception-index.js      # scan file, build tree, cache
│   │   └── exception-context.js    # resolve contesto ±N righe
│   └── ... (esistente)
├── public/
│   ├── index.html                  # layout 2 colonne
│   ├── css/monitor.css
│   └── js/monitor.js               # fetch tree + detail + polling
├── config.sample.json              # + sezione monitor
└── logs/                           # sorgente dati (invariato)
```

---

## Configurazione proposta

Aggiungere a `config.sample.json` (e file env locali):

```json
{
  "monitor": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 3847,
    "contextLinesBefore": 10,
    "contextLinesAfter": 10,
    "treeRefreshSeconds": 30,
    "maxExceptionFiles": 50
  }
}
```

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `enabled` | `true` | Avvia server HTTP monitor |
| `host` | `127.0.0.1` | Bind locale only |
| `port` | `3847` | Porta HTTP |
| `contextLinesBefore` | `10` | Righe sopra eccezione |
| `contextLinesAfter` | `10` | Righe sotto eccezione |
| `treeRefreshSeconds` | `30` | Hint per polling frontend |
| `maxExceptionFiles` | `50` | Limite file in tree API |

---

## Code Style

- CommonJS come codice esistente (`require` / `module.exports`)
- Classi per server e indexer (coerente con `FileManager`, `CloudWatchClient`)
- Funzioni pure per parsing nomi file e matching righe (testabili)
- Esempio naming file accoppiato:

```javascript
// exception-context.js
function getPairedMainFilename(exceptionFilename, filePrefix) {
  // my-app-logs-prod-exceptions_2026-06-19_11-49.log
  // → my-app-logs-prod_2026-06-19_11-49.log
  const suffix = exceptionFilename.slice(`${filePrefix}-exceptions_`.length);
  return `${filePrefix}_${suffix}`;
}
```

---

## Testing Strategy

| Livello | Cosa | Framework |
|---------|------|-----------|
| Unit | `getPairedMainFilename`, parse id, find line in main, slice context | Node test runner o jest (da decidere in `/plan`) |
| Integration | API `/tree` e `/:id` con fixture in `tests/fixtures/logs/` | supertest o fetch nativo |
| Manuale | Browser su file reali prod | checklist AC |

**Fixture minima:**

```
tests/fixtures/logs/
  my-app-exceptions_test.log  (2 righe)
  my-app_test.log             (20 righe, eccezioni a linea 5 e 15)
```

**Coverage target v1:** funzioni parsing + context resolver ≥ 80%.

---

## Boundaries

### In scope (v1)

- API REST JSON (contratto in `API-contract-exception-monitor.md`)
- UI 2 pannelli + albero + dettaglio
- Integrazione processo unico con downloader
- Config `monitor.*`

### Out of scope (v1)

- Auth, HTTPS, deploy remoto
- WebSocket live push
- Filtri/ricerca/full-text
- Multilinea stack trace (Q7)
- LLM integration (Q5 — consumer API sì, UI LLM no)
- Modifiche alle applicazioni monitorate / Helm / EKS

### Always do

- Leggere eccezioni solo da `files.logDirectory`
- Usare `filePrefix` da config per scan
- Bind `127.0.0.1` by default
- Messaggi errore API in JSON strutturato `{ "error": "...", "code": "..." }`
- Evidenziare riga eccezione nel pannello destro

### Ask first

- Aggiungere dipendenza npm (`express`, `fastify`, …)
- Esporre su `0.0.0.0` (accesso rete)
- Cambiare formato nomi file log

### Never do

- Committare `config.uat.json` / `config.prod.json`
- Eseguire codice arbitrario da path utente
- Modificare file log (solo lettura)

---

## Criteri di accettazione

| ID | Condizione testabile |
|----|----------------------|
| **AC1** | Con `monitor.enabled: true`, dopo `npm run start:prod` risponde `GET /api/v1/health` con `200` |
| **AC2** | `GET /api/v1/exceptions/tree` elenca file `-exceptions_*` con foglie per ogni riga non vuota |
| **AC3** | `GET /api/v1/exceptions/{id}` restituisce `exception.line` + `context.before` (≤10) + `context.after` (≤10) |
| **AC4** | Contesto estratto dal file main accoppiato; riga eccezione evidenziata con `lineNumberInMain` corretto su fixture e file prod reali |
| **AC5** | Frontend: click foglia → pannello dx popolato entro 1s su localhost |
| **AC6** | Albero si aggiorna al polling senza reload pagina quando appare nuovo file eccezione |
| **AC7** | Con `monitor.enabled: false`, nessuna porta HTTP aperta; downloader funziona come oggi |
| **AC8** | File main mancante → API risponde con `warning`, non crash |

---

## Domande aperte — risolte (2026-06-19)

| # | Domanda | Decisione |
|---|---------|-----------|
| Q1 | Porta HTTP default? | **`3847`** |
| Q2 | Albero raggruppato anche per **data** (giorno)? | **No** — solo file → eccezioni in v1 |
| Q3 | Preview foglia: primi N caratteri? | **120** caratteri |
| Q4 | Ordinamento foglie | **Cronologico** (ordine nel file) |
| Q5 | Auto-open ultima eccezione all’avvio UI? | **No** |
| Q6 | Evidenziare righe ERROR/WARN nel contesto con colori? | **Sì** — CSS minimo |
| Q7 | Stessa riga duplicata nel main? | **Prima occorrenza** |
| Q8 | File eccezione senza main accoppiato? | **Sì** in tree; dettaglio con `warning` |

---

## Algoritmo contesto (dettaglio)

```
Input: exceptionFile, lineIndex N, contextBefore=10, contextAfter=10

1. lines_exc = readLines(exceptionFile)
2. exc_line = lines_exc[N-1]
3. timestamp = parseTimestampFromFilename(exceptionFile)
   → "2026-06-19_11-49"
4. mainFile = `{filePrefix}_{timestamp}.log`
5. if !exists(mainFile) → return { exception: exc_line, context: empty, warning }
6. lines_main = readLines(mainFile)
7. idx = lines_main.findIndex(l => l.trim() === exc_line.trim())
8. if idx === -1 → return { exception: exc_line, context: empty, warning: "main_line_not_found" }
9. before = lines_main[max(0,idx-10) .. idx-1] con lineNumber
10. after = lines_main[idx+1 .. min(len, idx+10)] con lineNumber
11. return { exception, context: { before, after }, lineNumberInMain: idx+1 }
```

---

## UI wireframe (testuale)

**Layout:** CSS grid / flex — 35% sx | 65% dx, min-height 100vh.

**Sinistra:**
- Header: "Eccezioni" + badge count totale + last refresh time
- Tree: `<details>` annidati o `<ul>` — file espandibile, foglie cliccabili
- Foglia selezionata: classe `.active`

**Destra:**
- Placeholder: "Seleziona un'eccezione dall'albero"
- Dettaglio: metadata (timestamp, source, file, line numbers)
- Blocco monospace scrollabile: righe contesto; riga eccezione con background diverso

**Stile:** scuro/chiaro semplice, monospace per log (`font-family: ui-monospace, monospace`).

---

## Dipendenze con sistema esistente

| Componente esistente | Uso |
|---------------------|-----|
| `files.filePrefix` | Pattern scan `*-exceptions_*` |
| `files.logDirectory` | Root lettura file |
| `preserveExceptionPairs` | Garantisce main file per eccezioni storiche |
| `exceptionPatterns` | Indiretto — definisce cosa finisce in file eccezione |
| Downloader cron | Continua a popolare `./logs/`; monitor è read-only |

---

## Success Criteria (testabili)

| ID | Condizione |
|----|------------|
| SC1 | PRD + spec + API contract + ADR presenti in `docs/` |
| SC2 | Review umana spec completata | ✅ 2026-06-19 |
| SC3 | Demo end-to-end documentata in QUICK_START (sezione monitor) |
| SC4 | Q1–Q8 risolte | ✅ default approvati |

---

## Prossimi passi SDLC

1. ~~**Review umana**~~ ✅ approvata 2026-06-19
2. **`/plan`** — task atomici (server → indexer → API → UI → test)
3. **`/build`** — implementazione incrementale
4. **`/test`** — fixture + verifica browser
5. Aggiornare `docs/NEXT-STEPS.md` e QUICK_START (sezione monitor)

**Pronto per `/plan` e `/build`.**

---

## Documenti correlati

- [PRD-exception-monitor-ui.md](./PRD-exception-monitor-ui.md)
- [API-contract-exception-monitor.md](./API-contract-exception-monitor.md)
- [ADR-003-exception-monitor-web-ui.md](./ADR-003-exception-monitor-web-ui.md)
- [exception-patterns-guide.md](./exception-patterns-guide.md)
- [spec-general.md](./spec-general.md)
- [NEXT-STEPS.md](./NEXT-STEPS.md)
