---
title: "ADR-002: Log group EKS nativi vs Container Insights"
status: accepted
date: 2026-06-19
deciders: []
---

# ADR-002: Preferire log group `/eks/...` nativi

## Context

Su cluster **EKS**, i log applicativi possono essere disponibili in due modi:

1. **Log group nativi pod** — path tipo `/eks/{namespace}/{deployment}-{env}`
2. **Container Insights** — path tipo `/aws/containerinsights/{cluster}/application`

Container Insights aggrega tutti i container del cluster; richiede spesso filtri aggiuntivi (`podKeywords`) per isolare un servizio.

## Decision Drivers

- Config esplicita per servizio (un log group = un pod/deployment)
- Meno filtri client-side
- Allineamento al path creato dal logging EKS/Fluent Bit del cluster

## Decision Outcome

**Scelta:** modello **multi log group EKS nativi** via `logGroups[]`.

```json
"logGroups": [
  "/eks/my-namespace/my-worker-prod",
  "/eks/my-namespace/my-api-prod"
]
```

Non usare `podKeywords` quando ogni servizio ha il proprio log group.

## Consequences

### Positive

- Query dirette, config leggibile
- Un file di output aggrega tutti i group configurati
- Disambiguazione container via metadata nel payload (se presente)

### Negative

- Richiede discovery log group per ambiente (Console AWS o CLI)
- Path diversi tra UAT e prod → config separati locali

## Scoperta log group

```bash
aws logs describe-log-groups \
  --profile YOUR_PROFILE \
  --log-group-name-prefix "/eks/" \
  --query 'logGroups[].logGroupName'
```

## References

- [`configuration-guide.md`](./configuration-guide.md)
- [`spec-multi-loggroup-downloader.md`](./spec-multi-loggroup-downloader.md)
