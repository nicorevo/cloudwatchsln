---
name: java-development
description: >
  Java 21+ enterprise development con Maven, Spring Boot 3, OpenAPI-first,
  TDD con JUnit 5/Mockito/AssertJ, Testcontainers, WireMock.
  Attivata su qualsiasi file .java o modifica a pom.xml.
---

# Java Development Skill

## Stack

- **Runtime**: Java 21+ (record, sealed classes, pattern matching)
- **Build**: Maven 3.9+
- **Framework**: Spring Boot 3.x
- **Testing**: JUnit 5, AssertJ, Mockito, Testcontainers, WireMock
- **API**: OpenAPI 3.x (contract-first)
- **Observability**: Spring Actuator, Micrometer

## Workflow

1. Leggi la spec in `docs/` prima di scrivere codice
2. Scrivi il test prima dell'implementazione (TDD)
3. Implementa il minimo per far passare il test
4. Refactora mantenendo i test verdi
5. Valida il contratto OpenAPI con `spec-compliance` CI gate

## Struttura package consigliata

```
src/main/java/com/yourcompany/yourapp/
├── domain/          # Logica di business pura
├── application/     # Use cases / services
├── infrastructure/  # Repository, client esterni
└── presentation/    # Controller REST, DTOs
```

## Maven: comandi utili

```bash
mvn clean verify          # Build + tutti i test
mvn test -Dtest=MyTest    # Singolo test
mvn dependency-check:check # Security audit dipendenze
mvn spring-boot:run       # Avvio locale
```

## Anti-razionalizzazioni

| Scusa | Rebuttal |
|---|---|
| "Uso Gradle è più veloce" | Maven è lo standard di progetto, garantisce build riproducibili |
| "I test di integrazione sono lenti" | Testcontainers con reuse=true: <5s startup |
