---
title: "API Contract — Exception Monitor"
status: accepted
created: 2026-06-19
approved: 2026-06-19
---

# API Contract: Exception Monitor

> Fonte di verità per l’API REST del monitor eccezioni.
> Il codice deve conformarsi a questo documento.

## Base URL

```
http://localhost:{monitor.port}/api/v1
```

Default `monitor.port`: **3847** (confermato).

## Authentication

Nessuna in v1 (tool locale, stesso host del developer).

---

## GET /exceptions/tree

Restituisce la struttura ad albero per il frontend sinistro.

**Query params (opzionali):**

| Param | Tipo | Default | Descrizione |
|-------|------|---------|-------------|
| `limit` | number | 50 | Max file eccezione (più recenti prima) |

**Response 200:**

```json
{
  "generatedAt": "2026-06-19T12:00:00.000Z",
  "files": [
    {
      "id": "2026-06-19_11-49",
      "filename": "my-app-logs-prod-exceptions_2026-06-19_11-49.log",
      "mainFilename": "my-app-logs-prod_2026-06-19_11-49.log",
      "exceptionCount": 1,
      "exceptions": [
        {
          "id": "2026-06-19_11-49:1",
          "indexInFile": 1,
          "lineNumberInMain": 995,
          "timestamp": "2026-06-19T09:39:34.813Z",
          "preview": "ERROR ... connection timeout ...",
          "source": "/eks/my-namespace/my-worker-prod | my-worker-container"
        }
      ]
    }
  ]
}
```

**Campi nodo foglia (`exceptions[]`):**

| Campo | Descrizione |
|-------|-------------|
| `id` | Identificatore stabile `{timestamp-file}:{indexInFile}` |
| `preview` | Primi ~120 caratteri del body (dopo metadata riga) |
| `lineNumberInMain` | Riga nel file principale (1-based); `null` se non trovata |

---

## GET /exceptions/:id

Dettaglio eccezione con contesto.

**Path:** `id` = es. `2026-06-19_11-49:1`

**Response 200:**

```json
{
  "id": "2026-06-19_11-49:1",
  "exception": {
    "line": "[2026-06-19T09:39:34.813Z] [/eks/...] ... ERROR ...",
    "timestamp": "2026-06-19T09:39:34.813Z",
    "source": "/eks/my-namespace/my-worker-prod | my-worker-container",
    "lineNumberInExceptionFile": 1,
    "lineNumberInMain": 995
  },
  "context": {
    "before": [
      { "lineNumber": 985, "text": "..." },
      { "lineNumber": 986, "text": "..." }
    ],
    "after": [
      { "lineNumber": 996, "text": "..." },
      { "lineNumber": 997, "text": "..." }
    ],
    "contextLinesBefore": 10,
    "contextLinesAfter": 10
  },
  "files": {
    "exceptionFile": "my-app-logs-prod-exceptions_2026-06-19_11-49.log",
    "mainFile": "my-app-logs-prod_2026-06-19_11-49.log"
  }
}
```

**Logica contesto:**

1. Da `id` → file eccezione + indice riga N
2. Legge riga N dal file `-exceptions_*`
3. Trova file principale accoppiato (stesso timestamp nel nome)
4. Cerca riga **identica** (trim) nel file principale → `lineNumberInMain`
5. Estrae `[lineNumber - contextBefore .. lineNumber + contextAfter]`

Se riga non trovata nel main: `lineNumberInMain: null`, `context.before/after: []`, campo `warning: "main_line_not_found"`.

---

## GET /health

**Response 200:**

```json
{
  "status": "ok",
  "monitorEnabled": true,
  "logDirectory": "./logs",
  "exceptionFileCount": 3
}
```

---

## Static assets

| Path | Descrizione |
|------|-------------|
| `GET /` | Frontend (`public/index.html`) |
| `GET /assets/*` | CSS/JS statici |

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | ID eccezione malformato |
| 404 | Eccezione o file non trovato |
| 503 | Monitor disabilitato in config |

---

## Versioning

URL path `/api/v1/`. Breaking change → `/api/v2/`.

---

## Esempio flusso frontend

```
1. GET /api/v1/exceptions/tree        → render albero sx
2. User click foglia id=2026-06-19_11-49:1
3. GET /api/v1/exceptions/2026-06-19_11-49:1  → render pannello dx
4. setInterval 30s → ripete step 1 (tree refresh)
```
