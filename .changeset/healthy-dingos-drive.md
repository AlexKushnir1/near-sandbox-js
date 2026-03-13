---
"near-sandbox": minor
---

Migrate the package to an ESM-only module system and modernize the development setup.

Key changes:
- Convert the package to ESM-only
- Update `tsconfig` with stricter TypeScript checks
- Remove deprecated configuration
- Add explicit `.js` extensions to internal imports
- Replace AVA with Vitest for testing due to ESM compatibility issues
- Rewrite tests to use ESM syntax
- Use ESM-safe `dirname` handling
- Align dependency versions where needed

This change removes CommonJS support. Consumers must use an ESM-compatible environment or remain on version 0.2.1 (or earlier) to continue using the CommonJS build.