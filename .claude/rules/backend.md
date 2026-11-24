---
paths:
  - "backend/**"
---

# Pravidla pro backend

- Všechny příchozí požadavky (body, query parametry, URL parametry) validuj proti schématům ze `shared/`.
- Vracej jednotný formát chyb `{ error: string, code: string, details?: unknown }` se správnými HTTP status kódy (`400`, `404`, `422`).
- Protože projekt nepoužívá externí databázi, zapouzdři práci se stavem (in-memory nebo JSON soubor) do samostatné repository vrstvy.
- **Povinné testy:** Ke každému novému endpointu nebo filtrační/rezervační logice napiš unit i API integrační test (úspěšný případ, filtrování/hraniční hodnoty i nevalidní vstup).
