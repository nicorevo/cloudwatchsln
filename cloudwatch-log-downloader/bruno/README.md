# CloudWatch Log Downloader Bruno Collection

Aprire questa cartella con Bruno:

```bash
bruno cloudwatch-log-downloader/bruno
```

Variabili principali nell'ambiente `Local`:

| Variabile | Default | Uso |
|-----------|---------|-----|
| `baseUrl` | `http://127.0.0.1:3847` | Base URL del monitor |
| `project` | `my-app` | Slug progetto configurato in `cloudwatch[].project` |
| `exceptionId` | `fixture:1` | ID eccezione restituito dal tree |
| `limit` | `200` | Limite righe/file; valori tail validi: `20..1000` |
| `cursor` | vuoto | Cursor restituito dalla chiamata tail iniziale |

La collection copre API REST e frontend web esposti dal monitor.
