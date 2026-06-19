# Standard di Codice

## Java

- Java 21+ con record, sealed classes, pattern matching
- Maven come build system (no Gradle)
- Spring Boot 3.x come framework principale
- Naming: `camelCase` per metodi/variabili, `PascalCase` per classi
- Nessun commento ovvio; commenta solo il PERCHÉ
- Massimo 500 righe per file (Rule of 500)
- Test con JUnit 5 + AssertJ + Mockito

## Generale

- Commit atomici compilabili
- Nessun secret nel codice sorgente
- Variabili d'ambiente per configurazione sensibile
- OpenAPI-first per tutte le API REST
