# ParaPoker Full Product Roadmap

## 1. Current Repository Assessment

The repository is no longer greenfield. It is a Vite React TypeScript application with a playable browser-based, play-money heads-up No-Limit Texas Hold'em match.

Current tooling:

- Framework: Vite, React, TypeScript.
- Package manager: npm.
- Tests: Vitest, jsdom, Testing Library.
- Linting: Oxlint.
- Scripts: `npm run dev`, `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run preview`.

Important modules:

- Poker engine: `src/poker-engine/engine.ts`
- Domain types: `src/poker-engine/types.ts`
- Cards and shuffle: `src/poker-engine/cards.ts`
- Hand evaluator: `src/poker-engine/handEvaluator.ts`
- Deterministic RNG: `src/shared/rng.ts`
- NPC policy: `src/npc/basicNpc.ts`
- Local solo table authority: `src/table-controllers/local-single-player/LocalSinglePlayerController.ts`
- Browser table UI: `src/ui/PokerTable.tsx`
- Engine tests: `tests/poker-engine/engine.test.ts`, `tests/poker-engine/hardening.test.ts`, `tests/poker-engine/cards.test.ts`

Confirmed working:

- A heads-up fixed-blind freezeout match, structurally similar to a heads-up sit-and-go without blind increases.
- Serializable canonical poker state.
- Shared trusted internal command gateway through `EngineCommand`.
- Legal-action calculation and action application.
- Deterministic seeded shuffle and fixed-deck tests.
- Public and seat-private projections.
- Local single-player controller that owns canonical state outside React.
- Basic NPC policy that submits legal engine commands from a seat projection.
- Hand evaluation and showdown settlement.
- Hardened unequal all-ins, uncalled excess, short all-ins, blind all-ins, projection immutability, and fixed-deck validation.

Implemented but under-tested:

- Best-five selection across all seven-card evaluator edge cases.
- Multiway contribution-to-pot construction beyond targeted regression coverage.
- Odd-chip assignment across multiple pots.
- Generic-looking seat order functions outside heads-up.
- Deterministic replay as a formal contract.

Prototype-only:

- Basic NPC strategy.
- Browser table presentation.
- Hand-history text display.
- Controller pacing and error recovery.

Future-facing boundary only:

- Server-authoritative multiplayer.
- Persistence and player identity.
- Para recaps, records, standings, and presentation systems.
- Secure live-game randomness.

Not implemented:

- Accounts, networking, lobbies, databases, matchmaking, cash-table joins/leaves/rebuys, tournament blind schedules, anti-cheat, real-money features, multi-seat UI, real poker NPC strategy, or generated narrative systems.

## 2. Architecture Assessment

The current architecture has the right core shape and should be preserved incrementally.

Stable boundaries:

- The poker engine owns canonical poker state, rules, deck, legal actions, action application, hand history, projections, and settlement.
- `EngineCommand` is the trusted internal command gateway used by humans, NPCs, and future server code.
- `getPublicView` and `getSeatView` are the client-facing visibility boundary.
- `LocalSinglePlayerController` is the local authority for solo mode and is a useful model for a future server table service.
- NPC policies receive only seat-appropriate projections and legal actions.
- React state stores rendered snapshots and UI controls, not canonical poker state.

Boundaries needing refinement:

- A formal poker rules contract must precede further rules work.
- Replay semantics need a stable contract from initial config, seed or deck fixture, command stream, and ordered events.
- Event schema must become versioned and stable before NPC strategy, multi-seat work, persistence, or recaps depend on it.
- Multi-seat dealer, blind, and action-order rules should be designed through three-handed tests before generic six-max implementation.
- Engine extraction should be conditional. `engine.ts` should be split only after regression coverage exists and only where modules such as betting, pots, progression, or projections reduce rule complexity.

The current architecture still supports future server-authoritative multiplayer because clients do not need direct access to canonical state, deck order, opponent private cards, seeds, or RNG state.

## 3. Product Modes and Shared Components

