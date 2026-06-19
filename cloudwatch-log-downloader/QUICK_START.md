# Quick Start

Guida operativa rapida. Panoramica completa: [README principale](../README.md).

---

## 1. Installazione

```bash
cd cloudwatch-log-downloader
npm install
cp config.sample.json config.prod.json
```

Edita `config.prod.json` — minimo: `aws.profile`, `cloudwatch.logGroups[]`, `files.filePrefix`.

---

## 2. AWS SSO

```bash
aws sso login --profile YOUR_AWS_PROFILE
npm run check-sso-expiry:prod
```

Prima configurazione SSO: `./setup-sso.sh`

---

## 3. Avvio

```bash
npm run start:prod
```

Log attesi:

- `Autenticazione AWS completata`
- `Refresh credenziali AWS programmato`
- `Console web: http://127.0.0.1:3847/`

---

## 4. Log locali

```
logs/
├── my-app-logs-prod_2026-06-19_12-00.log
└── my-app-logs-prod-exceptions_2026-06-19_12-00.log
```

- Nuovo file ogni minuto (default cron)
- Coppie eccezione/main conservate con `preserveExceptionPairs: true`

---

## 5. Configurare eccezioni (con AI)

1. Avvia con pattern minimi (`" ERROR "`).
2. Passa il **sorgente della tua app** a un AI con il prompt in [`../docs/exception-patterns-guide.md`](../docs/exception-patterns-guide.md).
3. Incolla i pattern in `exceptionPatterns[]` → riavvia.
4. Verifica in `./logs/*-exceptions_*.log` e UI `:3847`.

---

## 6. Analisi rapida

```bash
ls -lt logs/*exceptions*.log | head -5
grep " ERROR " logs/*exceptions*.log | tail -20
```

---

## 7. Test

```bash
npm test
```

---

## 8. Rinnovo sessione SSO

La sessione **portal** (browser) scade dopo ore (policy IT). Le credenziali STS si rinnovano da sole ogni ~55 min finché la sessione portal è valida.

```bash
aws sso login --profile YOUR_AWS_PROFILE
```

Dettaglio: [`../docs/spec-aws-sso-session.md`](../docs/spec-aws-sso-session.md)
