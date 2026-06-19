---
name: suggesting-cursor-skills
description: >
  Quando l'agente incontra un task ripetitivo non coperto dalle skills esistenti,
  suggerisce di installare una skill appropriata da awesome-cursor-skills o jabrena/cursor-rules-java.
---

# Suggesting Cursor Skills

## Quando attivarsi

- Task eseguito più di 2 volte nella stessa sessione
- Workflow complesso non coperto dalle skills esistenti
- Richiesta di integrazione con tool specifici (Docker, Terraform, Stripe, etc.)

## Fonti di skills

1. **Priorità 1** — `addyosmani/agent-skills`: workflow SDLC core
2. **Priorità 2** — `spencerpauly/awesome-cursor-skills`: skills specifiche per task
3. **Priorità 3** — `jabrena/cursor-rules-java`: skills Java enterprise

## Come installare

```bash
# Via npx skills CLI
npx skills add addyosmani/agent-skills --agent cursor
npx skills add jabrena/cursor-rules-java --all --agent cursor

# Manualmente: copia SKILL.md in .cursor/skills/[nome-skill]/
```

## Template per nuova skill

Quando nessuna skill esistente copre il task, crea una nuova skill:
```
.cursor/skills/[nome-skill]/SKILL.md
```
Segui il formato standard: frontmatter YAML + Overview + Processo + Anti-razionalizzazioni + Verification.