The product should support several distinct modes on a shared poker foundation.

Shared components:

- Card model, deck model, hand evaluator, legal-action calculation, action application, betting progression, pot construction, showdown, projections, and event/replay contracts.
- Internal trusted command gateway for all authoritative execution.
- Visibility-scoped projections for public, private seat, and future spectator views.

Mode-specific components:

- Solo NPC mode: local table controller, NPC policy orchestration, local pacing, solo settings.
- Multi-NPC solo tables: multiple NPC controllers, table memory per NPC, multi-seat UI.
- Human multiplayer tables: server table authority, network protocol, authentication, reconnection, timers, secure randomness.
- Mixed human/NPC tables: server or local authority assigns controllers per seat while all actions still flow through the same trusted engine gateway.
- Spectators: public or delayed spectator projections only.
- Replay and hand-history consumers: deterministic replay, records, debug tools, recaps, and audit consumers.
- Para records, recaps, profiles, and standings: verified event and derived-stat consumers only.

Future formats must remain distinct:

- Freezeout matches.
- Sit-and-go tournaments with blind schedules.
- Cash-style tables with joins, leaves, and possible rebuys.
- League-defined competitive formats.

These formats may share rules primitives, but they must not be assumed to share lifecycle rules.

## 4. Poker Foundation Roadmap

The first priority remains a trustworthy poker foundation. Networking, accounts, persistence, and narrative systems should wait until rules, replay, events, and NPC gameplay are stronger.

Immediate foundation work:

- Create `docs/poker-rules-contract.md` as a documentation-only task and mandatory product-owner review gate.
- Complete a full hand-evaluator regression matrix.
- Complete a heads-up betting-round regression suite.
- Harden deterministic replay from config, seed or deck fixture, command stream, and event sequence.
- Establish Event Schema v1 before NPC strategy and multi-seat implementation.
- Add invariant and randomized legal-game simulations.

The Poker Rules Contract must eventually define:

- Whether bet and raise amounts mean "raise to" or "raise by".
- Minimum opening bet.
- Minimum full-raise increment.
- Short all-in behavior.
- Whether and when action is reopened.
- Uncalled excess handling.
- Main-pot and side-pot construction.
- Folded-player contribution eligibility.
- Odd-chip assignment.
- Heads-up button and blind rules.
- Multi-seat blind assignment.
- Preflop action order.
- Postflop action order.
- Showdown reveal and muck behavior.
- Burn-card modeling.
- Freezeout, tournament, and cash-table lifecycle differences.
- Which external poker ruleset or explicitly chosen product convention governs each rule.

Required before the current heads-up milestone can be considered trusted:

- Complete evaluator coverage.
- Betting-round table tests for min raises, full raises, short all-ins, blind all-ins, and street completion.
- Replay determinism.
- Chip-conservation invariants after accepted actions and completed hands.
- Projection leakage tests for public and private views.

Required before multi-seat or multiplayer launch:

- Three-handed rules validation.
- Generic four-to-six-seat simulations.
- Multiway side pots and folded-player contribution tests.
- Multi-seat blind/button movement.
- Multi-seat preflop and postflop action order.
- Empty seat, sitting out, eliminated, folded, and all-in semantics.
- Format-specific lifecycle rules for freezeout, tournament, cash, and league modes.

## 5. NPC Poker Roadmap

The current `BasicNpcPolicy` is a legal baseline, not a real poker opponent. It should become one policy among several.

Introduce an explicit NPC decision context:

- `PrivateSeatView`
- Legal actions
- Policy configuration
- Read-only table memory
- Policy RNG

Each NPC must receive an independent RNG stream. Changing one NPC's number of random decisions must not alter another NPC's future decision sequence. NPC table memory must remain separate from canonical poker rules state.

Incremental NPC stages:

