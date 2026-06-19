---
title: "ADR-001: Pipeline log applicazione → CloudWatch → downloader locale"
status: accepted
date: 2026-06-18
deciders: []
---

# ADR-001: Pipeline di osservabilità log offline

## Context

I microservizi scrivono log su **AWS CloudWatch**. Per debug e analisi offline serve un flusso ripetibile verso file locali, senza dipendere dalla console AWS.

## Decision Outcome

**Scelta:** architettura a due livelli logici:

1. **Applicazione** (qualsiasi stack) → emette log su CloudWatch via infrastruttura cloud (EKS, Lambda, …)
2. **cloudwatch-log-downloader** (Node.js locale) → polling, file rolling, eccezioni, UI monitor

Il downloader è **agnostico** rispetto all'applicazione: tutto è configurazione (`logGroups[]`, `exceptionPatterns[]`, `filePrefix`).

## Consequences

### Positive

- Tool riusabile per più progetti
- Nessun accoppiamento codice app ↔ downloader
- Analisi offline (grep, LLM, IDE)

### Negative

- Config manuale per ogni nuovo servizio
- Sessione AWS SSO richiesta sul laptop developer

## References

- [`spec-general.md`](./spec-general.md)
- [`exception-patterns-guide.md`](./exception-patterns-guide.md)
