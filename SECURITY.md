# Security Policy

## Segnalazione vulnerabilità

NON aprire issue pubbliche per vulnerabilità di sicurezza.
Contatta il team via canale privato.

## Pratiche obbligatorie

- Nessun secret committato (usa `.gitignore` e variabili d'ambiente)
- Input validation su tutti gli endpoint pubblici
- OWASP Top 10 check ad ogni PR (skill `security-and-hardening`)
- Dependency audit: `mvn dependency-check:check`
- Headers di sicurezza HTTP configurati in Spring Security

## Data Classification

- **PUBLIC**: documentazione, codice sorgente
- **INTERNAL**: configurazioni non-sensitive
- **CONFIDENTIAL**: credenziali, PII, business data
- **RESTRICTED**: chiavi private, segreti di produzione
