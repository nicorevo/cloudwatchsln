---
title: "Spec: multi log group (1 log group = 1 pod)"
status: implemented
created: 2026-06-19
---

# Spec: downloader multi log group

## Decisione

**Un log group CloudWatch = un pod/deployment.** Elencare i path in `logGroups[]`. Non serve `podKeywords` quando ogni servizio ha un log group dedicato.

Esempio generico EKS:

```
/eks/my-namespace/my-worker-prod     → pod worker
/eks/my-namespace/my-services-prod → pod con più container (disambiguazione via container_name nel payload)
```

---

## Config

```json
"cloudwatch": {
  "logGroups": [
    "/eks/my-namespace/my-worker-prod",
    "/eks/my-namespace/my-services-prod"
  ],
  "monitorPatterns": [],
  "exceptionPatterns": [" ERROR ", "Exception"]
}
```

| Campo | Comportamento |
|-------|---------------|
| `logGroups[]` | Ogni group interrogato in sequenza; eventi concatenati e ordinati per timestamp |
| `monitorPatterns: []` | Tutte le righe nel file main |
| `logGroupName` + `podKeywords` | **Legacy** — evitare per nuove config |

---

## Output

Un solo `filePrefix` per run:

```
logs/my-app-logs-prod_2026-06-19_12-00.log
logs/my-app-exceptions_2026-06-19_12-00.log
```

Ogni riga include il log group sorgente:

```
[timestamp] [/eks/my-namespace/my-worker-prod | container-name] messaggio
```

---

## Verifica

1. `aws logs describe-log-groups --log-group-name-prefix "/eks/"`
2. Configurare 1–2 group in `config.prod.json`
3. `npm run start:prod` → eventi > 0 in `./logs/`

---

## Riferimenti

- [`ADR-002-eks-native-log-groups.md`](./ADR-002-eks-native-log-groups.md)
- [`configuration-guide.md`](./configuration-guide.md)
