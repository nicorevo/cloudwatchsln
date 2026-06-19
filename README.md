# CloudWatch Log Downloader

**Scarica log da AWS CloudWatch in file locali**, con rolling automatico, estrazione eccezioni e **Exception Monitor** — un'interfaccia web per navigare errori e contesto.

Pensato per team che vogliono **osservare microservizi in UAT/prod** senza passare dalla console AWS: grep, script, AI o debug offline su file testuali.

```
  AWS CloudWatch (logGroups[])
           │
           ▼
  cloudwatch-log-downloader  ──►  ./logs/my-app_2026-06-19_12-00.log
           │                      ./logs/my-app-exceptions_2026-06-19_12-00.log
           ▼
  http://127.0.0.1:3847  (albero eccezioni + contesto ±10 righe)
```

---

## Funzionalità

| Funzione | Descrizione |
|----------|-------------|
| **Download schedulato** | Polling CloudWatch con cron configurabile |
| **Multi log group** | Un array `logGroups[]` — tipico EKS: un path per pod/deployment |
| **File rolling** | Un file al minuto (configurabile), append nello stesso minuto |
| **Eccezioni** | Pattern configurabili → file `-exceptions_*.log` dedicati |
| **Retention** | Cleanup automatico; opzione `preserveExceptionPairs` per tenere coppie eccezione/main |
| **AWS SSO** | Auth all'avvio + refresh credenziali STS ogni ~55 min |
| **Exception Monitor** | UI locale + API REST JSON (`/api/v1/...`) |

---

## Quick start

### 1. Prerequisiti

- **Node.js 16+**
- **AWS CLI v2** con [IAM Identity Center (SSO)](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html) configurato

```bash
cd cloudwatch-log-downloader
npm install
```

### 2. Configurazione

Copia il template e personalizzalo:

```bash
cp config.sample.json config.prod.json   # o config.uat.json
```

I file `config.*.json` locali **non vanno committati** (sono in `.gitignore`). In repo resta solo `config.sample.json`.

Campi essenziali:

```json
{
  "environment": "prod",
  "project": "my-application",
  "aws": {
    "region": "eu-west-1",
    "profile": "my-aws-sso-profile"
  },
  "cloudwatch": {
    "logGroups": [
      "/eks/my-namespace/my-worker-prod",
      "/eks/my-namespace/my-api-prod"
    ],
    "exceptionPatterns": [
      " ERROR ",
      "Exception",
      "Traceback (most recent call last)"
    ]
  },
  "files": {
    "logDirectory": "./logs",
    "filePrefix": "my-app-logs-prod",
    "retentionMinutes": 60,
    "preserveExceptionPairs": true
  }
}
```

| Campo | Cosa fa |
|-------|---------|
| `logGroups[]` | Path CloudWatch da interrogare (preferito su EKS) |
| `exceptionPatterns[]` | Sottostringhe che finiscono nel file `-exceptions_*` |
| `filePrefix` | Prefisso nomi file in `./logs/` |
| `monitor.enabled` | UI eccezioni su `http://127.0.0.1:3847` |

Guida completa: [`docs/configuration-guide.md`](docs/configuration-guide.md)

### 3. Login AWS e avvio

```bash
aws sso login --profile my-aws-sso-profile
npm run check-sso-expiry:prod    # opzionale: scadenza sessione SSO
npm run start:prod
```

Output atteso:

```
Console web:  http://127.0.0.1:3847/
API REST:     http://127.0.0.1:3847/api/v1
```

File generati:

```
logs/
├── my-app-logs-prod_2026-06-19_12-00.log
├── my-app-logs-prod-exceptions_2026-06-19_12-00.log
└── ...
```

---

## Configurare i pattern di eccezione (con AI)

Il passo più importante per un nuovo progetto è popolare `exceptionPatterns[]`: stringhe che, se trovate in una riga di log, la copiano nel file eccezioni.

### Workflow consigliato

1. **Avvia il downloader** con `exceptionPatterns` minimi (es. `" ERROR "`).
2. **Raccogli log** per qualche minuto in `./logs/`.
3. **Passa il sorgente dell'applicazione a un AI** (Cursor, Claude, ChatGPT) con un prompt del tipo:

   > Analizza questo codice e produci un elenco di pattern di log da usare in `exceptionPatterns` di un downloader CloudWatch. Includi messaggi ERROR esatti, prefissi di logger, stack trace Python/Java, e classifica per priorità P0–P3.

4. **Incolla i pattern** in `config.prod.json` → riavvia il servizio.
5. **Verifica** in `./logs/*-exceptions_*.log` e nella UI su `:3847`.

Guida dettagliata: [`docs/exception-patterns-guide.md`](docs/exception-patterns-guide.md)

---

## Exception Monitor

Con `monitor.enabled: true` (default nel sample):

| URL | Descrizione |
|-----|-------------|
| `http://127.0.0.1:3847/` | Albero eccezioni + pannello contesto |
| `GET /api/v1/exceptions/tree` | JSON albero file → eccezioni |
| `GET /api/v1/exceptions/:id` | Eccezione + righe before/after dal file main |
| `GET /api/v1/health` | Stato monitor |

Contratto API: [`docs/API-contract-exception-monitor.md`](docs/API-contract-exception-monitor.md)

---

## Script npm

| Comando | Azione |
|---------|--------|
| `npm run start:prod` | Avvio con `config.prod.json` |
| `npm run start:uat` | Avvio con `config.uat.json` |
| `npm run check-sso-expiry:prod` | Scadenza sessione SSO portal |
| `npm test` | Test automatizzati |

Setup SSO iniziale: `cloudwatch-log-downloader/setup-sso.sh`

---

## Documentazione

| Documento | Contenuto |
|-----------|-----------|
| [`docs/configuration-guide.md`](docs/configuration-guide.md) | Tutti i campi config |
| [`docs/exception-patterns-guide.md`](docs/exception-patterns-guide.md) | Pattern eccezioni + workflow AI |
| [`docs/spec-aws-sso-session.md`](docs/spec-aws-sso-session.md) | Sessione SSO e refresh credenziali |
| [`cloudwatch-log-downloader/README.md`](cloudwatch-log-downloader/README.md) | Riferimento tecnico modulo |
| [`cloudwatch-log-downloader/QUICK_START.md`](cloudwatch-log-downloader/QUICK_START.md) | Guida operativa rapida |

---

## Architettura

```
cloudwatch-log-downloader/
├── src/
│   ├── index.js                 # Orchestrazione, cron, auth
│   ├── aws-auth-manager.js      # SSO + refresh STS
│   ├── cloudwatch-client.js     # FilterLogEvents
│   ├── file-manager.js          # Rolling + eccezioni + retention
│   └── monitor/                 # HTTP server + UI eccezioni
├── public/                      # Frontend Exception Monitor
├── config.sample.json           # Template committato
├── config.prod.json             # Locale (gitignored)
└── tests/
```

---

## Troubleshooting

**Token SSO scaduto**

```bash
aws sso login --profile my-aws-sso-profile
npm run start:prod
```

**0 eventi scaricati** — verificare `logGroups[]`, regione e profilo AWS in CloudWatch Console.

**BrokenPipeError durante `aws sso login`** — spesso innocuo; controllare con `aws sts get-caller-identity --profile ...`.

---

## Licenza

Apache-2.0 — vedi [LICENSE](LICENSE).
