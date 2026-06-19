---
name: using-agent-skills
description: >
  Meta-skill. Mappa il lavoro in arrivo alla skill corretta del workflow SDLC.
  Usare all'inizio di ogni sessione o quando si decide quale skill applicare.
---

# Using Agent Skills

## Quando usare quale skill

| Stai facendo... | Usa questa skill |
|---|---|
| Definire una nuova feature | `spec-driven-development` |
| Scrivere o modificare logica | `test-driven-development` |
| Revisionare prima del merge | `code-review-and-quality` |
| Lavorare su auth/input/storage | `security-and-hardening` |
| Committare codice | `git-workflow-and-versioning` |
| Sviluppare in Java/Spring | `java-development` |
| Trovare skills per task ripetitivi | `suggesting-cursor-skills` |

## Regole operative

1. Non generare codice senza una spec approvata
2. Non fare merge senza review umana
3. Non saltare i test: sono la prova che il codice funziona
4. Dimensione ideale PR: ~100 righe significative
5. Ogni sessione inizia con la lettura di `AGENTS.md`

## Comandi rapidi

- `/spec` → Define what to build
- `/plan` → Break it into tasks
- `/build` → Implement incrementally
- `/test` → Prove it works
- `/review` → Quality gate
- `/ship` → Deploy safely
