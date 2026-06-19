# Implementation Plan: autenticazione AWS all'avvio e refresh orario

> Basato su [`spec-aws-sso-session.md`](./spec-aws-sso-session.md) e [`PRD-aws-sso-session.md`](./PRD-aws-sso-session.md).  
> **Modalità:** read-only — nessuna modifica codice in questa fase.

## Overview

Introduciamo `AwsAuthManager` per autenticazione esplicita all'avvio e refresh proattivo delle credenziali STS ogni ~55 minuti. Refactoriamo `CloudWatchClient` per init async sicuro e integriamo il refresh job nel lifecycle di `index.js` (avvio + shutdown).

**Deliverable:** modulo auth, client refactor, config, test, docs.

## Architecture Decisions

| Decisione | Scelta | Rationale |
|-----------|--------|-----------|
| Provider credenziali | `fromSSO({ profile })` | Già in uso; refresh STS ufficiale |
| Verifica all'avvio | `STS GetCallerIdentity` | Più leggero di `FilterLogEvents` |
| Intervallo refresh | 55 min (configurabile) | Margine prima scadenza STS ~60 min |
| Login browser all'avvio | Opt-in `loginOnStartupIfNeeded: false` | Evita surprise browser; fail-fast default |
| SSO session expiry | Lettura cache `~/.aws/sso/cache` | Solo warning, non block |
| Fix race client | `CloudWatchClient.init()` async | Bug attuale: `initializeClient()` non awaited |

## Dependency Graph

