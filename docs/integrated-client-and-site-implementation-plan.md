# ParaPoker Client, Authority Service, and Operator Console Roadmap

Status: Governing roadmap for coordinated gameplay, authority, and operator work.

This document replaces stale client-only expansion assumptions. It is based on inspection of the current `parapoker-official-client` repository and the separate `para-poker-site` repository. It does not implement code.

Most important correction:

> The browser player client is not the backend authority. It consumes projections and submits requests to authority boundaries; it does not own trusted seat binding, complete authority archives, or administrator authorization.

## 1. System Boundaries

ParaPoker should be designed as three coordinated surfaces, not one expanding browser client.

### Player Client

Owns:

- Gameplay presentation.
- Player authentication UI.
- Lobby UI.
- Table navigation.
- One, two, and four-table layouts.
- Player-visible local and cloud histories.
- `PlayerActionRequest` submission.

Does not own:

- Trusted seat binding.
- Complete authority archives.
- Administrator authorization.
- Official import approval.
- Raw randomness evidence.
- Other players' restricted private evidence.

### Game Authority Service

Owns:

- Trusted table lifecycle.
- Authenticated connection-to-seat binding.
- Command validation.
- Canonical poker state.
- Event journal.
- Timers and disconnect policy.
- Restricted private evidence.
- Completed-hand checkpoints.
- Archive finalization.
- Authority classification.

The current in-memory server-authoritative prototype is a boundary proof, not a production service.

### Operator Console

Owns:

- NPC and strategy administration.
- Blueprint and lobby-table operations.
- Restricted archive inspection.
- Public-package and CSV generation.
- Para submission and import status.
- Operational review.

The operator console may share a repository and design system with the player client, but it must be a separately protected server-authorized surface. A hidden React Admin tab is not a security boundary.

## 2. Current Repository Assessment

### `parapoker-official-client`

Current useful foundations:

- Vite React TypeScript client with explicit setup, table, result, and local admin screens.
- Serializable poker engine with Event Schema v1, public/private projections, hand evaluator, pot construction, replay, betting tests, three-handed tests, and simulations.
- `LocalSoloSession` creates a local archive when a table starts, appends public events, stores completed-hand checkpoints, retains hero-private hand evidence, and finalizes a completed-session public package.
- IndexedDB hand-history archive exists for browser-local evidence retention.
- Completed-session package exists as structured JSON and a Poker Now-style CSV can be derived from it.
- NPC identity and strategy contracts exist, with deterministic policy RNG streams.
- In-memory server authority prototype has `PlayerActionRequest`, state versions, idempotency, trusted seat binding, public/private projections, command persistence hooks, and multiplayer-session tests.
- Supabase publishable-key auth shell exists in the player client.

Important gaps:

- Current local archive is browser-owned and cannot be considered official authority.
- Current completed-session package is sanitized public/exhibition evidence, not a full restricted authority archive.
- Command evidence is incomplete for rejected requests and accepted request provenance.
- Event sequencing is hand-local and public-filtered; there is no durable global table sequence.
- Admin Portal is a local React tool, not a protected operator console.
- Lobby and true multi-table active sessions are not implemented.
- No restricted Supabase archive metadata/object storage model exists in the client roadmap yet.

### `para-poker-site`

Current useful foundations:

- Next.js and Supabase public/editorial site.
- Public sessions, players, standings, moments, recaps, newsroom, and admin editorial surfaces.
- Server-side service-role access in site routes.
- Raw hand-history import.
- Versioned ParaPoker completed-session JSON package importer at `src/lib/imports/parapokerPackageImporter.js`.
- `game_session_imports` SQL/RPC workflow for import audit and transactional normalized row commit.

Important boundaries:

- The Para site owns public presentation, standings, recap/newsroom workflows, and administrative approval/import mapping.
- It should not become the live game authority process unless explicitly split into an authority service boundary.
- Existing site importer reinforces that structured JSON is preferred over CSV when available.

## 3. Trust and Authority Model

Add the authority classification concept:

```ts
type AuthorityClass =
  | 'local-browser'
  | 'local-development'
  | 'server-exhibition'
  | 'server-official'
```

Implications:

- `local-browser`: owner-private or exhibition evidence only. Authentication does not make a browser archive authoritative.
- `local-development`: test-only records.
- `server-exhibition`: may be published as exhibition evidence after review.
- `server-official`: eligible for official competition only after Para validation and approval.

Official standings must not trust `local-browser` archives.

Supabase authentication identifies a user and ownership context, but it does not establish trusted multiplayer seat authority until the Game Authority Service binds an authenticated connection to a seat.

