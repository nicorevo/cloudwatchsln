---
name: security-and-hardening
description: >
  OWASP Top 10, auth patterns, secrets management, dependency auditing.
  Attivata automaticamente su input utente, auth, data storage, integrazioni esterne.
---

# Security and Hardening

## OWASP Top 10 — Checklist Java/Spring

- [ ] A01 Broken Access Control → Spring Security con least-privilege
- [ ] A02 Cryptographic Failures → No plain-text secrets, HTTPS always
- [ ] A03 Injection → Prepared statements, no string concatenation in queries
- [ ] A04 Insecure Design → Threat modeling in PRD
- [ ] A05 Security Misconfiguration → Headers HTTP configurati, actuator protetto
- [ ] A06 Vulnerable Components → `mvn dependency-check:check`
- [ ] A07 Auth Failures → JWT con expiry breve, refresh token rotation
- [ ] A08 Software Integrity → Verifica dipendenze con checksum
- [ ] A09 Logging Failures → No PII nei log, audit trail
- [ ] A10 SSRF → Whitelist URL esterne

## Secrets Management

```java
// ❌ MAI
String apiKey = "sk-1234abcd";

// ✅ SEMPRE
@Value("${external.api.key}")
private String apiKey;
```

## Input Validation (Spring)

```java
@Valid @RequestBody CreateUserRequest request
// + Bean Validation annotations sul DTO
```
