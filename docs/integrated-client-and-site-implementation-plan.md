# Integrated Client and Para Site Implementation Plan

Status: Governing implementation plan for the gameplay client and Para Poker site integration.

This document is based on inspection of the current `parapoker-official-client` repository and the separate `para-poker-site` repository. It replaces stale client-only roadmap assumptions. It does not modify production code, tests, dependencies, configuration, migrations, importer code, exporter code, networking, UI, NPC behavior, or existing architecture documents.

## 1. Executive Product State

ParaPoker currently exists as two separate products with complementary responsibilities.

`parapoker-official-client` is the gameplay product. It can run a browser-playable local no-limit Texas Hold'em freezeout match using Vite, React, and TypeScript. The current browser UI can start a local heads-up or six-max session, submit human actions, run NPC actions, show a table, show action controls, and display a local result summary. The UI still creates a default match automatically on page load, so the next user-facing work is an explicit setup/playing/result scene flow.

Important client modules:

- `src/poker-engine/`: serializable rules engine, cards, evaluator, pot construction, projections, replay helpers, and Event Schema v1.
- `src/npc/basicNpc.ts`: deterministic code-driven NPC policy with preflop and postflop heuristics.
- `src/table-controllers/local-single-player/`: local controller and `LocalSoloSession` integration boundary.
- `src/table-controllers/server-authoritative/`: in-memory server-authority and multiplayer table-service prototypes.
- `src/persistence/`: in-memory match, event, command, profile, and statistics store interfaces and implementations.
- `src/ui/PokerTable.tsx`: current browser gameplay UI.

`para-poker-site` is the persistent player-facing and admin presentation product. It is a separate Next.js and Supabase application with sessions, hands, actions, session results, player session stats, notable hands, players, standings, moments, recaps, newsroom pages, and an admin raw hand-history import path. Its current working tree is dirty and ahead of origin, so this plan treats that repository as read-only audit evidence and must not modify it.

User-facing capability today:

- Client: local solo gameplay with heads-up and six-max NPC tables, current-match stats, local result summary, and in-memory records.
- Site: Supabase-backed public/admin session, player, standings, moments, and newsroom surfaces, plus raw hand-history preview/commit.

Internal-only or prototype capability:

- Client: replay helpers, visibility-scoped stores, command records, profile stores, server authority, multiplayer table service, spectator projections, reconnection behavior, and persistence flushing are tested internally but not exposed as a real networked product.
- Site: raw text/CSV import exists, but there is no versioned canonical ParaPoker client package adapter yet.

What users might reasonably assume exists but does not:

- No explicit client setup scene before game creation.
- No durable client-side session archive.
- No canonical client JSON export package.
- No Para site adapter for client-generated event packages.
- No automatic client-to-site submission.
- No real multiplayer transport, auth, lobby, timers, or production server process.

## 2. Current Cross-Repository Architecture Map

Authority flows from poker rules to controller/session to UI in the client, then later from completed session package to the site.

Client architecture:

- Poker engine owns canonical gameplay state, legal actions, betting progression, pot construction, showdown, Event Schema v1, and public/private projections.
- NPC policy receives only `PrivateSeatView`, legal actions, policy config, read-only memory, and an independent RNG stream.
- `LocalSinglePlayerController` owns the local canonical engine state and runs NPC turns.
- `LocalSoloSession` owns a local match ID, controller, in-memory stores, public event capture, current-match stats, and result summary.
- React owns only view shell state: form inputs, selected controls, UI panels, and pending/presentation state. It must not own stacks, deck, hole cards, legal actions, pot, winners, or betting progression.
- In-memory server authority and multiplayer table service simulate future server ownership, state versioning, idempotency, trusted seat binding, spectator projection, reconnect behavior, and persistence flushing.

Site architecture:

