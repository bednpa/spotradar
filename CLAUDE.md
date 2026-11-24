# Architektura a workflow projektu

Webová aplikace bez databáze (stav je držen v paměti nebo v lokálním JSON souboru na backendu).
Projekt je rozdělen do tří oddělených částí:
- `shared/` – Sdílené TypeScript typy, DTO rozhraní a validační schémata (zdroj pravdy pro API kontrakt).
- `backend/` – HTTP REST API server a jeho integrační testy.
- `frontend/` – Klientská webová aplikace (UI) a její komponentové testy.

## Příkazy (spouštějí se z kořene repozitáře)
- Spuštění vývojového prostředí (frontend + backend): `npm run dev`
- Kontrola typů napříč celým projektem: `npm run typecheck`
- Statická analýza kódu: `npm run lint`
- Unit a API integrační testy: `npm test`
- Produkční build: `npm run build`

## Pravidla pro vývoj a testy (Contract-First)
1. **Striktní oddělení složek:**
   - Backend změny patří pouze do `backend/`.
   - Frontend změny patří pouze do `frontend/`.
   - Sdílené typy a validační schémata patří výhradně do `shared/`.
2. **Povinné testy ke každé změně:**
   - Každá nová funkce, endpoint, filtr nebo validační pravidlo musí mít odpovídající **unit / integrační test** (`npm test`).
   - Pokud je zapnutý E2E režim (`run_e2e: true`), přidej nebo uprav také **Playwright E2E test** (`npm run test:e2e`) pokrývající hlavní uživatelský scénář a chybový/prázdný stav.
3. **Žádné podvržené mocky v produkčním UI:** Frontend musí komunikovat se skutečnými endpointy podle kontraktu v `shared/`.
4. **Typová bezpečnost:** Nepoužívej `any`, `@ts-ignore` ani potlačení linteru bez explicitního zdůvodnění v komentáři.
5. **Ověření před dokončením:** Žádný úkol není hotový, dokud neprojde `npm run typecheck`, `npm run lint` a `npm test` (případně `npm run test:e2e`).