1. Legal baseline policy: never submits illegal actions and consumes only a seat projection.
2. Preflop hand classification: pair, broadway, suitedness, connectors, dominated hands.
3. Position and effective stack awareness.
4. Pot odds and price-to-call.
5. Postflop made-hand strength.
6. Draw detection: flush draws, open-ended straight draws, gutshots, overcards.
7. Board texture: paired boards, monotone boards, connected boards, high-card pressure.
8. Bet sizing: value sizes, protection sizes, bluff sizes, all-in thresholds.
9. Value betting and folding thresholds.
10. Bluffing and semi-bluffing with controlled randomness.
11. Opponent tendency tracking in read-only table memory.
12. Personality parameters and multiple NPC archetypes.
13. Difficulty levels and exploitability versus fairness tuning.

Postflop decisions should account for made-hand strength, draw potential, board texture, effective stacks, pot odds, bet size, position, and either lightweight equity approximation, deterministic Monte Carlo, or documented hand-strength and potential heuristics.

Do not use an LLM for poker action selection.

Minimum acceptable "real poker NPC" milestone:

- Deterministic under seeded tests.
- Folds weak hands to bad prices.
- Calls reasonable prices with playable hands and draws.
- Value bets strong hands.
- Uses simple, legal bet sizing.
- Has at least two distinguishable archetypes.
- Never sees hidden opponent cards.

## 6. Solo Table and Player Experience Roadmap

The current UI is playable but prototype-quality. It should remain subordinate to engine correctness and NPC strategy.

Current UI elements that can remain:

- Table layout with two seats.
- Community cards and hole cards.
- Legal-action buttons.
- Basic bet/raise slider.
- Pot and stack display.
- Hand-history list.
- Next-hand flow.

Temporary or incomplete elements:

- Showdown presentation.
- Hand result summary.
- Chip movement and pot breakdown.
- Error recovery.
- NPC pacing.
- Mobile layout.
- Accessibility.
- New match/settings flow.
- Debug and developer views.
- Mode selection.

Solo experience roadmap:

- Improve table readability and turn indication.
- Make chip, street contribution, total pot, and side-pot display clearer.
- Improve bet sizing controls without changing engine semantics.
- Present showdown, muck/reveal, and hand result using verified events.
- Add controlled NPC pacing that never drives canonical state.
- Add keyboard and screen-reader affordances.
- Add developer views for projections, legal actions, and event streams.

## 7. Multi-Seat Expansion Plan

Do not jump directly from heads-up implementation to six-max product. Use staged validation.

Progression:

1. Heads-up correctness.
2. Three-handed rules validation.
3. Generic four-to-six-seat simulations.
4. Six-max solo table and UI.

Three-handed play is the mandatory review gate because it exposes the important assumptions:

- Dealer is no longer automatically the small blind.
- Under-the-gun exists.
- Preflop and postflop order differ.
- Folded players may have contributed chips.
- Side-pot eligibility becomes meaningful.
- More than one opponent remains active.

Current heads-up shortcuts to remove or isolate:

- Button is always small blind.
- Big blind is always the only opponent.
- Postflop first actor is simply the seat after the dealer.
- UI assumes one opponent region.
- Tests mostly assume two seats.

Multi-seat implementation needs:

- Generic seat ordering.
- Dealer/button movement.
- Small blind and big blind assignment.
- Under-the-gun preflop action order.
- Postflop first active seat after button.
- Multiple NPC controllers.
- Side pots.
- Eliminations.
- Empty seats.
- Seat joins between hands.
- Mixed human/NPC seats.
- Table configuration.

Six-max remains the first major multi-seat product target after three-handed rules validation and generic simulations pass.

## 8. Multiplayer Architecture Plan

Do not implement multiplayer infrastructure until the rules, replay, and event schema are stable.

Future network boundary:

- A human client submits a `PlayerActionRequest`.
- The request contains a command ID, table ID, expected state version, and requested poker action.
- The client does not choose or assert its trusted seat identity.
- The client does not choose its action source.
- The authoritative server binds the authenticated connection to a seat.
- The server constructs the internal `EngineCommand`.
- The server validates turn ownership, legality, idempotency, and state version.

Client-supplied seat IDs and action sources must never be trusted.