- Next.js server routes and server components access Supabase through server-side service-role configuration in `src/lib/supabase.js`.
- Admin import endpoints preview and commit raw hand history in `src/app/api/admin/imports/raw-hands/*`.
- Import repository maps parsed raw hands into Supabase `sessions`, `hands`, `actions`, `notable_hands`, `players`, and `player_session_stats`.
- Public/admin pages read normalized session, player, standings, moment, and recap data from Supabase-backed repositories and view models.

Required preserved boundaries:

- React is not canonical poker state.
- NPCs receive only seat-private projections.
- Human and NPC actions use the trusted internal engine gateway.
- Future multiplayer clients never submit trusted seat identity or action source.
- Hidden cards, deck order, seeds, entropy, and RNG state remain private.
- Narrative, recap, newsroom, and Para presentation systems do not affect poker decisions or rules.
- The client produces canonical completed-session evidence; the site owns durable import, mapping, publication, and presentation.

## 3. Infrastructure Integration Matrix

| Subsystem | Current implementation | Consumers | Gap | Plan |
| --- | --- | --- | --- | --- |
| Poker engine | Serializable TypeScript rules engine with legal actions, Event Schema v1, projection APIs, pot construction, evaluator, replay helpers | Local controller, server authority tests, NPC projections, UI indirectly | Position labels are not projected; export package does not exist | Keep as gameplay source of truth; add tested position projection/helper before layout/export work |
| Event schema | Stable envelope with schema version, event ID, sequence number, hand ID, command ID, visibility, payload | Engine, stores, replay tests, session tests | Not yet wrapped into cross-repo completed-session package | Preserve and use as package event backbone |
| Replay | Replays from config/seed or fixed deck plus commands | Engine tests | Not exposed as product replay or import validation | Use to validate export fixtures before site import |
| NPC policy | Basic preflop/postflop heuristics, independent RNG streams | Local controller | No roster, difficulty, archetypes, position-aware ranges, or multiway equity | Productize after solo scene/table presentation |
| Local controller | Runs engine locally and auto-runs NPC turns | Local session and tests | Immediate canonical resolution has no presentation queue | Keep authority boundary; add presentation queue above it later |
| Local solo session | Owns controller, local match ID, in-memory stores, event capture, stats, summary | UI and tests | In-memory only; public events only; no export package; time/random IDs | Keep for local product shell and export staging |
| Match/Event/Command stores | In-memory interfaces and implementations | Session, server authority tests | Not durable; not intended as client league archive | Keep in-memory for gameplay/session tests, local summaries, multiplayer authority staging, and export generation |
| Stats store | Current-match stats from verified public events | Session and tests | Gross chips awarded only; no lifetime stats; no VPIP/PFR | Keep narrow in client; site owns durable player/session/lifetime stats after import |
| Profile store | In-memory player/NPC profile interface | Tests only | Duplicates site responsibility if expanded | Do not expand into persistent client profiles; reuse only for NPC config prototypes/tests if needed |
| Server authority | In-memory table authority with trusted command construction, idempotency, state versions, projections, persistence hooks | Tests | No transport/auth/process/timers/secure entropy | Keep prototype; real multiplayer waits until local/export/site path is stable |
| Multiplayer table service | In-memory player/spectator connect, reconnect, action routing | Tests | Not a deployed multiplayer service | Keep as protocol boundary proof |
| React UI | Table, setup controls, actions, history, result summary | Browser users | Auto-starts a match; no explicit scenes; table layout still dashboard-like | Next task creates explicit setup/playing/between-hand/result scenes |
| Para site import | Raw text/CSV preview and commit to Supabase | Admin import page | No canonical ParaPoker client package adapter | Add after client export package is stable |
| Para site presentation | Sessions, hands/actions, players, standings, moments, newsroom, recaps | Public/admin site | Depends on imported rows, not client package yet | Site remains durable read model and presentation owner |

## 4. Immediate Product Integration Goal

The first coherent checkpoint is the solo game product shell in the client:

Setup Scene -> Active Match Scene -> Hand Completion -> Next Hand -> Match Result Scene -> Rematch or Change Setup -> Completed-session export later.

The browser should not create or display a game until the player explicitly starts one.