## 4. Active Journal Contract

Do not wait until table closure for the first durable write. Evidence must be persisted incrementally.

Lifecycle:

1. Create an active authority journal when a table starts.
2. Append accepted and rejected command records during play.
3. Append emitted events durably.
4. Persist a completed-hand checkpoint after every hand.
5. Finalize exactly one immutable `CompletedTableArchive` when the table closes.
6. Preserve failed or aborted table evidence with an explicit close reason.

Conceptual contract:

```ts
interface ActiveTableJournal {
  tableId: string
  authorityClass: AuthorityClass
  lifecycleStatus: TableLifecycleStatus
  commands: AuthorityCommandRecord[]
  events: AuthorityEventRecord[]
  completedHands: AuthorityHandRecord[]
  lastPersistedTableSequence: number
}
```

The existing `LocalSoloSession` incremental hand retention should be preserved as the local prototype of this safety property.

## 5. Command Evidence

Command evidence must include more than successful trusted `EngineCommand` objects.

Each authority command record must preserve:

- Original `PlayerActionRequest`.
- Request ID.
- Authenticated user and connection where applicable.
- Server-bound seat.
- Received timestamp.
- State version before processing.
- Acceptance or rejection.
- Rejection reason when rejected.
- Trusted `EngineCommand` only when accepted.
- State version after processing.
- Emitted event IDs.

The browser never chooses trusted seat or source fields.

## 6. Event Sequencing and Visibility

Document three ordering concepts:

```ts
interface AuthorityEventRecord {
  tableSequence: number
  handNumber: number
  handSequence: number
  visibility: 'public' | string
}
```

Rules:

- `tableSequence` is globally contiguous across the full authority journal.
- `handSequence` is contiguous inside the full restricted hand journal.
- `handSequence` may restart for each hand.
- Private events occupy `handSequence` positions.
- Public filtered output may contain `handSequence` gaps.
- Public validation requires strictly increasing hand-local sequences, not necessarily contiguous sequences.

Do not force the current poker engine hand-local sequence to become a global public sequence. Add global sequencing at the authority journal layer.

## 7. Completed Archive Contract

Conceptual contract:

```ts
interface CompletedTableArchive {
  schemaVersion: string
  archiveId: string
  tableId: string
  authorityClass: AuthorityClass
  table: CompletedTableMetadata
  participants: CompletedParticipant[]
  hands: CompletedAuthorityHand[]
  commands: AuthorityCommandRecord[]
  events: AuthorityEventRecord[]
  result: CompletedTableResult
  closure: TableClosure
  integrity: ArchiveIntegrity
}
```

The completed archive is immutable after successful finalization. Corrections or annotations must be separate audit records, never silent mutation.

Required contents:

- Pinned table metadata and lifecycle.
- Blueprint version and table instance ID.
- Seat reservations and final assignments.
- Participant identities, display names, and account/NPC references.
- NPC definition and strategy-profile versions.
- Blind, stack, position, and dealer data per hand.
- Accepted and rejected command evidence.
- Full restricted event journal.
- Public and private dealt cards.
- Board cards.
- Target contribution and raise-to evidence.
- Refund and side-pot evidence.
- Stack checkpoints and final stacks.
- Elimination and finish order.
- Closure reason.
- Integrity checksums.

## 8. Public Package and CSV Derivations

Structured JSON remains canonical.

Derivation hierarchy:

```text
CompletedTableArchive
|-- restricted structured authority archive
|-- sanitized structured completed-session public package
`-- Poker Now-compatible CSV
```

Rules:

- `CompletedTableArchive` events remain chronological.
- Sanitized public packages remove restricted-only fields.
- Poker Now CSV is a compatibility adapter only.
- Newest-first CSV output may be generated for compatibility.
- CSV is not the canonical backend record and should not be preferred when structured JSON is available.
- Para site import should prefer structured JSON package/archives and use CSV for legacy or compatibility workflows.

## 9. Separate Status Systems

Do not use one mixed status field. Track these separately:

```ts
type TableLifecycleStatus =
  | 'draft'
  | 'scheduled'
  | 'open'
  | 'seating'
  | 'active'
  | 'closing'
  | 'closed'
  | 'cancelled'
  | 'aborted'

type ArchiveLifecycleStatus =
  | 'not-started'
  | 'journaling'
  | 'finalizing'
  | 'ready'
  | 'failed'
  | 'quarantined'

type SubmissionLifecycleStatus =
  | 'not-submitted'
  | 'csv-generated'
  | 'submitted'
  | 'validation-failed'
  | 'needs-mapping'
  | 'imported'
  | 'rejected'
