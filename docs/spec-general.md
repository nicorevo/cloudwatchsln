---
title: "cloudWatch Log Downloader — Specifica generale"
status: accepted
created: 2026-06-18
updated: 2026-06-19
author: ""
ai-assisted: true
human-reviewed: false
---

# Spec: CloudWatch Log Downloader — piattaforma di osservabilità log

## Assunzioni

1. **Componente principale:** `cloudwatch-log-downloader` — consumatore locale Node.js che interroga CloudWatch e scrive file rolling.
2. **Applicazioni monitorate** sono esterne al repo: l'utente configura `logGroups[]` e `exceptionPatterns[]` per il proprio stack.
3. **Autenticazione:** AWS IAM Identity Center (SSO) via profilo CLI; refresh credenziali STS ogni ~55 min.
4. **Nessun secret** nel repository; config operativi locali gitignored.
5. **Exception Monitor** opzionale nello stesso processo (UI + API REST).

---

## Objective

**Cosa costruiamo:** un tool locale che:

1. Scarica log da uno o più **log group CloudWatch** su intervallo configurabile.
2. Scrive file testuali rolling in `./logs/` per analisi offline (grep, IDE, LLM).
3. Estrae righe di errore in file `-exceptions_*` tramite pattern configurabili.
4. Espone una **UI web locale** per navigare eccezioni con contesto.

**Perché:** osservare microservizi in UAT/prod senza console AWS, con workflow ripetibile e configurabile per qualsiasi applicazione.

**Successo:** un developer clona il repo, configura `config.prod.json`, fa login SSO, avvia il servizio e trova log + eccezioni in `./logs/` e nella UI.

---

## Architettura logica

```
┌─────────────────────────────────────────────────────────────────┐
│  AWS CloudWatch Logs                                            │
│  logGroups[]  (EKS / Lambda / ECS / custom)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ FilterLogEvents
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  cloudwatch-log-downloader (Node.js, locale)                    │
│  • AwsAuthManager (SSO + refresh STS)                           │
│  • CloudWatchClient (paginazione multi group)                   │
│  • FileManager (rolling, eccezioni, retention)                  │
│  • MonitorServer (HTTP 127.0.0.1:3847)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
              ./logs/{prefix}_*.log
              ./logs/{prefix}-exceptions_*.log
                            │
                            ▼
              grep / LLM / Exception Monitor UI
```

---

## Componente: cloudwatch-log-downloader

**Path:** `cloudwatch-log-downloader/`  
**Stack:** Node.js 16+, AWS SDK v3, node-cron, fs-extra

| Modulo | Ruolo |
|--------|-------|
| `src/index.js` | Orchestrazione, cron download/cleanup, refresh credenziali |
| `src/aws-auth-manager.js` | Autenticazione SSO, refresh STS |
| `src/cloudwatch-client.js` | FilterLogEvents, multi log group |
| `src/file-manager.js` | Scrittura rolling, eccezioni, retention |
| `src/monitor/` | Exception Monitor UI + API |
| `config.sample.json` | Template committato |

**Setup:**

```bash
cd cloudwatch-log-downloader
cp config.sample.json config.prod.json
# personalizza aws.profile, logGroups[], exceptionPatterns[], filePrefix
aws sso login --profile my-aws-sso-profile
npm run start:prod
```

---

## Configurazione eccezioni

`exceptionPatterns[]` — array di sottostringhe. Workflow consigliato con AI sul sorgente applicativo:  
[`exception-patterns-guide.md`](./exception-patterns-guide.md)

Guida campi config: [`configuration-guide.md`](./configuration-guide.md)

---

## Project structure

```
cloudWatchSln/
├── README.md                          # Homepage GitHub
├── docs/
│   ├── spec-general.md                # ← questo documento
│   ├── configuration-guide.md
│   ├── exception-patterns-guide.md
│   ├── spec-aws-sso-session.md
│   ├── spec-exception-monitor-ui.md
│   └── ...
└── cloudwatch-log-downloader/
    ├── config.sample.json
    ├── config.uat.json / config.prod.json  (locali, gitignored)
    ├── src/
    ├── public/
    ├── tests/
    └── logs/                          (generato)
```

---

## Testing strategy

| Area | Framework | Note |
|------|-----------|------|
| Auth SSO | node:test | `tests/aws-auth-manager.test.js` |
| Monitor | node:test | server, index, context |
| Config | node:test | normalizzazione aws/monitor |
| E2E CloudWatch | Manuale | Richiede account AWS reale |

```bash
cd cloudwatch-log-downloader && npm test
```

---

## Success criteria

| ID | Condizione |
|----|------------|
| SC1 | README + guide config permettono setup senza conoscenza interna del team |
| SC2 | `config.sample.json` sufficiente come template pubblico |
| SC3 | Exception Monitor funziona su file `-exceptions_*` generati |
| SC4 | Auth all'avvio + refresh STS documentati e testati |
| SC5 | Workflow AI per `exceptionPatterns` documentato |

---

## Confini

### In scope

- Downloader CloudWatch generico e configurabile
- Exception Monitor locale
- Documentazione pubblica senza riferimenti ad ambienti privati

### Out of scope

- Deploy managed 24/7 in cloud (usare IAM role dedicato)
- Modifica applicazioni monitorate
- Access key IAM long-lived

### Never do

- Committare `config.prod.json`, `config.uat.json`, credenziali
- Hardcodare account AWS o log group reali in docs pubblici

---

## Riferimenti

- [`configuration-guide.md`](./configuration-guide.md)
- [`exception-patterns-guide.md`](./exception-patterns-guide.md)
- [`NEXT-STEPS.md`](./NEXT-STEPS.md)
- [`ADR-002-eks-native-log-groups.md`](./ADR-002-eks-native-log-groups.md)
- [`ADR-004-aws-sso-session-management.md`](./ADR-004-aws-sso-session-management.md)
