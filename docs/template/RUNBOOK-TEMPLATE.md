---
title: "Runbook: [Nome Servizio]"
version: 1.0
last-updated: YYYY-MM-DD
---

# Runbook: [Nome Servizio]

## Prerequisiti

- Accesso a [sistema]
- Credenziali per [env]

## Deploy

```bash
# Build
mvn clean package -DskipTests

# Deploy staging
./scripts/deploy.sh staging

# Deploy production (richiede approvazione)
./scripts/deploy.sh production
```

## Health Check

```bash
curl https://[host]/actuator/health
```

## Rollback

```bash
# Rollback all'ultima versione stabile
./scripts/rollback.sh [version]
```

## Alert Playbook

| Alert | Causa probabile | Azione |
|---|---|---|
| High CPU | Loop infinito / memoria | Restart + analisi heap dump |
| 5xx spike | Bug deploy | Rollback immediato |
| DB timeout | Query lenta | `EXPLAIN ANALYZE` + indice |

## Escalation

1. On-call engineer
2. Tech Lead
3. CTO
