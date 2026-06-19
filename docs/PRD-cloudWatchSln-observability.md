---
title: "PRD — CloudWatch Log Downloader"
status: accepted
created: 2026-06-18
---

# PRD: CloudWatch Log Downloader

## Objective

Fornire un tool locale che scarica log da AWS CloudWatch in file testuali, estrae eccezioni configurabili e offre una UI per navigare errori con contesto.

## User Stories

```
AS A developer / SRE
I WANT TO download CloudWatch logs to local rolling files
SO THAT I can grep, debug and analyze without the AWS Console
```

```
AS A developer
I WANT TO configure exception patterns for my application
SO THAT errors are isolated in dedicated files and a local web UI
```

## Acceptance Criteria

- [x] Multi log group via `logGroups[]`
- [x] File rolling + eccezioni + retention
- [x] AWS SSO con refresh credenziali STS
- [x] Exception Monitor UI + API REST
- [x] `config.sample.json` template pubblico
- [x] Documentazione configurazione + workflow AI pattern

## Out of Scope

- Hosting cloud del downloader
- Modifica applicazioni monitorate
- IAM Identity Center administration

## References

- [`spec-general.md`](./spec-general.md)
- [`configuration-guide.md`](./configuration-guide.md)