Ownership:

- Setup form and scene state: React.
- Resolved seed, mode, blinds, stack, active match ID: `LocalSoloSession`.
- Poker state, actions, events, and result: engine/controller/session.
- Current-match stats and result summary: `LocalSoloSession` derived from verified events and match state.
- Durable session archive, profiles, standings, recaps, moments: Para site after export/import.

## 5. Client UI Scene Architecture

Add explicit scenes in `PokerTable` or a small UI-level scene shell:

- `setup`: no session exists; show configuration and Start Match.
- `playing`: active hand in progress; show table/actions.
- `betweenHand`: hand settled and match not complete; show hand result, Next Hand, Change Setup.
- `matchResult`: match complete; show result summary, Rematch Same Seed, New Random Match, Change Setup.

React may own:

- Current scene.
- Form inputs.
- Open/collapsed history and summary panels.
- Confirmation dialog state.
- Presentation timing/animation queues.

React must not own:

- Stacks, pot, deck, hole cards, legal actions, betting progression, winners, match stats, or event truth.

Transition rules:

- Initial load -> `setup`, with no `LocalSoloSession.create`.
- Start Match -> validate setup, resolve seed once, create `LocalSoloSession`, enter `playing` or `matchResult` if instant-complete.
- Player action -> session transition; if status waits for next hand, enter `betweenHand`; if complete, enter `matchResult`; otherwise remain `playing`.
- Next Hand -> session starts hand and returns to `playing`.
- Change Setup during active match -> confirmation before discarding in-memory active match.
- Rematch Same Seed -> create a new session with same resolved seed.
- New Random Match -> generate a new seed exactly once at start boundary.
- Refresh currently loses in-memory data; durable archive/export is postponed.

## 6. Match Setup and Seed Lifecycle

Setup fields:

- Mode: heads-up or six-max.
- Starting stack.
- Small blind.
- Big blind.
- Deterministic seed input.
- Random local seed toggle or button.
- Future: NPC roster and difficulty, not in the next task.

Validation:

- Starting stack, small blind, and big blind must be positive integers.
- Big blind must be at least small blind.
- Starting stack must be at least big blind unless product owner approves micro all-in starts for testing.
- Deterministic seed must be non-empty when random seed is disabled.

Seed lifecycle:

- Deterministic seed: use exactly the entered value.
- Random seed: generate once when Start Match or New Random Match is clicked.
- Store the resolved seed in the session config.
- Display the exact resolved seed in the active match and result.
- Rematch Same Seed reuses that exact value.
- Never silently regenerate during render.

Local seeds are deterministic/reproducibility inputs. Future live multiplayer entropy is server-side cryptographic randomness and must never be exposed to ordinary clients, logs, exports, recaps, or the site import package.

## 7. Seat, Position, and Table Presentation

Add a shared tested position helper or projection field in the client, not ad hoc React logic.

Conventional labels by funded active seat count:

- Heads-up: BTN/SB, BB.
- Three-handed: BTN, SB, BB.
- Four-handed: BTN, SB, BB, UTG.
- Five-handed: BTN, SB, BB, UTG, CO.
- Six-handed: BTN, SB, BB, UTG, HJ, CO.

Position rules:

- Recalculate every hand from funded participating seats.
- Respond to eliminations.
- Do not permanently attach position labels to seat IDs.
- Align with current engine dealer/blind/action ordering and `docs/poker-rules-contract.md`.
- Expose through engine projection or a shared helper consumed by projection/UI/export tests.

Seat presentation should distinguish:

- Player/NPC display name.
- Stack.
- Position.
- Button/blind responsibility.
- Active/folded/all-in/out status.
- Acting indicator.
- Street contribution.
- Total contribution where useful for all-ins and side pots.

## 8. Table Layout and Visual Hierarchy

The poker table should be the primary visual object, not a dashboard grid.

Plan:

