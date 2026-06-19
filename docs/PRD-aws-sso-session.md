---
title: "Sessione AWS SSO — Product Requirements Document"
status: draft
created: 2026-06-19
updated: 2026-06-19
author: ""
ai-assisted: true
human-reviewed: false
---

# PRD: Autenticazione AWS all'avvio e refresh orario

## Objective

Implementare nel `cloudwatch-log-downloader` autenticazione **esplicita all'avvio** e **rinnovo automatico** delle credenziali AWS ogni ~1 ora, così il servizio resta operativo durante sessioni di monitoraggio prolungate senza intervento manuale sulle credenziali STS.

## Problem Statement

Oggi:

- l'autenticazione è implicita e il client async nel costruttore può creare race all'avvio;
- il refresh STS è solo lazy (su richiesta SDK), non visibile nei log;
- l'utente non sa se il token è valido finché non fallisce un download;
- alla scadenza SSO portal il messaggio d'errore compare tardi.

## Success Metrics

- [ ] **100%** degli avvii con SSO valido completano autenticazione prima del primo download.
- [ ] **0** download avviati con client non inizializzato (fix race).
- [ ] Log di refresh credenziali visibile almeno ogni ~1 h di uptime.
- [ ] **0** access key statiche introdotte.

## User Stories

```
AS A developer
I WANT TO autenticazione automatica all'avvio del downloader
SO THAT so subito se posso operare senza passi manuali extra
```

```
AS A developer con il servizio attivo per ore
I WANT TO rinnovo automatico delle credenziali ogni ora
SO THAT i job CloudWatch non si fermano per scadenza STS
```

```
AS A developer con sessione SSO scaduta
I WANT TO un messaggio chiaro all'avvio con il comando di login
SO THAT ripristino l'accesso in un solo passo
```

## Acceptance Criteria

- [ ] **AC1** — `authenticate()` all'avvio: credenziali + verifica identità AWS.
- [ ] **AC2** — Log: profilo, account, scadenza credenziali STS.
- [ ] **AC3** — Fail-fast con hint `aws sso login` se SSO non valido.
- [ ] **AC4** — Refresh job ogni `credentialRefreshIntervalMinutes` (default 55).
- [ ] **AC5** — Log info ad ogni refresh riuscito con nuova scadenza.
- [ ] **AC6** — Shutdown pulito del refresh job.
- [ ] **AC7** — Config documentata in `config.sample.json`.
- [ ] **AC8** — Test unitari `aws-auth-manager` + suite verde.

## Out of Scope

- Rinnovo illimitato sessione SSO portal senza browser.
- Access key IAM permanenti.
- Deploy unattended multi-giorno senza re-login SSO.

## Technical Constraints

- Node.js, AWS SDK v3, `fromSSO({ profile })`.
- Profili AWS da `config.*.json` → `aws.profile` (locali, gitignored).
- Messaggi in italiano.

## Open Questions

- Default `loginOnStartupIfNeeded`: false o true? → vedi Q-SSO-6 in spec.
- Intervallo 55 vs 60 minuti? → vedi Q-SSO-7.

## ADR References

- [ADR-004-aws-sso-session-management.md](./ADR-004-aws-sso-session-management.md) — da aggiornare post-implementazione

## Related Documents

- [spec-aws-sso-session.md](./spec-aws-sso-session.md)
- [plan-aws-sso-session.md](./plan-aws-sso-session.md)
