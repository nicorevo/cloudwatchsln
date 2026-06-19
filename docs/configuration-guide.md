---
title: "Guida configurazione — cloudwatch-log-downloader"
status: accepted
created: 2026-06-19
---

# Guida configurazione

File template committato: `cloudwatch-log-downloader/config.sample.json`  
File operativi locali (gitignored): `config.uat.json`, `config.prod.json`

```bash
cp cloudwatch-log-downloader/config.sample.json cloudwatch-log-downloader/config.prod.json
```

Avvio per ambiente:

| Comando | File config |
|---------|-------------|
| `npm run start:prod` | `config.prod.json` |
| `npm run start:uat` | `config.uat.json` |

Variabile `CONFIG_ENV` seleziona il file (`uat` | `prod`).

---

## Sezione `aws`

```json
"aws": {
  "region": "eu-west-1",
  "profile": "my-aws-sso-profile",
  "credentialRefreshIntervalMinutes": 55,
  "loginOnStartupIfNeeded": false,
  "ssoSessionWarningMinutes": 30
}
```

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `region` | — | Regione AWS (obbligatoria) |
| `profile` | — | Profilo AWS CLI / SSO |
| `credentialRefreshIntervalMinutes` | `55` | Refresh proattivo credenziali STS |
| `loginOnStartupIfNeeded` | `false` | Se `true`, esegue `aws sso login` se sessione assente |
| `ssoSessionWarningMinutes` | `30` | Warning se sessione SSO scade entro N minuti |

Dettaglio SSO: [`spec-aws-sso-session.md`](./spec-aws-sso-session.md)

---

## Sezione `cloudwatch`

```json
"cloudwatch": {
  "logGroups": [
    "/eks/my-namespace/my-service-prod"
  ],
  "filterPattern": "",
  "maxResults": 100000,
  "monitorPatterns": [],
  "exceptionPatterns": []
}
```

| Campo | Descrizione |
|-------|-------------|
| `logGroups[]` | **Preferito.** Array path log group CloudWatch |
| `logGroupName` | Legacy: singolo log group |
| `podKeywords` | Legacy: filtro stream (solo con `logGroupName`) |
| `filterPattern` | Filtro CloudWatch lato API (syntax AWS) |
| `maxResults` | Cap eventi per ciclo download |
| `monitorPatterns` | Se **vuoto** → tutte le righe nel file main |
| `exceptionPatterns` | Substring → file `-exceptions_*` |

Scoperta log group EKS: [`ADR-002-eks-native-log-groups.md`](./ADR-002-eks-native-log-groups.md)  
Pattern eccezioni: [`exception-patterns-guide.md`](./exception-patterns-guide.md)

---

## Sezione `files`

```json
"files": {
  "logDirectory": "./logs",
  "retentionMinutes": 60,
  "filePrefix": "my-app-logs-prod",
  "preserveExceptionPairs": true
}
```

| Campo | Descrizione |
|-------|-------------|
| `logDirectory` | Cartella output |
| `retentionMinutes` | Età max file normali prima del cleanup |
| `filePrefix` | Prefisso: `{prefix}_timestamp.log` e `{prefix}-exceptions_timestamp.log` |
| `preserveExceptionPairs` | Non elimina eccezioni + main accoppiato |

---

## Sezione `schedule`

```json
"schedule": {
  "downloadInterval": "*/1 * * * *",
  "cleanupInterval": "*/60 * * * *"
}
```

Espressioni cron (timezone `Europe/Rome`).

---

## Sezione `monitor`

```json
"monitor": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 3847,
  "contextLinesBefore": 10,
  "contextLinesAfter": 10,
  "treeRefreshSeconds": 30,
  "maxExceptionFiles": 50
}
```

| Campo | Descrizione |
|-------|-------------|
| `enabled` | UI + API eccezioni |
| `host` | Bind (`127.0.0.1` consigliato) |
| `port` | Porta HTTP |
| `contextLinesBefore/After` | Righe contesto nel dettaglio |
| `treeRefreshSeconds` | Polling albero frontend |
| `maxExceptionFiles` | Max file eccezione in albero |

API: [`API-contract-exception-monitor.md`](./API-contract-exception-monitor.md)

---

## Sezione `logging`

```json
"logging": {
  "level": "info",
  "enableConsole": true
}
```

Livelli: `error`, `warn`, `info`, `debug` — solo log del **downloader**, non contenuto CloudWatch.

---

## Formato output file

```
[timestamp ISO] [logGroup | container_name] messaggio
```

Esempio generico:

```
[2026-06-19T12:00:00.000Z] [/eks/my-ns/my-api-prod | my-api-container] [ERROR][MY-APP]: connection timeout
```

---

## Checklist nuovo progetto

- [ ] Profilo AWS SSO configurato (`aws configure sso`)
- [ ] `logGroups[]` verificati in console CloudWatch
- [ ] `filePrefix` univoco per applicazione
- [ ] `exceptionPatterns[]` derivati da sorgente (vedi guida AI)
- [ ] `npm run start:prod` → file in `./logs/`
- [ ] UI `http://127.0.0.1:3847` mostra eccezioni