- Arrange six-max seats around one table with hero anchored at bottom.
- Keep board and pot central.
- Put action controls close to hero.
- Make hand history compact, collapsible, and secondary.
- Dim folded seats; clearly mark all-in/out states.
- Emphasize acting seat and moving dealer/button.
- Preserve accessible labels and keyboard operation.
- Use React/CSS first; do not require canvas/WebGL unless CSS proves insufficient.
- Support desktop without page scroll where practical and mobile with a stacked responsive layout.

## 9. Hand and Match Presentation

Current canonical resolution is immediate. That is correct for authority, but presentation needs a separate queue.

Add a UI presentation queue later that consumes verified transition events and turns them into display steps:

- Action acknowledgement.
- NPC thinking delay.
- Street dealing.
- Pot movement.
- Fold result.
- Showdown reveal.
- Winning hand description.
- Main/side pot display.
- Split pot and odd-chip display.
- Elimination and match completion.

Rules:

- Canonical state resolves immediately in controller/session.
- UI locks input while presenting queued events if the current canonical state says no human action is pending.
- NPC pacing never owns or delays canonical state.
- Presentation events are UI-only and derived from canonical engine history; they are not replay truth.

## 10. NPC Productization Plan

Current NPC policy uses:

- Legal actions from private seat projection.
- Preflop hand tiers.
- Made-hand strength, draw detection, board wetness, pot odds-ish call pricing, effective stack, and deterministic RNG.
- Independent RNG per NPC seat using seed plus seat ID.

Limitations:

- All NPCs share the same default config unless controller config is extended.
- Position awareness is limited.
- Multiway equity is coarse.
- Table memory exists structurally but is barely used.
- Bet sizing is simple and can look repetitive.
- No named roster, archetypes, or difficulty settings.

Stages:

1. Named NPC config and roster for solo setup.
2. Difficulty presets that map to policy config.
3. Position-aware preflop ranges and action frequencies.
4. Multiway-aware postflop heuristics and effective-stack pressure.
5. Lightweight deterministic equity approximation or documented hand-strength/potential heuristics.
6. Opponent tendency memory outside canonical engine state.
7. Controlled mistakes, bluff, semi-bluff, and bet-size variation.
8. Behavioral simulations and legality tests.

Do not use an LLM for poker action selection. Character identity, dialogue, flavor, and recaps are presentation layers only.

## 11. Local Session and Completed Hand-History Export Boundary

`LocalSoloSession` should remain the client integration boundary for solo play.

Current strengths:

- Unique local match IDs.
- Owns local controller.
- Captures public events.
- Derives current-match stats.
- Produces local result summary.
- Supports heads-up and six-max.

Current limitations:

- Match IDs use time/randomness and are not durable.
- Data is in-memory and lost on refresh.
- Public events only are recorded for session records.
- Local solo commands are not recorded as command records.
- No completed-session export package.
- No durable client archive.
- No Para player identity mapping.

Staged path:

1. Reliable in-memory session and scene flow.
2. Canonical completed-session export package generated from verified records.
3. JSON download.
4. Site admin import/validation.
5. Optional browser-local recent export cache, not a league archive.
6. Authenticated automatic submission later.

## 12. Client Store and Interface Review

`MatchRecordStore`, `EventRecordStore`, and `CommandRecordStore`:

- Keep in-memory.
- Useful for gameplay/session tests, local summaries, future multiplayer authority, and export generation staging.
- Do not present as production persistence.
- Later production durability belongs either to the future multiplayer server or the Para site import path, depending on mode.

`StatsStore`:

- Keep narrowly for current-match/result screen stats and export support.
- Do not expand to lifetime stats, standings, or player profiles.
- Site owns durable player-session and lifetime statistics after import.
- Current `chipsAwarded` is gross pot awards, not profit.

`ProfileStore`:

- Keep as test/prototype support for NPC/player config if useful.
- Do not build persistent profile UX in the client.
- Site owns player profiles, NPC presentation, dossiers, and public/private player-facing pages.

## 13. Para Site Import and Consumption Roadmap

The client must produce one repository-independent completed-session package. The site must own the adapter that validates and maps the package into Supabase and presentation schemas.