Server responsibilities:

- Own canonical table state.
- Own secure live-game randomness.
- Validate command ordering and legal actions.
- Emit versioned public/private/spectator projections.
- Deliver events over WebSocket or an equivalent realtime channel.
- Handle reconnection, idempotency, state synchronization, turn timers, and disconnect policy.
- Maintain table lifecycle separate from lobby, matchmaking, authentication, and persistence boundaries.
- Produce audit records without exposing live secrets.

Poker status and connection status must remain separate.

Poker-engine concepts may include:

- Active.
- Folded.
- All-in.
- Eliminated or out.
- Sitting out between hands.
- Empty seat.

Controller or server concepts may include:

- Connected.
- Disconnected.
- Reconnecting.
- Timed out.
- Abandoned.

The pure poker engine must not own WebSocket or connection state. The controller or server translates connection policy into poker actions or table changes, such as:

- Check when checking is free.
- Fold when facing a bet.
- Consume a time bank.
- Remove the player after the hand.
- Optionally allow an NPC substitute in a specifically supported mode.

## 9. Randomness Plan

Current seeded RNG is appropriate for tests, fixtures, deterministic replays, and NPC reproducibility. It is not appropriate for live multiplayer deck shuffling.

Use deterministic RNG for:

- Unit tests.
- Fixed-deck fixtures.
- Replay fixtures.
- NPC reproducibility.
- Simulation tests.

Use cryptographically secure server-side randomness for:

- Live multiplayer deck shuffling.
- Any future mode where players can gain value from predicting cards.

Live deck order, entropy, seeds, and RNG state remain accessible only to the authoritative table process during active play. Any audit retention must be encrypted, access-restricted, tamper-evident, and unavailable to players, operators, recap systems, and ordinary application logs. The product may retain derived verification records instead of raw live secrets.

Clients must never receive deck order, opponent private cards, seeds, entropy, or RNG state through projections, logs, recaps, or protocol messages.

## 10. Hand History, Replay, and Event Model

The current event model is useful for UI display and debugging, but it is not yet sufficient for deterministic replay, multiplayer synchronization, durable records, recaps, standings, spectators, or auditability.

Event Schema v1 must move earlier than NPC strategy and multi-seat implementation.

The stable event envelope should include:

- Schema version.
- Stable event ID.
- Sequence number.
- Hand ID.
- Optional command correlation ID.
- Visibility scope.
- Event payload.

Sequence numbers and commands must determine deterministic replay. Timestamps may exist as observational metadata added by a controller or server, but timestamps must not determine replay behavior.

The event model should distinguish:

- Submitted commands.
- Accepted state-transition events.
- Rejected command errors.
- Private seat events.
- Public table events.
- Future spectator events.

Before Para recaps rely on events:

- Event schema must be versioned.
- Replay from initial state and command/event stream must be deterministic.
- Visibility rules must be tested.
- Event retention and privacy policy must be decided.
- Derived statistics must be reproducible from verified events.

## 11. Persistence and Player Identity

Persistence should wait until rules, replay, and events stabilize.

Later persistence boundaries must support:

- Accounts.
- Player profiles.
- NPC identities.
- Match records.
- Sessions.
- Hand histories.
- Achievements.
- Standings.
- Competitive seasons.
- Settings.
- Moderation and administration.

Do not select a database merely because it is familiar. Required capabilities should be defined first:

- Durable event and match storage.
- Privacy-scoped access to private hand histories.
- Queryable session and standings summaries.
- Replay/export support.
- Schema migrations.
- Tamper-evident audit or verification records where needed.
- Deletion and retention controls.

## 12. Para Presentation Layer

The Para player-facing layer must sit above the poker engine. It must never contaminate rules, legal actions, hand evaluation, shuffle, or NPC poker decisions.

It may consume:

- Verified game facts.
- Derived statistics.
- Stable public/private event streams.
- Player and NPC profile metadata.

It must separate:

