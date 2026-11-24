---
paths:
  - "frontend/**"
---

# Frontend rules

- Import API data types only from `shared/` – do not create duplicate local interfaces.
- Every data fetch and form submission must visibly handle the `loading`, `error` and `empty state` cases.
- Use semantic HTML elements and accessible labels (`label`, `button`, `aria-label`) so the UI is clear and can be driven reliably by Playwright.
- **Required tests:** For every new component, filter or interaction add a component test (`npm test`), and when `run_e2e` is enabled also an E2E scenario (`npm run test:e2e`).