Package should include:

- `schemaVersion`.
- Source application and client version.
- Stable source match ID.
- Rules contract version.
- Event schema version.
- Session format and mode.
- Starting stack and blinds.
- Participants and seat assignments.
- Optional Para player IDs.
- Hands.
- Ordered public events.
- Actions.
- Community cards.
- Revealed cards only.
- Pot awards.
- Final stacks.
- Finish order.
- Result summary.
- Integrity/checksum metadata where useful.

Package must exclude:

- Raw deck order.
- Live RNG state.
- Entropy.
- Unrevealed opponent hole cards.
- Canonical engine state.
- Internal-only private events from the public package.
- Service credentials.

Import progression:

1. Downloadable JSON hand-history export from client.
2. Admin upload and validation in site.
3. Idempotent import storage keyed by source match ID.
4. Admin player identity mapping for unknown participants.
5. Transactional session, hand, action, result, and stat row insertion.
6. Session detail and hand-history display compatibility.
7. Derived session statistics and notable-hand processing.
8. Authenticated automatic submission later.
9. Multiplayer server submission later.

The site importer should validate schema version, event ordering, chip conservation where possible, duplicate source IDs, malformed records, privacy exclusions, and incomplete imports before publishing.

## 14. Multiplayer Infrastructure Completion Plan

Current client-side multiplayer infrastructure is an in-process prototype:

- `PlayerActionRequest`.
- Trusted server-side command construction.
- State versions.
- Idempotency.
- Seat binding by connection.
- Public/private/spectator projections.
- Basic disconnect/reconnect behavior.
- Persistence flushing to in-memory stores.

Missing for usable multiplayer:

- Real transport.
- Authentication.
- Server process ownership.
- Secure shuffle/entropy.
- Timers and time banks.
- Disconnect policy.
- Table lifecycle.
- Lobby/matchmaking boundary.
- Durable authoritative records.
- Horizontal ownership/recovery.
- Threat-model review before external testing.

Real multiplayer must stay behind local solo UX, export, and site import stabilization. Future multiplayer submission to the site should come from the authoritative server, not from an untrusted browser.

## 15. Para Presentation Infrastructure

The Para site already owns:

- Public sessions.
- Player pages.
- Standings.
- Moments.
- Admin newsroom.
- Recap drafts.
- Article/newsroom generation.
- Debug/import health pages.

Client evidence can later feed the site layers:

1. Verified facts from public events and result summary.
2. Derived statistics from validated import.
3. Interpretive commentary in site/newsroom.
4. Fictional character flavor, kept separate from facts.

Generated or editorial recaps require:

- Stable package schema.
- Complete session recording.
- Verified statistics.
- Privacy classification.
- Thin-data fallbacks.
- Approval/publication rules.
- No invented actions, cards, stacks, results, or private information.

## 16. Testing and Quality Plan

Current client coverage includes:

- Engine unit tests.
- Betting regressions.
- Hand evaluator matrix.
- Hardening regressions.
- Replay contract.
- Event schema and visibility.
- Invariant simulations.
- Three-handed and multi-seat simulations.
- NPC legality/behavior tests.
- Local controller/session tests.
- Persistence tests.
- Server authority and multiplayer service tests.
- UI smoke tests.

Needed next:

- Scene-transition tests for setup -> playing -> between-hand -> result.
- No-auto-session test.
- Setup validation tests.
- Seed lifecycle tests for display, same-seed rematch, and random rematch.
- Position helper/projection tests.
- Table layout behavior tests for six-max arrangement.
- Presentation queue tests.
- Completed-session export schema/fixture tests.
- Site adapter validation tests.
- CI for tests, typecheck, lint, and build on pushes/PRs.

Do not implement CI in this planning task.

## 17. Technical Debt and Correctness Audit

