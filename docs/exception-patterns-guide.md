---
title: "Guida — Pattern di eccezione e monitoraggio errori"
status: accepted
created: 2026-06-19
---

# Guida: intercettare eccezioni nei log CloudWatch

Questa guida spiega **come configurare `exceptionPatterns[]`** per estrarre errori rilevanti dai log scaricati, e come usare un **assistente AI** per derivare i pattern dal codice sorgente della tua applicazione.

---

## Come funziona

1. Il downloader scarica **tutte** le righe matching i log group in file `{filePrefix}_YYYY-MM-DD_HH-mm.log`.
2. Per ogni riga, se il testo contiene **almeno uno** dei pattern in `exceptionPatterns[]`, la riga viene **anche** scritta in `{filePrefix}-exceptions_YYYY-MM-DD_HH-mm.log`.
3. I file eccezione e il file main con lo **stesso timestamp** formano una **coppia**: la UI Monitor usa il main per mostrare ±10 righe di contesto.

```json
"exceptionPatterns": [
  " ERROR ",
  "Exception",
  "Traceback (most recent call last)"
]
```

| Campo correlato | Effetto |
|-----------------|---------|
| `preserveExceptionPairs: true` | Non cancella file `-exceptions_*` né il main accoppiato |
| `monitorPatterns: []` | Vuoto = tutte le righe vanno nel file main (consigliato) |

---

## Workflow con AI (consigliato)

Quando integri un **nuovo microservizio**, non indovinare i pattern: derivali dal codice.

### Passo 1 — Prepara il contesto

Raccogli per l'AI:

- Linguaggio e framework (Spring Boot, FastAPI, ecc.)
- File sorgente dove si loggano errori (`logger.error`, `log.error`, `revoLog`, …)
- 2–3 righe di log reali da CloudWatch (se già disponibili)
- Formato logger (es. `[ERROR][MY-APP][module]: message`)

### Passo 2 — Prompt di esempio

```text
Sto configurando cloudwatch-log-downloader. Devo popolare exceptionPatterns[]
in config.json: un array di sottostringhe; se una riga di log le contiene,
viene copiata in un file eccezioni separato.

Analizza il codice allegato e produci:

1. Lista pattern (stringhe esatte o prefissi utili per grep)
2. Classificazione P0 (critico) / P1 (integrazione) / P2 (singolo messaggio) / P3 (warning)
3. Pattern generici cross-linguaggio (ERROR, Exception, Traceback, stack Java)
4. JSON pronto da incollare in "exceptionPatterns": [ ... ]

Evita pattern troppo corti che generano falsi positivi (es. "Error" da solo).
Preferisci messaggi distintivi dal codice.
```

### Passo 3 — Valida i pattern

1. Incolla i pattern in `config.prod.json` (locale).
2. Riavvia: `npm run start:prod`.
3. Controlla `./logs/*-exceptions_*.log` — ci sono falsi positivi? Pattern mancanti?
4. Apri `http://127.0.0.1:3847` — le eccezioni hanno contesto utile?
5. Itera con l'AI su un campione di righe mancanti o rumore.

### Passo 4 — Documenta (opzionale)

Se il progetto ha una cartella applicativa separata, salva il catalogo P0–P3 in  
`<tuo-progetto>/docs/exception-catalog.md` per manutenzione futura.

---

## Pattern generici utili

Parti da questa base e aggiungi pattern specifici del tuo dominio:

```json
"exceptionPatterns": [
  " ERROR ",
  " FATAL ",
  "Exception",
  "Traceback (most recent call last)",
  "Caused by:",
  "Unhandled exception",
  "failed with status",
  "Error on main",
  "Main Error"
]
```

| Stack | Pattern tipici |
|-------|----------------|
| **Python** | `Traceback (most recent call last)`, `[ERROR]`, `logger.error(` nel sorgente → messaggio letterale |
| **Java / Spring** | ` ERROR ` (con spazi), `Exception:`, `Failed to`, nome classe eccezione |
| **Node.js** | `UnhandledPromiseRejection`, `[ERROR]`, messaggi `console.error` distintivi |
| **Go** | `panic:`, `level=error` |

---

## Priorità (P0–P3)

| Livello | Quando usarlo | Esempio pattern |
|---------|---------------|-----------------|
| **P0** | Pipeline ferma, loop principale crashato | `Error on main`, `Fatal`, `shutdown hook` |
| **P1** | Integrazione esterna down | `Connection refused`, `timeout`, `401`, `403` |
| **P2** | Singolo record/messaggio fallito | `Failed to process`, `Invalid payload` |
| **P3** | Warning operativi | `Retry`, `deprecated`, `skipped` |

Tutti possono stare in `exceptionPatterns[]`; la classificazione serve a te (grep, alert manuali, prompt LLM).

---

## Anti-pattern

| Evitare | Perché |
|---------|--------|
| Pattern troppo corti (`"err"`, `"fail"`) | Troppi falsi positivi |
| Solo regex mentali | Il matcher è **substring**, non regex |
| Duplicati ridondanti | `"ERROR"` e `" ERROR "` — scegli quello che matcha il formato reale |
| Pattern da ambiente diverso | Valida sempre su log **prod/UAT reali** |

---

## Analisi rapida da terminale

```bash
# Ultimi file eccezione
ls -lt logs/*exceptions*.log | head -5

# Conteggio per pattern
grep -c " ERROR " logs/*exceptions*.log

# Ultime 20 eccezioni
tail -20 logs/my-app-exceptions_*.log
```

---

## Riferimenti

- [`configuration-guide.md`](./configuration-guide.md) — tutti i campi config
- [`API-contract-exception-monitor.md`](./API-contract-exception-monitor.md) — API JSON per automazioni LLM
- [`spec-exception-monitor-ui.md`](./spec-exception-monitor-ui.md) — requisiti UI
