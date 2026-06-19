---
title: "ADR-004: Gestione sessione AWS SSO per il downloader locale"
status: proposed # proposed | accepted | deprecated | superseded — → accepted post /build
date: 2026-06-19
deciders: []
---

# ADR-004: Gestione sessione AWS SSO per il downloader locale

## Context

`cloudwatch-log-downloader` accede a CloudWatch Logs con profili AWS SSO configurati in `config.*.json`. L'utente deve eseguire `aws sso login` periodicamente.

1. Quanto dura il token?
2. È possibile renderlo persistente?

Il downloader usa già `fromSSO()` che refresha le credenziali STS temporanee finché la **sessione SSO** (portal login) è valida. I token SSO sono cacheati in `~/.aws/sso/cache/` con campo `expiresAt`.

## Decision Drivers

- Sicurezza: niente access key long-lived su laptop developer.
- Semplicità: riusare AWS CLI ufficiale, non reinventare OAuth.
- UX: ridurre surprise su scadenza sessione.
- Scope: tool locale developer, non servizio always-on in cloud.

## Considered Options

1. **Status quo + documentazione** — SSO manuale, SDK refresh, messaggio errore esistente.
2. **Status quo + script check scadenza** — opzione 1 + `check-sso-expiry` e warning startup.
3. **Access key IAM statiche in `.env`** — persistenza massima, anti-pattern security.
4. **IAM role su EC2/ECS** — per workload 24/7, non per dev locale.

## Decision Outcome

**Scelta aggiornata (2026-06-19): Opzione 2 estesa** — `AwsAuthManager` con autenticazione esplicita all'avvio + refresh proattivo credenziali STS ogni ~55 minuti; documentazione e runbook.

**Perché:**

- La “persistenza” richiesta dall'utente riguarda le **credenziali STS (~1 h)**, rinnovabili automaticamente via `fromSSO()` finché la sessione SSO portal è valida.
- Refresh **proattivo** (non solo lazy SDK) rende visibile il rinnovo nei log e riduce failure ai confini dell'ora.
- Autenticazione all'avvio elimina la race async attuale in `CloudWatchClient` e fail-fast con messaggio chiaro.
- La sessione SSO portal **non** si auto-rinnova oltre `expiresAt` — comportamento voluto da AWS; serve `aws sso login` o flag opzionale `loginOnStartupIfNeeded`.

## Consequences

### Positive

- Modello mentale chiaro per gli sviluppatori.
- Meno login ridondanti (solo quando sessione SSO scade).
- Allineamento con AWS best practice (SSO + temporary credentials).

### Negative

- Sessione SSO scade comunque (tipicamente ore, non giorni) — serve re-login periodico.
- Script scadenza dipende da formato cache AWS CLI (può cambiare tra versioni CLI).
- Esecuzione multi-giorno unattended resta problematica senza IAM role dedicato.

## Pros and Cons of the Options

### Opzione 1 — Solo documentazione

- Pro: zero codice, zero manutenzione.
- Con: scadenza ancora “invisibile” fino all’errore.

### Opzione 2 — Documentazione + check scadenza

- Pro: visibilità proattiva, basso rischio.
- Con: script bash/Node da mantenere; path cache SSO multi-file.

### Opzione 3 — Access key statiche

- Pro: nessun browser login.
- Con: viola security policy; rotazione manuale; leak risk.

### Opzione 4 — IAM role cloud

- Pro: ideale per produzione always-on.
- Con: fuori scope dev locale; richiede infra Revo.

## Note operative

| Token | Durata tipica | Persistenza disco | Refresh automatico |
|-------|---------------|-------------------|--------------------|
| Sessione SSO (`aws sso login`) | 1–12 h (policy IT) | Sì, `~/.aws/sso/cache/` | No — richiede re-login |
| Credenziali ruolo STS | ~1 h | Sì, `~/.aws/cli/cache/` | Sì, via `fromSSO()` |

Comando re-login standard:

```bash
aws sso login --profile YOUR_AWS_PROFILE
```

## References

- [`spec-aws-sso-session.md`](./spec-aws-sso-session.md)
- [`PRD-aws-sso-session.md`](./PRD-aws-sso-session.md)
- AWS: [Configure SSO CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
