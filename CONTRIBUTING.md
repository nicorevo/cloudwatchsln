# Come Contribuire

## Prerequisiti
- Java 21+, Maven 3.9+
- Pre-commit hooks installati: `pip install pre-commit && pre-commit install`
- Cursor con skills caricate da `.cursor/skills/`

## Flusso di contribuzione

1. Crea un issue con il template `ai-feature-request.md`
2. Crea un branch: `feature/ISSUE-ID-descrizione`
3. Usa `/spec` per scrivere la specifica prima di qualsiasi codice
4. Sviluppa seguendo TDD (red → green → refactor)
5. Esegui `/review` e correggi i feedback
6. Apri una PR con il template fornito
7. Attendi review umana obbligatoria

## Standard di commit

Usa Conventional Commits:
- `feat(scope): descrizione`
- `fix(scope): descrizione`
- `test(scope): descrizione`
- `docs(scope): descrizione`
- `refactor(scope): descrizione`
