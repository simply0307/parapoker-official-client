# First Playable Poker Architecture

This repository started as an empty Git repo. The first playable milestone uses Vite, React, TypeScript, npm, and Vitest, with the poker rules kept independent from React and any future networking layer.

## Architecture

- `src/poker-engine/` owns canonical serializable poker state, legal action calculation, action application, hand history, projections, deterministic deck handling, betting rounds, showdown, and settlement.
- `src/npc/` owns code-driven player policies. NPC code receives only a private seat projection and submits the same engine commands as a human.
- `src/table-controllers/local-single-player/` owns the milestone table authority. It stores canonical engine state locally, advances NPC turns, and exposes projections to React.
- `src/ui/` renders browser state and submits commands. React state is never canonical poker state.
- `src/shared/` contains utilities that are not poker-specific, currently deterministic RNG helpers.
- `tests/` covers engine behavior, visibility, NPC legality, local controller flow, and UI smoke behavior.

## Server-Authoritative Future

The engine is designed so a future multiplayer table service can own the exact same `GameState` and call the same `applyAction` API. Clients should receive only `getPublicView` and `getSeatView` projections, never raw `GameState`, deck order, opponent hole cards, or RNG state.

The first milestone intentionally does not implement networking, accounts, lobbies, persistence services, real-money features, or multiplayer infrastructure.

## Locked Milestone Defaults

- Heads-up No-Limit Texas Hold'em.
- One human seat and one NPC seat.
- Starting stack: 200 chips.
- Small blind: 1 chip.
- Big blind: 2 chips.
- Fixed blinds, no blind increases.
- No burn cards in the internal model.
- Odd chip assignment starts from the dealer/button seat.

## Public Engine API

- `createGame(config)` creates serializable match state.
- `startNextHand(state)` posts blinds, shuffles/deals, and starts a hand.
- `getLegalActions(state, seatId)` returns legal actions only for the pending actor.
- `applyAction(state, command)` validates and applies a shared human/NPC command.
- `getPublicView(state)` returns table-safe public information.
- `getSeatView(state, seatId)` returns public information plus that seat's private cards and legal actions.
- `replayCommands(state, commands)` replays deterministic command sequences for tests and fixtures.

## Invariants

- No duplicate cards.
- No negative stacks.
- Chips are conserved.
- Only the pending actor may act.
- Folded and all-in seats cannot act.
- Illegal commands return structured errors and preserve state.
- Streets do not advance while action remains pending.
- Hidden cards, deck order, and RNG state are absent from client projections.
- Every accepted command produces hand-history events.
- Engine state remains JSON-serializable.
