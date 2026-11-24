---
paths:
  - "backend/**"
---

# Backend rules

- Validate all incoming request data (body, query parameters, URL parameters) against the schemas from `shared/`.
- Return a unified error format `{ error: string, code: string, details?: unknown }` with correct HTTP status codes (`400`, `404`, `422`, …).
- The project has no external database: encapsulate state handling (in-memory or JSON file) in a separate repository layer so it can be swapped or reset in tests.
- **Required tests:** For every new endpoint or filtering/business logic write both a unit test and an API integration test (success case, filtering/edge values and invalid input).