- Verified facts: actions, stacks, revealed cards, pots, winners.
- Derived statistics: aggression, showdown frequency, fold-to-bet patterns.
- Interpretive commentary: grounded summaries of what happened.
- Fictional flavor: NPC identity, voice, and presentation that cannot alter game facts.

Roadmap capabilities:

- Immediate match recap.
- Player-specific recap.
- Session archive.
- Player dossier.
- Notable hands.
- Standings movement.
- NPC identity and flavor.
- Public versus private copy.
- Thin-data fallbacks.

Generated text, if introduced later, must have approval and grounding boundaries. Recap systems must never invent game facts.

## 13. Testing Strategy

Current meaningful coverage:

- Deck uniqueness and deterministic shuffle.
- Heads-up hand start, blinds, and initial actor.
- Projection visibility and immutability.
- Illegal action rejection without state mutation.
- Uncontested pots.
- Showdown smoke test.
- Replay smoke test.
- Unequal all-ins, uncalled excess, short all-ins, blind all-ins, and fixed-deck validation.
- Basic NPC legal-action test.
- Local controller smoke test.
- UI render smoke test.

Highest-risk tests before further feature work:

- Full hand-evaluator regression matrix.
- Heads-up betting-round regression suite.
- Replay contract hardening.
- Event Schema v1 tests.
- Invariant and randomized legal-game simulations.
- Three-handed failing tests before multi-seat implementation.

Testing hierarchy:

- Pure unit tests.
- Table-driven rules tests.
- Deterministic fixed-deck tests.
- Replay tests.
- Invariant tests.
- Randomized simulation tests.
- NPC legality tests.
- NPC behavioral tests.
- Controller tests.
- Projection leakage tests.
- UI interaction tests.
- Future multiplayer protocol tests.
- End-to-end match tests.

The full hand-evaluator regression suite must cover:

- High card.
- One pair.
- Two pair.
- Trips.
- Straight.
- Wheel straight.
- Flush.
- Full house.
- Quads.
- Straight flush.
- Wheel straight flush.
- Kicker comparisons.
- Exact ties.
- Board plays.
- Double-paired boards.
- Two possible full houses.
- Two possible trips.
- Best five suited cards from six or seven suited cards.
- Highest available straight selection.
- Quads with kicker comparison.
- Tied hands using only the board.
- Hole cards that do not improve the board.
- Seven-card cases where the visually obvious five cards are not the best hand.

## 14. Milestones

### Milestone A: Poker Rules and Replay Contract

Deliverables:

- `docs/poker-rules-contract.md`.
- Replay contract definition.
- Event Schema v1 design.
- Product-owner decisions captured or explicitly marked unresolved.

Acceptance criteria:

- Rules semantics are explicit before further engine changes.
- Replay inputs and outputs are defined.
- Event envelope is stable enough for tests and future records.

Postponed:

- Production code changes.
- NPC strategy.
- Multi-seat implementation.
- Persistence and networking.

### Milestone B: Trusted Heads-Up Foundation

Deliverables:

- Full evaluator regression matrix.
- Heads-up betting-round regression suite.
- Invariant and randomized legal-game simulations.
- Production fixes only where tests reveal defects.

Acceptance criteria:

- Heads-up fixed-blind freezeout match is trusted under deterministic tests.
- Chip conservation, legal action, projection, and replay invariants hold.

Postponed:

- Real NPC strategy.
- UI polish.
- Multi-seat.

### Milestone C: Real Poker NPC

Deliverables:

- NPC decision context.
- Independent NPC RNG streams.
- Preflop and postflop heuristic policies.
- Deterministic behavioral tests.

Acceptance criteria:

- NPC behaves like a basic poker opponent rather than a random legal-action bot.
- NPC never sees hidden information and never submits illegal actions.

Postponed:

- Dialogue, LLM action selection, long-term narrative memory.

### Milestone D: Polished Solo Heads-Up Mode

Deliverables:

- Better table readability, controls, result presentation, NPC pacing, accessibility, mobile support, new match flow, and debug/developer views.

Postponed:

