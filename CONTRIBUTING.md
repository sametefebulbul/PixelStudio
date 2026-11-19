# Contributing

- Engine (Python, `engine/scripts/pxl.py`): keep it dependency-free beyond Pillow; add a check to `engine/scripts/selftest.py` for new commands.
- Server (`server/src`, TypeScript + Hono): providers implement `Provider` in `server/src/providers/types.ts`.
- UI (`web/src`, React + Vite): strings live in `web/src/i18n.ts` (tr + en).
- Run `npm test` before a PR. Recipes in `engine/references/recipes` must lint >= 80.
