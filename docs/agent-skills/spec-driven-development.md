---
name: spec-driven-development 
description: >
  Scrivi un PRD completo (obiettivi, comandi, struttura, stile, testing, boundary)
  prima di qualsiasi codice. Usa quando si inizia un progetto, feature, o cambiamento significativo.
---

# Spec-Driven Development

## Overview

La spec è la fonte di verità. Il codice implementa la spec, non il contrario.

## Processo

1. **Interview** — Usa `interview-me` se il requisito è vago
2. **PRD** — Compila `docs/template/PRD-TEMPLATE.md` e copia il documento compilato nella cartella  `docs/`
3. **API Contract** — Se c'è un'API, compila `docs/template/API-CONTRACT-TEMPLATE.md` prima del codice e utilizza il template `docs/standard/openapi-example.yaml` per un nuovo file con la definizione delle api e copia il documento compilato nella cartella  `docs/`
4. **ADR** — Documenta le decisioni architetturali significative in `docs/template/ADR-TEMPLATE.md` e copia il documento compilato nella cartella  `docs/`
5. **Review spec** — Fai revisionare la spec da un umano prima di procedere

## Anti-razionalizzazioni

| Scusa | Rebuttal |
|---|---|
| "È una feature piccola, non serve la spec" | Anche le feature piccole cambiano scope. 15 minuti di spec risparmiano ore di rework. |
| "La spec la scrivo dopo" | Senza spec non hai exit criteria. Come sai quando hai finito? |

## Verification

- [ ] PRD compilato e revisionato da un umano
- [ ] Acceptance criteria chiari e testabili
- [ ] API contract scritto (se applicabile)
- [ ] ADR creata per decisioni architetturali