- Multi-seat gameplay and multiplayer.

### Milestone E: Three-Handed and Generic Multi-Seat Engine

Deliverables:

- Three-handed rules design and failing tests.
- Generic four-to-six-seat simulations.
- Multi-seat dealer, blind, action-order, side-pot, and elimination support.

Postponed:

- Six-max UI until engine tests pass.

### Milestone F: Six-Max Solo Mode

Deliverables:

- Six-max solo table with multiple NPC seats.
- Multi-seat UI and multiple NPC controller orchestration.

Postponed:

- Real-player networking.

### Milestone G: Multiplayer Server Foundation

Deliverables:

- Multiplayer protocol and threat-model document.
- Server-authoritative table service plan.
- Secure randomness plan.
- Projection/event delivery design.

Postponed:

- Public multiplayer launch.

### Milestone H: Real-Player Multiplayer Mode

Deliverables:

- Authenticated human players at shared tables.
- Reconnection, timers, idempotency, state-version validation, spectator projections.

Postponed:

- Persistent competitive seasons and rich recaps unless required for launch.

### Milestone I: Persistent Para Player Layer

Deliverables:

- Accounts, profiles, match/session records, hand-history retention, settings, and NPC identities.

Postponed:

- League systems and generated recaps unless storage/event privacy is stable.

### Milestone J: Competitive, Recap, and Production Readiness

Deliverables:

- Standings, seasons, recaps, notable hands, moderation/admin, observability, security hardening, anti-cheat posture, deployment readiness.

Postponed:

- Any real-money functionality.

## 15. Ordered Codex Task List

1. Poker Rules Contract
   - Outcome: Create `docs/poker-rules-contract.md`.
   - Scope: Documentation only.
   - Dependencies: Current roadmap.
   - Acceptance: Defines all required rules-contract topics and unresolved product choices.
   - Tests required: None.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Not safe before review.
   - Gate: Mandatory product-owner review.

2. Full Hand-Evaluator Regression Matrix
   - Outcome: Exhaustive evaluator test coverage for categories and seven-card best-five selection.
   - Scope: Tests first; production fixes only if tests reveal bugs.
   - Dependencies: Poker Rules Contract review.
   - Likely files: `src/poker-engine/handEvaluator.ts`, `tests/poker-engine/*`.
   - Acceptance: Covers all evaluator cases listed in the testing strategy.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Safe only with documentation tasks.

3. Heads-Up Betting-Round Regression Suite
   - Outcome: Locked heads-up betting semantics.
   - Scope: Legal actions, raise-to semantics, minimum raises, short all-ins, full raises, blind all-ins, and street completion.
   - Dependencies: Poker Rules Contract.
   - Acceptance: Table-driven tests pass and capture selected product conventions.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Not safe with engine refactors.

4. Replay Contract Hardening
   - Outcome: Reconstruct final state and event sequence from initial config, seed or deck fixture, and command stream.
   - Scope: Replay tests and minimal API refinement if needed.
   - Dependencies: Rules contract and betting regressions.
   - Acceptance: Deterministic replay fixtures pass.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Limited.

5. Event Schema v1
   - Outcome: Stable event envelope.
   - Scope: Schema version, stable event ID, sequence number, hand ID, command correlation ID, visibility scope, event payload.
   - Dependencies: Replay contract.
   - Acceptance: Events support deterministic replay and visibility-scoped consumers.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Not safe.
   - Gate: Mandatory architecture review.

6. Invariant and Randomized Legal-Game Simulations
   - Outcome: Deterministic simulation coverage.
   - Scope: Chip conservation, card uniqueness, valid pending actor, legal-action completion, no hidden-information leakage.
   - Dependencies: Event Schema v1.
   - Acceptance: Seeded simulations pass reliably.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Not safe with rule changes.

7. Conditional Engine Module Extraction
   - Outcome: Reduce rule complexity only where coverage supports it.
   - Scope: Potential extraction of betting, pots, progression, or projections modules; preserve public API and `src/poker-engine/index.ts`.
   - Dependencies: Regression and simulation coverage.
   - Acceptance: No behavior change and all tests pass.
   - Reasoning: Medium.
   - Batching: Alone.
   - Parallel work: Not safe with engine changes.

