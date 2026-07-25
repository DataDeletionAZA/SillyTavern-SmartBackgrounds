# SillyTavern API provenance

Target runtime: SillyTavern 1.18.0, installed checkout inspected on 2026-07-25.

- `manifest.hooks.activate`
  - Surface: SillyTavern core extension loader.
  - Authority: `public/scripts/extensions.js` in the inspected 1.18.0 checkout.
  - Confidence: high.
  - Runtime check: pending browser acceptance test.
- `getRequestHeaders({ omitContentType: true })`
  - Surface: SillyTavern core.
  - Authority: exported function in `public/script.js` in the inspected 1.18.0 checkout.
  - Confidence: high.
  - Runtime check: pending upload acceptance test.
- `getBackgrounds()`
  - Surface: SillyTavern core backgrounds module.
  - Authority: exported function in `public/scripts/backgrounds.js` in the inspected 1.18.0 checkout.
  - Confidence: high.
  - Runtime check: pending gallery refresh acceptance test.
- `/api/backgrounds/upload`
  - Surface: SillyTavern core HTTP endpoint.
  - Authority: `src/endpoints/backgrounds.js` and the built-in upload call in `public/scripts/backgrounds.js`.
  - Confidence: high.
  - Runtime check: pending upload acceptance test.
- Background drawer selectors (`#bg_menu_content`, `.bg_example`, `.jg-menu`)
  - Surface: SillyTavern 1.18.0 DOM.
  - Authority: `public/index.html` and `public/scripts/backgrounds.js` in the inspected checkout.
  - Confidence: high for 1.18.0, version-sensitive for future releases.
  - Runtime check: pending browser acceptance test.
