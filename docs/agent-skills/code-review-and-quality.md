---
name: code-review-and-quality
description: >
  Review a 5 assi, dimensione PR ~100 righe, severity labels, splitting strategies.
  Usa prima di mergiare qualsiasi cambiamento.
---

# Code Review and Quality

## 5 Assi di Review

1. **Correttezza** — Il codice fa quello che dice? I casi limite sono gestiti?
2. **Manutenibilità** — Un nuovo dev può capirlo? Rispetta le convenzioni?
3. **Performance** — Ci sono O(n²) nascosti? Query N+1?
4. **Sicurezza** — Input validato? Nessun secret esposto? OWASP Top 10?
5. **Test** — Coverage adeguato? I test sono significativi?

## Severity Labels

- `[Nit]` — Preferenza stilistica, non bloccante
- `[Optional]` — Miglioramento suggerito, non bloccante
- `[FYI]` — Informativo, nessuna azione richiesta
- `[Required]` — **Bloccante**, deve essere risolto prima del merge

## Dimensionamento PR

- Ideale: ~100 righe di codice significativo
- Max: 400 righe (split obbligatorio oltre)
- Mai mixare refactoring e nuove feature nella stessa PR

## Checklist rapida

- [ ] I test passano?
- [ ] La PR ha dimensione adeguata?
- [ ] Non ci sono secret esposti?
- [ ] La logica complessa è documentata?
- [ ] Le ADR sono aggiornate?