8. Real NPC v1 Preflop Strategy
   - Outcome: Deterministic preflop poker behavior.
   - Scope: Hand classes, position, effective stacks, pot odds, policy config, independent RNG streams.
   - Dependencies: Event Schema v1 and stable projections.
   - Acceptance: Behavioral fixtures and legality tests pass.
   - Reasoning: Medium.
   - Batching: May batch with NPC config types.
   - Parallel work: Safe with UI-only work.

9. Real NPC v1 Postflop Strategy
   - Outcome: Basic postflop poker behavior.
   - Scope: Made-hand strength, draws, board texture, effective stacks, bet size, position, lightweight equity approximation or documented heuristics.
   - Dependencies: Preflop strategy.
   - Acceptance: Deterministic postflop behavioral tests pass.
   - Reasoning: High.
   - Batching: Alone.
   - Parallel work: Limited.

10. Solo Heads-Up UX Pass
    - Outcome: Better solo table usability without changing engine semantics.
    - Scope: Controls, status, showdown, result presentation, pacing, accessibility, mobile.
    - Dependencies: Trusted heads-up and basic real NPC.
    - Acceptance: UI interaction tests and existing engine tests pass.
    - Reasoning: Medium.
    - Batching: May batch with CSS.
    - Parallel work: Safe with docs.

11. Three-Handed Rules Design and Failing Tests
    - Outcome: Mandatory multi-seat review gate.
    - Scope: Dealer/blind assignment, UTG, preflop/postflop order, folded contributions, side-pot eligibility.
    - Dependencies: Trusted heads-up.
    - Acceptance: Failing tests document intended three-handed behavior.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Not safe with multi-seat implementation.
    - Gate: Mandatory review.

12. Generic Multi-Seat Engine Implementation
    - Outcome: Four-to-six-seat engine support.
    - Scope: Generic ordering, blinds, action progression, pots, eliminations, empty seats.
    - Dependencies: Three-handed review gate.
    - Acceptance: Three-handed tests and four-to-six-seat simulations pass.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Not safe.

13. Six-Max Solo Mode
    - Outcome: Six-max solo play with NPC seats.
    - Scope: Multi-seat UI and multiple NPC controller orchestration.
    - Dependencies: Generic multi-seat engine and NPC policies.
    - Acceptance: Six-max deterministic matches and UI smoke/interaction tests pass.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Limited.

14. Multiplayer Protocol and Threat-Model Document
    - Outcome: Documentation before server implementation.
    - Scope: `PlayerActionRequest`, projections, event messages, idempotency, state versions, auth-seat binding, timers, reconnection, anti-cheat assumptions.
    - Dependencies: Event Schema v1 and multi-seat engine direction.
    - Acceptance: Product/architecture review complete.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Safe with solo UX after review.

15. Server Authority Prototype
    - Outcome: In-memory authoritative table service.
    - Scope: Server-side command validation and projection delivery; no persistence unless separately approved.
    - Dependencies: Multiplayer protocol document.
    - Acceptance: Protocol tests pass.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Not safe.

16. Real-Player Multiplayer Mode
    - Outcome: Multiple authenticated humans at one table.
    - Scope: Connection binding, timers, reconnect, spectator projections, mixed human/NPC seats.
    - Dependencies: Server authority prototype.
    - Acceptance: End-to-end multiplayer tests pass.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Not safe.

17. Persistence and Para Identity
    - Outcome: Durable player and match layer.
    - Scope: Accounts, profiles, hand histories, sessions, settings.
    - Dependencies: Stable event schema and privacy decisions.
    - Acceptance: Records replay and privacy tests pass.
    - Reasoning: High.
    - Batching: Alone.
    - Parallel work: Limited.