| Concern | Severity | Impact | Fix timing | Blocks next milestone |
| --- | --- | --- | --- | --- |
| Client auto-creates default session on page load | High | Violates desired setup-first product flow | Milestone 1, first task | Yes |
| Site owns persistent Para layer but older client docs imply client persistence/player layer | High | Can cause duplicate architecture | This plan | No after plan |
| Client ProfileStore can be mistaken for product profile system | Medium | Duplicates site responsibility if expanded | Keep narrow before profile work | No |
| In-memory stores look database-ready but are prototypes | Medium | Could be overclaimed as production persistence | Plan/docs and export work | No |
| No canonical completed-session package | High | Blocks site import from client evidence | Milestone 3 | Not for solo scene |
| Position labels not shared/projection-backed | Medium | UI/export can drift from engine rules | Milestone 1 | No, but early |
| UI mixes setup panel with active match | Medium | Confusing start/change flow | Milestone 1 | Yes |
| Match IDs use time/random values | Low/Medium | Good enough locally, weak for idempotent import | Export milestone | No |
| Public session records omit private events | Medium | Fine for public import, insufficient for private player export | Export milestone | No |
| No command records for local solo | Low/Medium | Public action events may be enough initially; command replay package may need refinement | Export milestone | No |
| NPCs share default config | Medium | Six-max opponents feel similar | Milestone 2/3 | No |
| Immediate NPC resolution has no presentation pacing | Medium | Gameplay feels abrupt | Milestone 2 | No |
| Para site import parser is raw text/CSV oriented | High | Needs canonical package adapter | Milestone 4 | No |
| Site repo is dirty/ahead | Medium | Planning must avoid touching it | Now | No |
| No GitHub CI confirmed | Medium | Regression risk | Production readiness or earlier | No |

## 18. Milestone Roadmap

### Milestone 1: Coherent Solo Game UX

Purpose: Make the client feel like one product instead of auto-started internals.

Scope:

- Setup, playing, between-hand, and result scenes.
- No automatic game before Start Match.
- Validation and seed lifecycle.
- Position labels.
- Rematch and abandonment flow.
- Better table hierarchy without export/import work.

Acceptance:

- User starts heads-up or six-max explicitly.
- User can play to completion and rematch.
- Session authority remains in `LocalSoloSession`.
- Tests cover scene transitions and seed behavior.

Review gate: product owner approves user-facing solo flow.

### Milestone 2: Hand and NPC Presentation

Purpose: Make hand resolution readable and NPCs feel intentional.

Scope:

- Fold/all-in/showdown presentation.
- NPC pacing and event presentation queue.
- Side-pot and split-pot display.
- Named NPC roster, archetypes, difficulty config.
- Multiway and position-aware NPC tuning.

Acceptance:

- Canonical state remains immediate; presentation queue is UI-only.
- NPCs remain legal and deterministic under tests.

### Milestone 3: Canonical Hand-History Export

Purpose: Produce a stable client-owned evidence package.

Scope:

- Export schema.
- Export builder from `LocalSoloSession` records.
- Public package privacy filter.
- Validation and checksum metadata.
- JSON download.
- Deterministic fixtures.

Acceptance:

- Export excludes secrets and private opponent cards.
- Same seed/action fixture exports reproducibly.
- Site adapter can be implemented against schema without client Supabase knowledge.

### Milestone 4: Para Site Import

Purpose: Teach the site to consume the client package.

Scope:

- Admin upload.
- Schema validation.
- Source match ID idempotency.
- Player mapping.
- Transactional insert/update into sessions, hands, actions, results, stats, notable-hand candidates.
- Import preview and publish gate.

Acceptance:

- Site imports a completed client package without direct client database writes.

### Milestone 5: Para Site Consumption

Purpose: Make imported client sessions useful across existing site pages.

Scope:

- Session detail compatibility.
- Hand-history display.
- Derived stats compatibility.
- Notable-hand detection.
- Recap/newsroom context compatibility.

Acceptance:

- Imported sessions appear in existing public/admin surfaces without duplicate client pages.

### Milestone 6: Automated Submission

Purpose: Reduce manual import once schema and identity are stable.

Scope:

