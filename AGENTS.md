# AGENTS.md — Istruzioni per AI Coding Agents

Questo file guida agenti come Cursor, Claude Code e Copilot nel workflow SDLC per **CloudWatch Log Downloader**.

## Contesto progetto

Leggi **`claude.md`** e **`README.md`**. Stato e roadmap: **`docs/NEXT-STEPS.md`**.

| Path | Ruolo |
|------|-------|
| `cloudwatch-log-downloader/` | App Node.js: CloudWatch → file locali + Exception Monitor |

### Stato implementato

- Multi log group (`logGroups[]`)
- Eccezioni (`exceptionPatterns[]`) + `preserveExceptionPairs`
- AWS SSO: auth all'avvio + refresh STS ogni 55 min
- Exception Monitor UI + API REST
- Test automatizzati (`npm test`)

## Workflow obbligatorio

1. **SEMPRE** inizia con `/spec` per nuove feature
2. **SEMPRE** scrivi test prima del codice quando modifichi logica (TDD)
3. **SEMPRE** esegui `/review` prima di proporre un merge
4. **MAI** committare codice senza tag `ai-generated` + review umana

## Comandi SDLC

| Fase | Comando | Skill di riferimento |
|------|---------|----------------------|
| Define | `/spec` | `spec-driven-development` |
| Plan | `/plan` | `planning-and-task-breakdown` |
| Build | `/build` | `incremental-implementation`, `test-driven-development` |
| Verify | `/test` | `test-driven-development` |
| Review | `/review` | `code-review-and-quality`, `security-and-hardening` |
| Simplify | `/code-simplify` | `code-simplification` |
| Ship | `/ship` | `shipping-and-launch` |

## Regole di comportamento

- Lavorare da `cloudwatch-log-downloader/` per `npm` e config AWS
- **Non committare** `config.uat.json` né `config.prod.json`; usare `config.sample.json`
- **Non committare** account AWS, log group o nomi ambiente reali in `docs/`
- Messaggi log del downloader in **italiano**
- Aggiornare `docs/NEXT-STEPS.md` su milestone completate

## Documentazione da consultare

| Task | Documento |
|------|-----------|
| Architettura | `docs/spec-general.md` |
| Configurazione | `docs/configuration-guide.md` |
| Pattern eccezioni + AI | `docs/exception-patterns-guide.md` |
| Exception Monitor | `docs/spec-exception-monitor-ui.md` |
| SSO | `docs/spec-aws-sso-session.md` |
| Roadmap | `docs/NEXT-STEPS.md` |

## Tracciabilità AI

Tag obbligatorio nei commit generati da agenti: `ai-generated` — review umana prima del merge.
