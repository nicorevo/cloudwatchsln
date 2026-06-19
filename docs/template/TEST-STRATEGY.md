---
title: "Test Strategy — AI-Augmented"
---

# Test Strategy

## Piramide dei Test

```
         /\
        /E2E\        5%  — Playwright / Selenium
       /------\
      / Integr. \   15%  — Spring Boot Test, WireMock
     /------------\
    /   Unit Tests  \ 80%  — JUnit 5, Mockito, AssertJ
   /________________\
```

## Principi

- **Beyoncé Rule**: se non è testato, non esiste
- **DAMP over DRY**: i test devono essere leggibili autonomamente
- **Red-Green-Refactor**: TDD obbligatorio per logica di business

## Tool Stack Java

| Livello      | Tool                              |
|---|---|
| Unit         | JUnit 5, Mockito, AssertJ         |
| Integration  | Spring Boot Test, Testcontainers  |
| E2E          | Playwright / REST-assured         |
| Performance  | JMeter, JMH                       |
| Contract     | WireMock, OpenAPI validator       |

## AI-Augmented Testing

- Usa la skill `test-driven-development` per generare test suite
- Verifica sempre che i test falliscano PRIMA dell'implementazione
- Tag obbligatorio: `// ai-generated-test: human-reviewed: yes/no`
