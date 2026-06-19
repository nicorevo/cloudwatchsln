---
title: "CloudWatch Log Downloader — Roadmap"
status: living
updated: 2026-06-19
---

# Roadmap e stato progetto

Documento per developer e contributor: cosa è implementato, cosa resta da fare.

---

## Completato

| Area | Dettaglio |
|------|-----------|
| **Multi log group** | `logGroups[]` — un path CloudWatch per query |
| **File rolling** | Un file al minuto, append nello stesso minuto |
| **Eccezioni** | `exceptionPatterns[]` → file `-exceptions_*` |
| **Retention** | Cleanup configurabile + `preserveExceptionPairs` |
| **AWS SSO** | Auth all'avvio, refresh STS ogni 55 min |
| **Exception Monitor** | UI + API REST JSON su `:3847` |
| **Test** | Suite `npm test` (auth, monitor, file utils) |
| **Documentazione** | README, guide config, pattern eccezioni, SSO |

---

## Prossimi passi (priorità suggerita)

### P1 — Integrazione LLM su API eccezioni

Usare `GET /api/v1/exceptions/:id` per analisi automatica post-download (JSON strutturato con contesto ±10 righe).

### P2 — Runbook operativo SSO

Completare `docs/RUNBOOK-aws-sso-session.md` con playbook scadenza sessione portal.

### P3 — Ricomposizione stack trace multilinea

Migliorare matching riga eccezione ↔ file main quando stack trace su più righe.

### P4 — Test E2E browser

Automatizzare flusso Exception Monitor (Playwright o simile).

---

## Verifica rapida

```bash
cd cloudwatch-log-downloader
cp config.sample.json config.prod.json   # se non esiste
aws sso login --profile YOUR_AWS_PROFILE
npm test
npm run start:prod
# → ./logs/ + http://127.0.0.1:3847
```

---

## Riferimenti

- [`spec-general.md`](./spec-general.md)
- [`exception-patterns-guide.md`](./exception-patterns-guide.md)
- [`spec-exception-monitor-ui.md`](./spec-exception-monitor-ui.md)
- [`plan-aws-sso-session.md`](./plan-aws-sso-session.md)
