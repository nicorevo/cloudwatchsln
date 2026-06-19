---
name: test-driven-development
description: >
  Red-Green-Refactor. Test pyramid (80/15/5). DAMP over DRY. Beyoncé Rule.
  Usa per implementare logica, fixare bug, o cambiare comportamento.
---

# Test-Driven Development

## Ciclo TDD

```
RED   → Scrivi un test che fallisce
GREEN → Scrivi il codice minimo per farlo passare
REFACTOR → Migliora il codice senza rompere i test
```

## Piramide dei test Java

```
5%  E2E         — Playwright, REST-assured
15% Integration — Spring Boot Test, Testcontainers, WireMock
80% Unit        — JUnit 5, Mockito, AssertJ
```

## Regole

- **Beyoncé Rule**: se non è testato, non esiste
- **DAMP over DRY**: i test devono essere auto-esplicativi
- Un test per comportamento, non per metodo
- Nomi test: `should[Behavior]When[Condition]`

## Template test Java

```java
@Test
void shouldReturnEmptyWhenUserNotFound() {
    // Arrange
    var userId = UUID.randomUUID();

    // Act
    var result = userService.findById(userId);

    // Assert
    assertThat(result).isEmpty();
}
```

## Anti-razionalizzazioni

| Scusa | Rebuttal |
|---|---|
| "Aggiungo i test dopo" | Il codice senza test non è finito. |
| "Questo è ovvio, non serve testarlo" | Il codice ovvio si rompe in modi non ovvi. |
