---
title: "cloudWatchSln — Autenticazione AWS SSO all'avvio e refresh orario"
status: draft
created: 2026-06-19
updated: 2026-06-19
author: ""
ai-assisted: true
human-reviewed: false
---

# Spec: autenticazione all'avvio e rinnovo automatico credenziali

> Evoluzione di [`spec-aws-sso-session.md`](./spec-aws-sso-session.md) — fase implementazione.

## Assunzioni

1. **Scenario richiesto:** all'avvio del downloader → **autenticazione esplicita** (verifica + acquisizione credenziali); durante l'esecuzione → **rinnovo automatico ogni ~1 ora** delle credenziali STS (non della sessione portal SSO).
2. **Prerequisito utente:** almeno una sessione SSO CLI valida (`aws sso login`) **oppure** login interattivo all'avvio se abilitato in config (`aws.loginOnStartupIfNeeded: true`).
3. **Token “ogni ora”** = credenziali temporanee del **ruolo IAM** (~3600 s), già allineate al modello AWS SSO; il refresh proattivo avviene **prima** della scadenza (default ogni **55 minuti**, configurabile).
4. **Sessione SSO portal** (ore, policy IT) **non** si rinnova automaticamente senza browser — quando scade serve `aws sso login` manuale o `loginOnStartupIfNeeded`.
5. **Nessuna access key statica** nel repo; si continua con `fromSSO({ profile })`.
6. **Fix incluso:** `CloudWatchClient` oggi chiama `initializeClient()` async nel costruttore **senza await** — va corretto in questa slice.

→ Correggere ora se serve login browser obbligatorio all'avvio (default: solo verifica, login opzionale).

---

## Domande aperte

| # | Domanda | Proposta default | Stato |
|---|---------|------------------|-------|
| Q-SSO-1 | Durata sessione SSO Revo (ore) | Documentare quando nota | Aperto |
| Q-SSO-6 | `loginOnStartupIfNeeded: true` di default? | **false** — fail-fast con messaggio chiaro | Aperto |
| Q-SSO-7 | Intervallo refresh: 55 min o esattamente 60? | **55 min** (margine prima scadenza STS) | Proposta |
| Q-SSO-8 | Bloccare avvio se sessione SSO scade entro N minuti? | **Warning** se < 30 min, non block | Proposta |

---

## Criteri di accettazione

### Autenticazione all'avvio

- [ ] **AC1** — All'avvio, prima del primo download, il servizio esegue `authenticate()`: ottiene credenziali via SSO e verifica con chiamata AWS leggera (`sts:GetCallerIdentity` o equivalente).
- [ ] **AC2** — Log info in italiano: profilo, account ID, scadenza credenziali STS (`expiration`), scadenza sessione SSO se leggibile da cache.
- [ ] **AC3** — Se sessione SSO assente/scaduta: **exit 1** con messaggio `aws sso login --profile <profile>` (o avvio login browser se `loginOnStartupIfNeeded: true`).
- [ ] **AC4** — Nessuna race: `init()` attende fine autenticazione prima di `downloadLogs()`.

### Rinnovo automatico orario

- [ ] **AC5** — Job periodico (default ogni 55 min, config `aws.credentialRefreshIntervalMinutes`) rinnova credenziali proattivamente.
- [ ] **AC6** — Ogni refresh logga esito e nuova `expiration` (livello info).
- [ ] **AC7** — Se refresh fallisce per sessione SSO scaduta: log error + messaggio re-login; download successivi falliscono con stesso messaggio (no crash silenzioso).
- [ ] **AC8** — Job fermato correttamente su SIGINT/SIGTERM.

### Qualità e config

- [ ] **AC9** — Sezione `aws` estesa in `config.sample.json` con nuovi campi documentati.
- [ ] **AC10** — Test unitari su `aws-auth-manager` (mock provider, errori token, parser scadenza).
- [ ] **AC11** — `npm test` verde; README/QUICK_START aggiornati.

---

## Confini del lavoro

### In scope

- Modulo `aws-auth-manager.js` (autenticazione, refresh, lettura scadenze).
- Refactor async `CloudWatchClient` + integrazione in `index.js`.
- Config refresh interval + flag login opzionale all'avvio.
- Test + documentazione operativa.

### Out of scope

- Rinnovo automatico sessione SSO portal oltre TTL AWS (impossibile senza browser).
- Access key IAM long-lived.
- IAM role per deploy server 24/7.
- Modifica permission set in IAM Identity Center.

### Always do

