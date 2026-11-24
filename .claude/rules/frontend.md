---
paths:
  - "frontend/**"
---

# Pravidla pro frontend

- Importuj datové typy pro komunikaci s API výhradně ze `shared/` – nevytvářej duplicitní lokální rozhraní.
- Každé načítání dat a odeslání formuláře musí viditelně ošetřovat stavy načítání (`loading`), chyby (`error`) a prázdného seznamu (`empty state`).
- Používej sémantické HTML prvky a přístupné popisky (`label`, `button`, `aria-label`), aby bylo UI přehledné a spolehlivě ovladatelné přes Playwright.
- **Povinné testy:** Ke každé nové komponentě, filtru nebo interakci přidej komponentový test (`npm test`) a při zapnutém `run_e2e` i E2E scénář (`npm run test:e2e`).
