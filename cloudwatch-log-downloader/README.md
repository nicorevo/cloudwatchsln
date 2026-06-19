# CloudWatch Log Downloader

Modulo Node.js del progetto. **Homepage e quick start:** [README principale](../README.md).

---

## Installazione

```bash
npm install
cp config.sample.json config.prod.json
```

Modifica `config.prod.json`: `aws.profile`, `cloudwatch.logGroups[]`, `files.filePrefix`, `exceptionPatterns[]`.

Documentazione config: [`../docs/configuration-guide.md`](../docs/configuration-guide.md)

---

## Avvio

```bash
aws sso login --profile YOUR_AWS_PROFILE
npm run check-sso-expiry:prod   # opzionale
npm run start:prod
```

| Env | Comando | Config (gitignored) |
|-----|---------|---------------------|
| prod | `npm run start:prod` | `config.prod.json` |
| uat | `npm run start:uat` | `config.uat.json` |

---

## Output

```
logs/
├── {filePrefix}_2026-06-19_12-00.log
├── {filePrefix}-exceptions_2026-06-19_12-00.log
└── ...
```

Formato riga:

```
[timestamp] [logGroup | container] messaggio
```

---

## Exception Monitor

```
http://127.0.0.1:3847/
```

Disabilitare: `"monitor": { "enabled": false }` in config.

API: [`../docs/API-contract-exception-monitor.md`](../docs/API-contract-exception-monitor.md)

---

## Pattern eccezioni

Guida + workflow AI: [`../docs/exception-patterns-guide.md`](../docs/exception-patterns-guide.md)

---

## Script npm

| Script | Descrizione |
|--------|-------------|
| `npm run start:prod` / `start:uat` | Avvio downloader |
| `npm run check-sso-expiry:prod` | Scadenza sessione SSO |
| `npm test` | Test automatizzati |

Setup SSO: `./setup-sso.sh`

---

## Troubleshooting

**Token SSO scaduto**

```bash
aws sso login --profile YOUR_AWS_PROFILE
```

**0 eventi** — verificare `logGroups[]`, regione, permessi IAM (`logs:FilterLogEvents`).

**Debug downloader**

```json
{ "logging": { "level": "debug" } }
```

SSO dettagli: [`../docs/spec-aws-sso-session.md`](../docs/spec-aws-sso-session.md)

---

## Licenza

MIT