- Authenticated server endpoint.
- Client submission for approved modes.
- Retry and duplicate handling.
- Future multiplayer server submission.

Acceptance:

- Browser never receives service-role key.
- Site validates every submission before publish.

### Milestone 7: Real Multiplayer Productization

Purpose: Move from in-memory multiplayer prototype to usable real-player gameplay.

Scope:

- Transport, auth, secure entropy, timers, reconnect, persistence, table lifecycle, threat-model review, and site submission from authority.

Acceptance:

- Multiple authenticated humans can share a server-authoritative table with seat-private projections and durable verified records.

## 19. Ordered Codex Task List

1. Explicit Solo Match Scene Flow
   - Outcome: setup-first browser flow with setup, playing, between-hand, result, rematch, and abandonment.
   - Why next: current UI auto-creates a match and blocks coherent product feel.
   - Scope: React scene state and tests only; no export/import/site work.
   - Files likely: `src/ui/PokerTable.tsx`, `src/index.css`, `tests/ui/PokerTable.test.tsx`.
   - New files: optional small UI scene/helper test files.
   - Acceptance: no session before Start Match; heads-up/six-max still complete; validation and rematch flows tested.
   - Reasoning: High.
   - Alone: yes.
   - Parallel safe: no, it touches the core UI flow.
   - PO review: yes.

2. Setup Validation and Seed Lifecycle Hardening
   - Outcome: deterministic/random seed behavior is explicit and tested.
   - Why next: export/replay depends on stable resolved seeds.
   - Scope: validation helpers, error UI, resolved seed display.
   - Acceptance: invalid stacks/blinds/seeds blocked; random seed generated once at start.
   - Reasoning: Medium.
   - PO review: no unless defaults change.

3. Shared Position Helper and Projection
   - Outcome: BTN/SB/BB/UTG/HJ/CO labels are computed outside React.
   - Why next: table layout/export need stable positions.
   - Scope: helper/projection and tests for heads-up through six-handed with eliminations.
   - Acceptance: positions match rules contract and engine seat order.
   - Reasoning: High.
   - PO review: yes if naming/order changes.

4. Table Layout Refinement
   - Outcome: six-max seats arranged around one table.
   - Why next: makes existing six-max mode understandable.
   - Scope: CSS/React presentation only.
   - Acceptance: hero/opponents/board/actions hierarchy is clear on desktop/mobile.
   - Reasoning: Medium.

5. Hand Result and Showdown Presentation
   - Outcome: between-hand state explains folds, showdown, winners, pots, and elimination.
   - Why next: current hand completion is mostly event log text.
   - Scope: derived presentation from verified events.
   - Acceptance: folded, showdown, split/side-pot, and match-complete cases covered.
   - Reasoning: High.

6. NPC Pacing and Presentation Queue
   - Outcome: UI consumes canonical transitions as presentation steps.
   - Why next: improves readability without changing authority.
   - Scope: UI-only queue; no engine delay.
   - Acceptance: input locks correctly and events show in order.
   - Reasoning: High.

7. NPC Roster and Difficulty Config
   - Outcome: selectable named NPCs and difficulty presets for solo mode.
   - Why next: productizes existing policy without changing rules.
   - Scope: config, setup selection, tests.
   - Acceptance: independent RNG remains stable; policies submit legal commands.
   - Reasoning: Medium.

8. Canonical Completed-Session Export Schema
   - Outcome: documented and typed client package contract.
   - Why next: needed before site adapter.
   - Scope: types/docs/tests; no Supabase.
   - Acceptance: schema includes required fields and excludes secrets.
   - Reasoning: High.
   - PO review: yes.

9. Client Export Builder and JSON Download
   - Outcome: completed local sessions can be downloaded.
   - Why next: first integration bridge to site.
   - Scope: export from `LocalSoloSession` records.
   - Acceptance: deterministic fixture export, privacy tests.
   - Reasoning: High.

