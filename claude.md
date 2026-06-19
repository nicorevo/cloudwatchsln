# CloudWatch Log Downloader — project context

Workspace per **monitorare log di microservizi** estraendoli da AWS CloudWatch in file locali.

**Homepage:** [`README.md`](README.md)  
**Spec:** [`docs/spec-general.md`](docs/spec-general.md)  
**Config:** [`docs/configuration-guide.md`](docs/configuration-guide.md)  
**Pattern eccezioni:** [`docs/exception-patterns-guide.md`](docs/exception-patterns-guide.md)

---

## Componente principale

| Componente | Path | Ruolo |
|------------|------|-------|
| **cloudwatch-log-downloader** | `cloudwatch-log-downloader/` | CloudWatch → `./logs/*.log` + Exception Monitor |

```
Applicazione (EKS / Lambda / …) ──► CloudWatch logGroups[]
                                          │
cloudwatch-log-downloader ◄───────────────┘
         │
         ├── {filePrefix}_*.log
         ├── {filePrefix}-exceptions_*.log
         └── http://127.0.0.1:3847 (UI)
```

---

## Configurazione

| Env | File (gitignored) | Comando |
|-----|-------------------|---------|
| prod | `config.prod.json` | `npm run start:prod` |
| uat | `config.uat.json` | `npm run start:uat` |

Template committato: `cloudwatch-log-downloader/config.sample.json`

---

## Comandi utili

```bash
cd cloudwatch-log-downloader
npm install
cp config.sample.json config.prod.json
aws sso login --profile YOUR_AWS_PROFILE
npm test
npm run start:prod
```

---

## Documentazione

| Doc | Contenuto |
|-----|-----------|
| `docs/spec-general.md` | Architettura e scope |
| `docs/exception-patterns-guide.md` | Pattern + workflow AI |
| `docs/spec-aws-sso-session.md` | SSO e refresh STS |
| `docs/spec-exception-monitor-ui.md` | UI eccezioni |
| `docs/NEXT-STEPS.md` | Roadmap |

Workflow SDLC: `AGENTS.md`