```

How they combine:

- A scheduled table may have archive status `not-started` and submission status `not-submitted`.
- An active table should have archive status `journaling`.
- A closing table should have archive status `finalizing`.
- A closed table may have archive status `ready`, `failed`, or `quarantined`.
- Submission status remains independent because a ready archive may never be submitted, may need mapping, or may be rejected.

## 10. Blueprint, Lobby, and Table Lifecycle

Separate reusable templates from table instances:

```text
GameBlueprint
-> LobbyTable
-> TableSeat reservations/assignments
-> ActiveTable
-> CompletedTableArchive
```

Rules:

- `GameBlueprint` is reusable and versioned.
- Creating a lobby game creates a `LobbyTable` instance from a blueprint.
- Seat reservations and assignments belong to the table instance, not the blueprint.
- When a table activates, pin:
  - Blueprint version.
  - NPC definition versions.
  - Strategy-profile versions.
  - Blind and stack configuration.
  - Seat assignments.
  - Visibility.
  - Authority class.
  - Randomness policy.
- Later configuration edits must not alter an active or completed table.

Target table types:

- Heads-up bot.
- Heads-up human.
- Six-max bots.
- Six-max mixed humans and bots.
- Six-max humans.

## 11. Identity and Authorization Model

Move identity and authorization earlier than lobby and multiplayer implementation.

Required early foundation:

- Supabase user identity for player login.
- Account ownership records.
- Screen name and profile image ownership.
- Operator roles.
- RLS for player-owned and operator-only data.
- Restricted archive metadata rows.
- Restricted archive object storage policies.

Players authenticate in the game client. Operator capabilities require server-enforced administrator roles.

The player browser must not automatically receive:

- All players' hole cards.
- All private events.
- Full authority archives.
- Raw randomness evidence.
- Administrator write capabilities.

## 12. Restricted Archive Storage

Treat "one package per table" as a logical contract.

Recommended physical storage:

Supabase metadata row:

- Archive ID.
- Table ID.
- Authority class.
- Table lifecycle status.
- Archive lifecycle status.
- Submission lifecycle status.
- Checksum.
- Storage object path.
- Timestamps.
- Submission/import state.

Restricted immutable object:

- Compressed `CompletedTableArchive` JSON.

Public packages and CSVs are separate derived objects.

Use RLS and restricted Storage policies. Player-visible history should read sanitized projections or packages, not restricted archive objects.

## 13. Randomness Evidence Policy

Do not require raw deck order, seed, entropy, or RNG state retention by default.

Policy:

- Deterministic local development may retain private seeds.
- Official tables should use secure shuffle and verification/commitment evidence.
- Raw entropy and live RNG state are retained only when explicitly required.
- Sensitive randomness evidence must have access, encryption, retention, and deletion rules.
- None of it appears in player-visible output or ordinary application logs.

## 14. Operator Console Model

The operator console lives in the game project and may reuse the client design system, but it is protected by server-enforced administrator roles and is not an ordinary player-client capability.

Operator console responsibilities:

- Create, edit, retire, and version NPC definitions.
- Create and version safe strategy profiles.
- Create and version game blueprints.
- Create, edit, cancel, and close lobby tables before activation.
- Inspect active journal health.
- Inspect restricted completed archives.
- Generate sanitized public packages.
- Generate Poker Now-compatible CSV.
- Submit to Para site import workflows.
- Track validation, mapping, approval, import, and rejection states.

The current React Admin Portal is a local prototype and must not be treated as a production authorization boundary.

## 15. Para Product Boundaries

Game system owns:

- Gameplay.
- Trusted table evidence.
- Account-aware game history.
- Lobby/table operations.
- NPC configuration.
- Public-package generation.

Para site owns:

- Public sessions.
- Player profiles.
- Standings.
- Recaps.
- Moments.
- Newsroom.
- Long-term public presentation.
- Administrative approval and import mapping.

Do not duplicate public league presentation in the game client.

## 16. Revised Milestones

### Milestone 0: Repair Existing Completed-Session Package and Importer Contract

Purpose: align current client package and site importer before building authority archives.

Required coverage:

- Multi-hand event validation.
- Real timestamps.
- Target contribution and raise-to preservation.
- Per-hand blind and position data.
- Stack checkpoints.
- Refund and side-pot evidence.
- Reliable elimination order.
- Stronger multi-hand fixtures.

### Milestone 1: Active Authority Journal and CompletedTableArchive v1

- Define `AuthorityClass`.
- Define `ActiveTableJournal`.
- Define restricted command and event records.
- Define immutable `CompletedTableArchive`.
- Preserve incremental completed-hand checkpoints.
- Derive sanitized public package and Poker Now CSV from archive data.

### Milestone 2: Supabase Identity, Roles, RLS, and Restricted Archive Storage

- Add account ownership records.
- Add operator roles.
- Add restricted archive metadata table.
- Add restricted Storage bucket/object policy.
- Keep service-role access out of the browser client.

### Milestone 3: Operator Hand-History Console

- Replace local hidden-admin assumptions with role-protected operator flows.
- Inspect restricted archives through server authorization.
- Generate public package/CSV derivatives.
- Track submission lifecycle.

### Milestone 4: Persistent NPC and Strategy Registry

- Persist NPC definitions and strategy profiles.
- Version NPC and strategy records.
- Keep poker decisions deterministic and non-LLM.

### Milestone 5: Persistent Game Blueprints and LobbyTable Instances

- Persist reusable blueprints.
- Create table instances from pinned blueprint versions.
- Support scheduled/open/cancelled table states.

### Milestone 6: Player Account Shell

- Secure login.
- Screen name.
- Profile image.
- Player-visible own histories.
- No trusted seat authority until server binding exists.

### Milestone 7: Lobby v1

- Show admin-created tables.
- Initially support bot/local prototype tables.
- Track seats, visibility, status, and authority class.

### Milestone 8: Multi-Table Client Manager

- Allow up to four active table views.
- Preserve one, two, and four-table layouts.
- Keep per-table state isolated.

### Milestone 9: NPC Teaching Profiles and Simulation Evidence

- Strategy profiles for tight/aggressive, loose/passive, position-aware, pot-odds-aware, and draw-aware play.
- Admin-editable tendencies, versioned 169-class preflop ranges, safe presets, and pinned per-table strategy snapshots.
- Deterministic decision traces and simulation evidence for strategy behavior.
- No LLM-based poker action selection and no requirement to solve the complete poker game tree at decision time.

Strategy source hierarchy:

1. `docs/poker-rules-contract.md` governs action legality, betting semantics, blind assignment, action order, visibility, and replay behavior.
2. The [2024 Poker TDA Rules](https://www.pokertda.com/view-poker-tda-rules/) and official [PokerStars tournament rules](https://www.pokerstars.com/poker/tournaments/rules/) are external legality baselines where the ParaPoker contract is not explicit.
3. Public GTO Wizard material on [MDF](https://blog.gtowizard.com/mdf-alpha/), [preflop range morphology](https://blog.gtowizard.com/preflop-range-morphology/), and [continuation-bet sizing](https://blog.gtowizard.com/the-mechanics-of-c-bet-sizing/) informs strategic heuristics without importing proprietary solver charts.
4. Public PokerStars Learn material on [heads-up preflop play](https://www.pokerstars.com/poker/learn/strategies/spin-go-heads-up-preflop-on-the-button/) and [heads-up position and stack pressure](https://www.pokerstars.com/poker/learn/news/strategy-to-play-heads-up-poker/) provides sanity checks.
5. [DeepStack](https://arxiv.org/abs/1701.01724), [Pluribus](https://doi.org/10.1126/science.aay2400), and [OpenSpiel](https://openspiel.readthedocs.io/en/latest/games.html) inform imperfect-information boundaries, local abstraction, deterministic mixed strategies, and simulation methodology. ParaPoker will not reproduce their solver architectures in this milestone.

Exact ranges, action frequencies, sizing rules, MDF modifiers, and intentional mistakes are versioned ParaPoker product data. Each component must be labeled as an official rule, ParaPoker convention, sourced heuristic, configurable tendency, or skill-level deviation. Built-in presets must not claim solver-perfect GTO accuracy.

Ordered NPC strategy phases:

1. Preflop range contracts and heads-up blind strategy: 169 hand classes, position/action/stack-depth nodes, weighted actions, legal sizing resolution, independent RNG, and pinned profile versions.
2. Six-max positional and blind ranges: unopened pots, limps, calls, isolation raises, three-bets, four-bets, squeezes, and multiway entry rules.
3. Lightweight postflop range tracking: own-range and opponent-range buckets updated only from legal private/public information.
4. Proactive postflop betting: checking, value betting, bluffing, continuation betting, probes, delayed bets, raises, barrels, give-ups, and configurable sizing.
5. MDF-informed defense: aggregate defense targets adjusted for position, range disadvantage, board texture, equity realization, stack depth, multiway play, and opponent tendencies.
6. Admin range editor and scenario simulator: clone/version/validate profiles, edit mixed frequencies and sizing, inspect deterministic decision traces, and compare preset behavior.
7. Teaching explanations: derive player-facing concepts from verified decision inputs and outputs without changing poker actions or exposing hidden state.

### Milestone 10: Server-Authoritative Multiplayer Productization

- Real transport.
- Connection-to-seat binding.
- Timers and disconnect policy.
- Human/bot mixed tables.
- Server-side archive finalization.

### Milestone 11: Packaging and Native Readiness

- Keep browser-first.
- Avoid browser-only assumptions in table/session APIs so future desktop packaging remains viable.

## 17. Test Plan

Archive and journal tests:

- Active journal is created before first hand.
- Accepted and rejected commands are persisted with provenance.
- Events receive global table sequences.
- Completed-hand checkpoints persist after every hand.
- Exactly one immutable archive is finalized on table closure.
- Aborted and failed tables preserve evidence and close reason.

Public derivation tests:

- Restricted archive includes private evidence.
- Sanitized public package excludes restricted-only evidence.
- Poker Now CSV remains `entry,at,order`, newest-first only as adapter output, with correct quoting.
- Structured JSON remains chronological and canonical.

Identity and authorization tests:

- Player client cannot read restricted archives.
- Player client cannot perform operator writes.
- Operator-only routes require server-enforced roles.
- Local-browser archives are never official standings input.

Blueprint and lobby tests:

- Blueprint edits create new versions.
- Active table pins blueprint/NPC/strategy versions.
- Later blueprint edits do not mutate active or completed tables.
- Lobby table lifecycle and archive lifecycle statuses remain independent.

NPC strategy tests:

- Heads-up button and blind ranges respond to position, effective stack, prior action, and raise size.
- Every weighted range node normalizes to legal deterministic action frequencies.
- Weak and strong profiles differ through documented ranges, sizing, and controlled deviations rather than arbitrary illegal actions.
- One NPC's random decisions cannot change another NPC's future sequence.
- Active tables retain pinned strategy versions when an admin later edits a profile.
- Postflop simulation will separately cover proactive betting and MDF-informed defense; MDF is never the sole decision rule.

Multiplayer boundary tests:

- Client requests never choose trusted seat/source.
- Authority service binds authenticated connection to seat.
- Rejected commands are journaled.
- Server-official archives are eligible only after validation and approval.

## 18. Explicit Non-Goals

- Do not make the browser player client the backend authority.
- Do not treat React Admin as a security boundary.
- Do not make Poker Now CSV canonical when structured JSON is available.
- Do not expose full authority archives, all hole cards, private events, or raw randomness evidence to ordinary player clients.
- Do not trust local-browser archives for official standings.
- Do not duplicate Para public standings, recaps, moments, newsroom, or long-term presentation in the game client.
- Do not add LLM-based poker action selection.

## 19. Migration Path From Current Local Implementation

Current local code should evolve as follows:

- `LocalSoloSession` incremental retention becomes the local prototype of `ActiveTableJournal`.
- Current `ArchivedSessionRecord` status is split into table lifecycle, archive lifecycle, and submission lifecycle.
- Current completed-session public package remains a sanitized derivative, not the authority archive.
- Current Poker Now CSV formatter remains a compatibility adapter.
- Current IndexedDB archive remains local-browser/private evidence, not official authority.
- Current in-memory server authority becomes the implementation reference for trusted command construction and request provenance.
- Current Admin Portal becomes a prototype for operator workflows, then moves behind server-enforced role checks.
- Existing Para site package importer remains the public-package import path while the authority archive contract is developed.

## 20. Exact First Implementation Milestone

First milestone: **Repair Existing Completed-Session Package and Importer Contract**.

Existing code it replaces or extends:

- Extends `src/exports/completedSessionPackage.ts`.
- Extends `schemas/para-completed-session-v1.schema.json`.
- Extends `tests/fixtures/para-completed-session-v1.json`.
- Extends client export tests and Para site package importer validation tests.
- Does not replace the poker engine or local controller.

What must remain unchanged:

- React is not canonical poker state.
- Human/NPC actions use shared engine gateways.
- Browser clients do not choose trusted seat/source for multiplayer.
- Current local solo gameplay remains playable.
- Current Para site public presentation remains owned by `para-poker-site`.
- Service-role keys stay out of `parapoker-official-client`.

Acceptance gate before proceeding:

- Multi-hand fixture validates in both client and Para site importer.
- Package includes real timestamps, target contributions, positions/blinds, stack checkpoints, side-pot/refund evidence, and elimination order.
- Sanitized package still excludes restricted-only evidence.
- Poker Now CSV is regenerated from structured data and remains compatible.
- Tests pass in both repositories for package generation and import validation.