```
Task 1: aws-auth-manager (core)
    │
    ├── Task 2: unit tests auth manager
    │
    └── Task 3: refactor CloudWatchClient (async init)
            │
            ├── Task 4: wire index.js startup + refresh cron
            │
            └── Task 5: shutdown + error paths
                    │
                    ├── Task 6: config.sample + normalize
                    │
                    ├── Task 7: npm scripts + docs
                    │
                    └── Task 8: integration test / manual checklist
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SSO portal scade mentre STS refresh funziona | Med | Warning scadenza SSO; errore chiaro al primo refresh fallito |
| `@aws-sdk/client-sts` non in deps | Low | Aggiungere dipendenza minima o verificare con CloudWatch solo all'avvio |
| Parser cache SSO fragile | Low | Best-effort warning; auth core usa provider SDK |
| `loginOnStartupIfNeeded` in CI/headless | Med | Default false; documentare |
| Test timer refresh flaky | Low | Mock `setInterval` / inject clock |

## Task List

### Phase 1: Foundation

---

## Task 1: Modulo `AwsAuthManager`

**Description:** Creare `cloudwatch-log-downloader/src/aws-auth-manager.js` con:
- costruzione provider `fromSSO` / fallback `fromIni`;
- `authenticate()`: resolve credentials, verifica STS, ritorna metadata (account, expiration);
- `refreshCredentials()`: re-resolve + log;
- `getSsoSessionExpiry(profile)`: best-effort da cache SSO;
- `loginIfNeeded()`: spawn `aws sso login --profile X` se config abilitata;
- helper errore token scaduto in italiano.

**Acceptance criteria:**
- [ ] API pubblica documentata nel file
- [ ] `authenticate()` throw con messaggio actionable se SSO scaduto
- [ ] `refreshCredentials()` ritorna nuova `expiration`

**Verification:**
- [ ] Test unit Task 2 passano
- [ ] Lint/read no errori evidenti

**Dependencies:** None

**Files likely touched:**
- `cloudwatch-log-downloader/src/aws-auth-manager.js` (new)

**Estimated scope:** M

---

## Task 2: Unit test `aws-auth-manager`

**Description:** Test in `tests/aws-auth-manager.test.js` con mock credential provider e fixture cache SSO JSON.

**Acceptance criteria:**
- [ ] Test authenticate success (expiration presente)
- [ ] Test SSO scaduto → messaggio contiene `aws sso login`
- [ ] Test parser `expiresAt` cache SSO
- [ ] Test refreshCredentials invoca provider due volte

**Verification:**
- [ ] `npm test` passa

**Dependencies:** Task 1

**Files likely touched:**
- `tests/aws-auth-manager.test.js` (new)
- `tests/fixtures/aws/sso-cache-valid.json` (new)
- `tests/fixtures/aws/sso-cache-expired.json` (new)

**Estimated scope:** S

---

### Checkpoint: Foundation

- [ ] `npm test` verde su auth manager
- [ ] API auth manager stabile prima del refactor client

---

### Phase 2: Core Integration

---

## Task 3: Refactor `CloudWatchClient` (init async)

**Description:** Rimuovere init async dal costruttore. Pattern:
- costruttore sync (solo config/state);
- `async init(authManager)` crea `CloudWatchLogsClient` con credentials dal manager;
- `async ensureClient()` per refresh client se necessario dopo credential refresh;
- mantenere `fetchLogsPaginated` e gestione errori token esistente.

**Acceptance criteria:**
- [ ] Nessuna chiamata async non awaited nel constructor
- [ ] `init()` completa prima di qualsiasi `send()`
- [ ] Errori token invariati (messaggio italiano)

**Verification:**
- [ ] Test esistenti aggiornati/passano
- [ ] `npm test` verde

**Dependencies:** Task 1

**Files likely touched:**
- `cloudwatch-log-downloader/src/cloudwatch-client.js`
- `tests/cloudwatch-client.test.js` (new o update se assente)

**Estimated scope:** M

---

## Task 4: Integrazione startup in `index.js`

**Description:**
- Istanziare `AwsAuthManager` dopo `loadConfig`;
- `await authManager.authenticate()` prima di `CloudWatchClient`;
- log console/info: account, expiration STS, warning SSO session se imminente;
- avviare `setInterval` / cron per `refreshCredentials()` ogni `credentialRefreshIntervalMinutes`;
- opzionale: se `loginOnStartupIfNeeded`, chiamare login prima di authenticate.

**Acceptance criteria:**
- [ ] AC1–AC4 spec soddisfatti
- [ ] Primo `downloadLogs()` solo dopo auth OK
- [ ] Log autenticazione visibile all'avvio

**Verification:**
- [ ] Avvio manuale `npm run start:prod` con SSO valido
- [ ] Log contiene account e scadenza

**Dependencies:** Task 3

**Files likely touched:**
- `cloudwatch-log-downloader/src/index.js`

**Estimated scope:** M

---

## Task 5: Shutdown e failure path refresh

**Description:** Su SIGINT/SIGTERM clear interval refresh job. Se refresh fallisce: log error, flag `credentialsStale`, download successivo tenta re-auth o fallisce con messaggio chiaro.

**Acceptance criteria:**
- [ ] AC6–AC7 spec (shutdown + failure visibile)
- [ ] Nessun interval orphan dopo stop

**Verification:**
- [ ] Ctrl+C durante refresh job → stop pulito
- [ ] Simulazione provider fail → log error

**Dependencies:** Task 4

**Files likely touched:**
- `cloudwatch-log-downloader/src/index.js`
- `cloudwatch-log-downloader/src/aws-auth-manager.js`

**Estimated scope:** S

---

### Checkpoint: Core Features

- [ ] Avvio end-to-end con auth + download
- [ ] `npm test` verde
- [ ] Review umana prima di docs finali

---

### Phase 3: Config, Docs, Polish

---

## Task 6: Config e normalizzazione

**Description:** Estendere `config.sample.json`, `config.prod.json`/`uat` (locali), aggiungere `normalizeAwsConfig()` (simile a monitor-config) con default 55/30/false.

**Acceptance criteria:**
- [ ] AC9 — campi documentati in sample
- [ ] Valori default applicati se assenti
- [ ] `0` e negativi gestiti (fallback default)

**Verification:**
- [ ] Test normalize config
- [ ] `npm test` verde

**Dependencies:** Task 4

**Files likely touched:**
- `cloudwatch-log-downloader/config.sample.json`
- `cloudwatch-log-downloader/src/aws-config.js` (new, optional)
- `tests/aws-config.test.js` (new)
- `cloudwatch-log-downloader/src/index.js`

**Estimated scope:** S

---

## Task 7: Script npm e documentazione

**Description:**
- `npm run check-sso-expiry` (opzionale, legge scadenza SSO);
- aggiornare `README.md`, `QUICK_START.md`, `docs/RUNBOOK-aws-sso-session.md`;
- aggiornare ADR-004 status → accepted con decisione refresh proattivo.

**Acceptance criteria:**
- [ ] AC11 — docs coerenti con comportamento implementato
- [ ] Runbook errore token + flusso avvio documentato

**Verification:**
- [ ] Review doc paths
- [ ] Comandi in doc eseguibili

**Dependencies:** Task 5, Task 6

**Files likely touched:**
- `cloudwatch-log-downloader/package.json`
- `cloudwatch-log-downloader/scripts/check-sso-expiry.js` (new)
- `cloudwatch-log-downloader/README.md`
- `cloudwatch-log-downloader/QUICK_START.md`
- `docs/RUNBOOK-aws-sso-session.md` (new)
- `docs/ADR-004-aws-sso-session-management.md`
- `docs/spec-general.md` (Q10 → in progress)

**Estimated scope:** M

---

## Task 8: Verifica manuale e checklist release

**Description:** Checklist per validare scenario > 1 h (o simulare con mock timer / expiration corta in test).

**Acceptance criteria:**
- [ ] SC2 — log refresh dopo intervallo
- [ ] Checklist in plan o RUNBOOK compilata

**Verification:**
- [ ] Manuale: avvio → attendere 55 min **oppure** test con interval 1 min in dev
- [ ] `npm test` finale verde

**Dependencies:** Task 7

**Files likely touched:**
- `docs/RUNBOOK-aws-sso-session.md`

**Estimated scope:** XS

---

### Checkpoint: Complete

- [ ] Tutti AC spec (AC1–AC11) verificati
- [ ] `npm test` verde
- [ ] Review umana → `/build`

---

## Parallelization Opportunities

| Parallelizzabile | Sequenziale obbligatorio |
|------------------|--------------------------|
| Task 7 docs (bozza) dopo Task 1 API stabile | Task 3 dipende da Task 1 |
| Fixture test Task 2 mentre si definisce API Task 1 | Task 4 dipende da Task 3 |
| RUNBOOK draft | Task 8 dopo integrazione |

---

## Open Questions (blocker per `/build`)

1. **Q-SSO-6:** `loginOnStartupIfNeeded` default `false` — confermare.
2. **Q-SSO-7:** intervallo **55 min** — confermare.
3. Aggiungere `@aws-sdk/client-sts` esplicito in `package.json` — approvare se non già transitivo.

---

## Stima complessiva

| Phase | Task | Scope |
|-------|------|-------|
| 1 | 1–2 | ~2 sessioni |
| 2 | 3–5 | ~2 sessioni |
| 3 | 6–8 | ~1 sessione |

**Totale:** 8 task, ~5 sessioni agente, ~12–15 file toccati.

## Prossimo passo

Dopo approvazione plan + risposta Q-SSO-6/7 → **`/build`** partendo da Task 1.
