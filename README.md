# ParaPoker Official Client

Browser-based, play-money No-Limit Texas Hold'em prototype built with Vite, React, TypeScript, and Vitest.

## Scripts

- `npm run dev` starts the local Vite dev server.
- `npm run test` runs deterministic Vitest coverage.
- `npm run typecheck` runs TypeScript project checks.
- `npm run lint` runs Oxlint.
- `npm run build` type-checks and builds the production bundle.

## Architecture

- `src/poker-engine/` contains the shared serializable poker engine and state projections.
- `src/npc/` contains code-driven NPC policies.
- `src/table-controllers/local-single-player/` owns canonical state for the local single-player milestone.
- `src/ui/` renders projected table state and submits shared engine commands.
- `docs/first-playable-architecture.md` records the milestone architecture and future server-authoritative boundary.

The React UI is not the source of truth. The local table controller owns canonical state for this milestone, and the engine API is designed so a future server-authoritative controller can reuse the same poker rules.