10. Para Site Package Import Preview
    - Outcome: site admin can preview a client package.
    - Why next: safe validation before writes.
    - Scope: site-only parser/validator; no client changes.
    - Acceptance: valid package preview, malformed/duplicate/privacy failures.
    - Reasoning: High.

11. Para Site Package Commit
    - Outcome: site maps validated package into Supabase rows transactionally.
    - Why next: turns client evidence into durable site records.
    - Scope: site adapter, idempotency, player mapping, import report.
    - Acceptance: session pages consume imported data.
    - Reasoning: High.

12. Site Consumption Compatibility Pass
    - Outcome: imported sessions feed session, player, standings, notable hand, and recap context correctly.
    - Why next: closes the client-to-site loop.
    - Scope: site read models and admin/public views.
    - Acceptance: imported fixture appears in existing surfaces.
    - Reasoning: High.

13. Automated Submission Design
    - Outcome: reviewed authenticated submission protocol.
    - Why next: automation after manual import is proven.
    - Scope: documentation and threat model update.
    - Acceptance: no browser service-role access; idempotent submission contract.
    - Reasoning: High.

14. Real Multiplayer Transport Prototype
    - Outcome: network transport around server authority.
    - Why next: after solo/export/site evidence path is stable.
    - Scope: server process, auth stub or chosen provider, WebSocket/HTTP boundary.
    - Acceptance: two remote humans, reconnect, spectator, no hidden leakage.
    - Reasoning: High.
    - PO/security review: yes.

## 20. Immediate Next Task

Task: Explicit Solo Match Scene Flow in `parapoker-official-client`.

Why it is highest value:

- The client already has engine, NPC, session, stats, and UI infrastructure, but it still auto-starts a game on load. A setup-first scene flow is the necessary product shell before export, import, or multiplayer work.

Complete one-task scope:

- Replace automatic session creation on initial load with an explicit setup scene.
- Add scene states for setup, playing, between-hand, and match result.
- Preserve `LocalSoloSession` as the session authority.
- Add setup validation, resolved seed display, same-seed rematch, new-random match, change setup, and abandon-active-match confirmation.
- Update UI tests for no-auto-create, setup-to-playing, between-hand/result, rematch, validation, and abandonment.

Must not include:

- Hand-history export.
- Para site importer.
- Supabase access.
- Networking.
- Accounts.
- New NPC strategy.
- Site pages.
- Persistent client profile/archive/standings systems.

Acceptance criteria:

- Browser initially shows setup only and creates no match until `Start Match`.
- Heads-up and six-max matches still play to completion.
- Completed result scene shows verified local summary.
- Active match abandonment requires confirmation.
- Same-seed and new-random rematch flows are explicit.
- React still does not own canonical poker state.
- `npm run test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run build` pass.

Recommended reasoning level: High.

Review gate: Product-owner review required after this task because it defines the user-facing match flow.

## Product-Owner Decisions Required

- Whether NPC-only solo sessions should be importable to the Para site, ignored, or marked exhibition/test.
- Whether unknown human participants in imported packages require admin mapping before publish.
- Whether optional Para player IDs can be attached in client setup before auth exists.
- Whether client public exports should include showdown-revealed cards only or any additional private owner export later.
- Whether starting-stack/blind defaults should remain 200/1/2 for product play.
- Whether micro all-in configs should be allowed in UI or test-only.
- When to introduce browser-local export cache, if ever.
- When manual import is sufficient versus authenticated automatic submission.
- Which modes are eligible for public site publication.

## Commands Run During Audit

Client repository:

- `git status --short --branch`
- `rg --files src tests docs package.json`
- `Get-Content` on key engine, NPC, controller, session, persistence, UI, docs, and tests files.
- `rg -n "describe\\(|it\\(" tests`

Site repository:

- `git status --short --branch`
- `git log --oneline -5`
- `rg --files .`
- `Get-Content` on key Supabase, raw import, hand-history, session view-model, public session page, admin import, SQL, and debug files.
- `rg` searches for session, hand, action, result, stats, player, standings, import, and Supabase usage.

