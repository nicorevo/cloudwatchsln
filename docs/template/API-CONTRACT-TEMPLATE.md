---
title: "API Contract Template"
status: draft
---

# API Contract: [Nome API]

> Questo documento è la fonte di verità per il contratto API.
> Il codice deve conformarsi a questo, non il contrario.

## Base URL

`/api/v1`

## Authentication

Bearer token (JWT)

## Endpoints

### GET /resource

**Descrizione**: ...

**Request**:
```http
GET /api/v1/resource
Authorization: Bearer {token}
```

**Response 200**:
```json
{
  "id": "string",
  "name": "string"
}
```

**Error Codes**:
| Code | Meaning |
|------|---------|
| 400  | Bad Request |
| 401  | Unauthorized |
| 404  | Not Found |
| 500  | Internal Server Error |

## Versioning

API versionate via URL path (`/api/v1/`, `/api/v2/`).