18. Competition, Recaps, and Production Readiness
    - Outcome: Player-facing long-term product systems.
    - Scope: Standings, seasons, recaps, notable hands, moderation/admin, observability, security.
    - Dependencies: Persistence and stable verified events.
    - Acceptance: Product acceptance tests and operational checks pass.
    - Reasoning: High.
    - Batching: Break into smaller tasks before execution.
    - Parallel work: Depends on subsystem boundaries.

## 16. Risk Register

| Risk | Severity | Immediacy | Mitigation |
| --- | --- | --- | --- |
| Incorrect poker rules | High | Immediate | Poker Rules Contract, table-driven tests, review gates |
| Hidden-information leakage | High | Immediate | Projection tests, no raw state to clients, server-bound secrets |
| Client-authoritative assumptions | High | Medium | `PlayerActionRequest` boundary and server-constructed `EngineCommand` |
| Hand-history schema instability | High | Immediate | Event Schema v1 before NPC, multi-seat, persistence, recaps |
| Production RNG misuse | High | Medium | Separate deterministic test RNG from secure live server RNG |
| NPC predictability | Medium | Medium | Independent RNG streams, archetypes, behavior tests |
| NPC illegality | High | Medium | NPC decisions constrained by legal actions and engine validation |
| Non-reproducible bugs | High | Immediate | Seeded simulations and replay fixtures |
| Overengineering multiplayer too early | Medium | Immediate | Rules/replay/events first |
| Multi-seat rewrite risk | High | Medium | Three-handed gate before generic multi-seat |
| Narrative inventing facts | High | Later | Para layer consumes verified facts and derived stats only |
| Persistence too early | Medium | Later | Delay storage choices until event schema and privacy decisions stabilize |
| Cheating and collusion | High | Later | Threat model, server authority, secure randomness, audit policy |

## 17. Product-Owner Decisions

These decisions must be made before or during the Poker Rules Contract and revisited only through explicit versioned rule changes.

- Governing external poker rules authority: choose an external reference ruleset or explicitly define ParaPoker product conventions where references differ.
- Raise-to convention: confirm that bet and raise amounts in APIs and UI mean "raise to" unless the product owner chooses otherwise.
- Odd-chip convention: define who receives odd chips for heads-up and multiway pots.
- Burn-card modeling: decide whether burns are modeled internally, shown in logs, retained for replay, or omitted.
- Showdown reveal and muck behavior: define when cards are revealed, when mucking is allowed, and what each projection may show.
- Default freezeout stacks and blinds: lock default starting stack, small blind, big blind, and whether a match ends at elimination.
- Tournament blind schedules: define whether sit-and-go modes use timed, hand-count, or level-based increases.
- Disconnect and time-bank policy: decide time banks, forced check/fold behavior, sitting out, abandonment, and possible NPC substitution modes.
- First multi-seat target: confirm three-handed validation first and six-max as the first major multi-seat product target.
- Hand-history privacy and retention: define what private/public events are stored, who can access them, how long they persist, and what can be exported.
- Recap generation approach: choose templated, human-authored, generated, or hybrid recaps, with verified-fact grounding boundaries.

## 18. Recommended Immediate Next Step

Exact next implementation task:

Create `docs/poker-rules-contract.md` through a documentation-only Codex task.

Why it is next:

The rules contract locks the semantics that every later test, event, replay, NPC, multi-seat, and multiplayer task depends on. It prevents silent drift in raise semantics, showdown behavior, pot rules, format lifecycles, and replay expectations.

What must not be included:

- Production code.
- Tests.
- Dependencies.
- Networking.
- Server code.
- NPC logic.
- UI work.
- Event schema implementation.

Acceptance criteria:

- The document defines every required rules-contract topic from this roadmap.
- It identifies the governing external poker rules authority or explicit ParaPoker convention for each rule.
- It distinguishes freezeout, sit-and-go tournament, cash-table, and league lifecycle rules.
- It ends with a product-owner review checklist.

Recommended reasoning level:

High.

Review requirement:

Mandatory product-owner review before the hand-evaluator regression task begins.