- Usare `fromSSO({ profile })` ufficiale AWS SDK v3.
- Messaggi utente in italiano.
- Fail-fast all'avvio se credenziali non ottenibili.

### Ask first

- Nuova dipendenza `@aws-sdk/client-sts` (se non riusabile via SDK esistente).

### Never do

- Committare token o file `~/.aws/`.
- Bypassare scadenza SSO con storage custom.

---

## Objective

**User story:**

```
AS A developer
I WANT TO che il downloader si autentichi all'avvio e rinnovi le credenziali ogni ora
SO THAT non devo preoccuparmi della scadenza STS durante sessioni lunghe di monitoraggio
```

**Successo:** `npm run start:prod` mostra autenticazione riuscita; il processo resta up > 1 h continuando a scaricare log senza intervento, finché la sessione SSO portal resta valida.

---

## Architettura proposta

```
index.js
  │
  ├─ loadConfig()
  ├─ AwsAuthManager.authenticate()     ← startup (AC1–AC4)
  ├─ CloudWatchClient.init(authManager)
  ├─ startCredentialRefreshJob()       ← ogni 55 min (AC5–AC8)
  ├─ downloadLogs() / cron jobs
  └─ shutdown → stop refresh job

AwsAuthManager
  ├─ createCredentialProvider()  → fromSSO({ profile })
  ├─ authenticate()              → provider() + verify (STS)
  ├─ refreshCredentials()        → provider() + log expiration
  ├─ getSsoSessionExpiry()       → legge ~/.aws/sso/cache (opzionale)
  └─ loginIfNeeded()             → spawn aws sso login (se config)

CloudWatchClient
  ├─ init(authManager)           → async, no fire-and-forget
  └─ getClient()                 → CloudWatchLogsClient con credentials live
```

### Due livelli di token (invariante)

| Livello | Durata | Rinnovo in questa feature |
|---------|--------|---------------------------|
| Sessione SSO (`aws sso login`) | Ore (IT) | Solo manuale / `loginOnStartupIfNeeded` |
| Credenziali STS ruolo | ~1 h | **Automatico ogni 55 min** + lazy SDK |

---

## Configurazione (`config.sample.json`)

```json
"aws": {
  "region": "eu-central-1",
  "profile": "YOUR_AWS_SSO_PROFILE",
  "credentialRefreshIntervalMinutes": 55,
  "loginOnStartupIfNeeded": false,
  "ssoSessionWarningMinutes": 30
}
```

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `credentialRefreshIntervalMinutes` | `55` | Intervallo refresh proattivo credenziali STS |
| `loginOnStartupIfNeeded` | `false` | Se true, esegue `aws sso login` quando sessione assente |
| `ssoSessionWarningMinutes` | `30` | Warning se sessione SSO scade entro N minuti |

---

## Comandi

```bash
cd cloudwatch-log-downloader
npm install
npm test

# Primo login (se sessione assente)
aws sso login --profile YOUR_AWS_PROFILE

# Avvio — autenticazione automatica all'init
npm run start:prod

# Verifica manuale sessione
npm run check-sso:prod
```

---

## Testing strategy

| Test | Tipo | Verifica |
|------|------|----------|
| `authenticate()` successo | Unit | mock provider → expiration loggata |
| SSO scaduto | Unit | errore italiano + hint login |
| Refresh periodico | Unit | fake timer, refresh chiamato |
| Init async | Integration | client pronto prima download |
| Manuale > 1 h | Manuale | log refresh + download continua |

---

## Success criteria

| ID | Condizione |
|----|------------|
| SC1 | Avvio mostra autenticazione OK con account e scadenza |
| SC2 | Dopo 55+ min processo up, log “Credenziali AWS rinnovate” |
| SC3 | Sessione SSO scaduta → messaggio actionable, no hang |
| SC4 | Tutti i test automatizzati passano |

---

## Riferimenti

- [`plan-aws-sso-session.md`](./plan-aws-sso-session.md) — task implementazione
- [`PRD-aws-sso-session.md`](./PRD-aws-sso-session.md)
- [`ADR-004-aws-sso-session-management.md`](./ADR-004-aws-sso-session-management.md)
- Codice attuale: `cloudwatch-log-downloader/src/cloudwatch-client.js`

---

## Gate

**Non procedere a `/build` finché:**

1. Review umana di spec + plan.
2. Conferma Q-SSO-6 (login browser all'avvio sì/no).
3. Conferma intervallo 55 vs 60 min (Q-SSO-7).
