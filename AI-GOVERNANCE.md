# AI Governance

## Principi

1. **Human in the loop**: ogni output AI deve essere revisionato da un umano prima del merge
2. **Tracciabilità**: tutto il codice AI-generated deve essere marcato
3. **Data classification**: non inviare dati CONFIDENTIAL/RESTRICTED ai modelli AI
4. **Audit trail**: ogni sessione AI significativa va documentata

## Routing modelli

| Tipo di task | Modello consigliato |
|---|---|
| Generazione codice | Claude Sonnet / GPT-4o |
| Review sicurezza | Claude Opus |
| Documentazione | Claude Haiku / GPT-4o-mini |
| Analisi architetturale | Claude Opus |

## Limiti

- Non inviare PII, segreti, o dati di produzione ai modelli AI
- Non usare output AI non-revisionati in produzione
- Mantenere log delle interazioni significative con gli agenti
