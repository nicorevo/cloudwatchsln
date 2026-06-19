# CloudWatch Log Downloader

**Download AWS CloudWatch logs to local files**, with automatic rolling, exception extraction, and an **Exception Monitor** — a web UI to browse errors and surrounding context.

Built for teams who want to **observe microservices in UAT/prod** without the AWS Console: grep, scripts, offline debugging, or optional AI-assisted pattern tuning on plain-text files.

```
  AWS CloudWatch (logGroups[])
           │
           ▼
  cloudwatch-log-downloader  ──►  ./logs/my-app_2026-06-19_12-00.log
           │                      ./logs/my-app-exceptions_2026-06-19_12-00.log
           ▼
  http://127.0.0.1:3847  (exception tree + ±10 line context)
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Scheduled download** | CloudWatch polling with configurable cron |
| **Multi log group** | A `logGroups[]` array — typical on EKS: one path per pod/deployment |
| **Rolling files** | One file per minute (configurable), append within the same minute |
| **Exceptions** | Configurable patterns → dedicated `-exceptions_*.log` files |
| **Retention** | Automatic cleanup; `preserveExceptionPairs` keeps exception/main pairs |
| **AWS SSO** | Auth at startup + STS credential refresh every ~55 min |
| **Exception Monitor** | Local UI + JSON REST API (`/api/v1/...`) |

---

## Quick start

### 1. Prerequisites

- **Node.js 16+**
- **AWS CLI v2** with [IAM Identity Center (SSO)](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html) configured

```bash
cd cloudwatch-log-downloader
npm install
```

### 2. Configuration

Copy the template and customize it:

```bash
cp config.sample.json config.prod.json   # or config.uat.json
```

Local `config.*.json` files **must not be committed** (they are in `.gitignore`). Only `config.sample.json` is kept in the repo.

Essential fields:

```json
{
  "environment": "prod",
  "project": "my-application",
  "aws": {
    "region": "eu-west-1",
    "profile": "my-aws-sso-profile"
  },
  "cloudwatch": {
    "logGroups": [
      "/eks/my-namespace/my-worker-prod",
      "/eks/my-namespace/my-api-prod"
    ],
    "exceptionPatterns": [
      " ERROR ",
      "Exception",
      "Traceback (most recent call last)"
    ]
  },
  "files": {
    "logDirectory": "./logs",
    "filePrefix": "my-app-logs-prod",
    "retentionMinutes": 60,
    "preserveExceptionPairs": true
  }
}
```

| Field | Purpose |
|-------|---------|
| `logGroups[]` | CloudWatch paths to query (preferred on EKS) |
| `exceptionPatterns[]` | Substrings copied into `-exceptions_*` files |
| `filePrefix` | Filename prefix under `./logs/` |
| `monitor.enabled` | Exception UI at `http://127.0.0.1:3847` |

Other useful fields in `config.sample.json`:

| Section | Field | Default | Description |
|---------|-------|---------|-------------|
| `aws` | `credentialRefreshIntervalMinutes` | `55` | Proactive STS credential refresh |
| `aws` | `loginOnStartupIfNeeded` | `false` | Opens SSO browser if session is missing |
| `cloudwatch` | `monitorPatterns` | `[]` | Empty = all lines in the main file |
| `files` | `preserveExceptionPairs` | `true` | Do not delete exception/main pairs |
| `monitor` | `port` | `3847` | Exception Monitor port |
| `schedule` | `downloadInterval` | `*/1 * * * *` | Download cron (Europe/Rome) |

Discover EKS log groups:

```bash
aws logs describe-log-groups --profile YOUR_AWS_PROFILE --log-group-name-prefix "/eks/"
```

### 3. AWS login and start

```bash
aws sso login --profile my-aws-sso-profile
npm run check-sso-expiry:prod    # optional: SSO session expiry
npm run start:prod
```

Expected output:

```
Web console:  http://127.0.0.1:3847/
REST API:     http://127.0.0.1:3847/api/v1
```

Generated files:

```
logs/
├── my-app-logs-prod_2026-06-19_12-00.log
├── my-app-logs-prod-exceptions_2026-06-19_12-00.log
└── ...
```

---

## Configuring exception patterns (optional AI workflow)

The most important step for a new project is populating `exceptionPatterns[]`: strings that, when found in a log line, copy that line into the exceptions file.

### Recommended workflow

1. **Start the downloader** with minimal `exceptionPatterns` (e.g. `" ERROR "`).
2. **Collect logs** for a few minutes in `./logs/`.
3. **Optionally pass application source to an AI assistant** with a prompt like:

   > Analyze this code and produce a list of log patterns for `exceptionPatterns` in a CloudWatch downloader. Include exact ERROR messages, logger prefixes, Python/Java stack traces, and classify by priority P0–P3.

4. **Paste the patterns** into `config.prod.json` → restart the service.
5. **Verify** in `./logs/*-exceptions_*.log` and in the UI on `:3847`.

Generic starter patterns:

```json
"exceptionPatterns": [
  " ERROR ",
  " FATAL ",
  "Exception",
  "Traceback (most recent call last)",
  "Caused by:"
]
```

---

## Exception Monitor

With `monitor.enabled: true` (default in the sample):

| URL | Description |
|-----|-------------|
| `http://127.0.0.1:3847/` | Exception tree + context panel |
| `GET /api/v1/exceptions/tree` | JSON tree: files → exceptions |
| `GET /api/v1/exceptions/:id` | Exception + before/after lines from main file |
| `GET /api/v1/health` | Monitor status |

Disable with: `"monitor": { "enabled": false }`.

---

## npm scripts

| Command | Action |
|---------|--------|
| `npm run start:prod` | Start with `config.prod.json` |
| `npm run start:uat` | Start with `config.uat.json` |
| `npm run check-sso-expiry:prod` | SSO portal session expiry |
| `npm test` | Automated tests |

Initial SSO setup: `cloudwatch-log-downloader/setup-sso.sh`

**SSO session:** STS credentials renew automatically every ~55 min; renew the portal (browser) session with `aws sso login` when it expires.

---

## Architecture

```
cloudwatch-log-downloader/
├── src/
│   ├── index.js                 # Orchestration, cron, auth
│   ├── aws-auth-manager.js      # SSO + STS refresh
│   ├── cloudwatch-client.js     # FilterLogEvents
│   ├── file-manager.js          # Rolling + exceptions + retention
│   └── monitor/                 # HTTP server + exception UI
├── public/                      # Exception Monitor frontend
├── config.sample.json           # Committed template
├── config.prod.json             # Local (gitignored)
└── tests/
```

---

## Troubleshooting

**Expired SSO token**

```bash
aws sso login --profile my-aws-sso-profile
npm run start:prod
```

**0 events downloaded** — check `logGroups[]`, region, and AWS profile in the CloudWatch Console.

**BrokenPipeError during `aws sso login`** — often harmless; verify with `aws sts get-caller-identity --profile ...`.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
