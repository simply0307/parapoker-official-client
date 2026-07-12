# ParaPoker Poker Rules Contract

Status: Draft for product-owner review.

This document defines the poker rules contract that future engine tests, replay, event schema, NPC policy, multi-seat expansion, and multiplayer work must follow. It is documentation only. It does not change production code.

The current implemented game is a heads-up fixed-blind freezeout match, structurally similar to a heads-up sit-and-go without blind increases. Future formats may share rule primitives, but they must not silently share lifecycle rules.

## 1. Governing Rules Authority

Default governing model for this draft:

- Product convention: ParaPoker Rules Contract v0.
- External reference baseline: common live no-limit Texas Hold'em rules as represented by major public poker-room rule conventions.
- Product-owner review required before this draft becomes binding.

Where external rules differ or are incomplete for the product, the ParaPoker convention in this document takes priority after product-owner approval.

Rule source labels:

- `External baseline`: should match common no-limit Hold'em practice.
- `ParaPoker convention`: explicitly chosen product behavior.
- `Unresolved`: product-owner decision still required.

## 2. Command and Amount Semantics

### Bet and Raise Amounts

Decision: ParaPoker convention.

Bet and raise command amounts mean the target total contribution for the current betting round, commonly described as "bet to" or "raise to", not "raise by".

Examples:

- Blinds are 1/2. A raise command with amount `6` means the player's street contribution becomes 6 total.
- If a player has already contributed 2 and raises to 8, the additional chips committed by that action are 6.

Rationale:

- This matches the current engine shape, where `bet` and `raise` amounts are target contributions.
- It is easier to validate legal action ranges in projections and future server requests.

Product-owner review:

- Confirm "raise to" as the user-facing and protocol convention.
- If the UI shows "raise by", it must convert to trusted internal "raise to" before engine submission.

### Internal Trusted Commands

Decision: ParaPoker convention.

The authoritative controller or server constructs trusted internal engine commands. Future untrusted clients must submit `PlayerActionRequest` messages, not trusted internal `EngineCommand` objects.

A future `PlayerActionRequest` should contain:

- Command ID.
- Table ID.
- Expected state version.
- Requested poker action and amount, if applicable.

The server binds authenticated connection to seat and constructs the internal command. Client-supplied seat IDs and action sources are never trusted.

## 3. Opening Bets, Raises, and Calls

### Minimum Opening Bet

Decision: External baseline plus ParaPoker convention.

The minimum opening bet is the big blind amount unless the acting player's remaining stack is smaller. A player with less than the minimum may move all-in for less.

Current heads-up default:

- Small blind: 1.
- Big blind: 2.
- Minimum opening bet: 2.

### Minimum Full-Raise Increment

Decision: External baseline.

The minimum full-raise increment is the size of the previous full bet or raise increment in the same betting round.

Examples:

- Blinds 1/2. Opening raise to 6 over a current bet of 2 is a raise increment of 4.
- The next full raise must increase the current bet by at least 4, so the minimum raise target is 10.

### Calls for Less

Decision: External baseline.

A player may call all-in for less than the full amount to call. This commits the player's entire remaining stack and marks the player all-in.

### A Player Cannot Commit More Than Their Stack

Decision: External baseline.

No accepted action may reduce a stack below zero. A submitted command attempting to overcommit must be rejected as illegal or invalid.

## 4. Short All-Ins and Reopening Action

### Short All-In Behavior

Decision: External baseline.

A short all-in may increase the amount that later players must call, but it does not count as a full raise unless it meets the minimum full-raise increment.

### Reopening Action

Decision: External baseline.

A player's raising option is reopened only by a full bet or full raise. A short all-in does not reopen raising for a player who has already acted in that betting round.

Examples:

- Current bet is 10 and minimum raise increment is 10.
- A player all-ins to 15. Prior actors may need to call 5, but they may not raise if they had already acted and no full raise occurred.
- If a player all-ins to 20 or more in that spot, the all-in is a full raise and prior actors may raise if otherwise eligible.

Product-owner review:

- Confirm that this reopening rule applies to all formats.

## 5. Uncalled Excess and Pot Construction

### Uncalled Excess

Decision: External baseline.

Only matched contributions are contestable. If one player contributes more than any opponent can match, the uncalled excess is returned to that player before pot awards are calculated.

### Main Pot and Side Pots

Decision: External baseline with ParaPoker implementation convention.

Pots should be constructed from contribution layers:

- Sort or layer all positive contributions.
- Each layer creates a pot from all players who contributed chips to that layer.
- Eligibility for a pot includes only players who have not folded and who contributed to that layer.
- Folded players' chips remain in pots but folded players are not eligible to win any pot.
- Single-player unmatched layers are returned as uncalled excess rather than awarded through showdown.

This contribution-to-pot construction must work for heads-up and later multiway side pots.

### Folded-Player Contribution Eligibility

Decision: External baseline.

Folded players' previous contributions remain in the pot. Folded players are never eligible to win the pot after folding.

## 6. Odd-Chip Assignment

Decision: ParaPoker convention, product-owner review required.

Proposed convention:

- In heads-up and multiway pots, odd chips are assigned to the first eligible winner clockwise from the dealer button.
- For multiple side pots, apply the same rule independently per pot.

Rationale:

- Deterministic.
- Works for replay and server authority.
- Matches the current product need for stable chip accounting.

Product-owner review:

- Confirm this convention or choose another external-room convention.

## 7. Heads-Up Button, Blinds, and Action Order

Decision: External baseline.

Heads-up rules:

- The button is the small blind.
- The non-button player is the big blind.
- Preflop, the button/small blind acts first.
- Postflop, the big blind acts first.

Current implemented format:

- Heads-up fixed-blind freezeout.
- One human and one NPC.
- Fixed blinds with no blind increases.
- Match ends when one player is eliminated.

## 8. Multi-Seat Button, Blinds, and Action Order

Decision: External baseline; not yet implemented.

For three or more active seats:

- The dealer button moves one eligible occupied seat clockwise after each completed hand.
- The small blind is the first eligible occupied seat clockwise from the button.
- The big blind is the next eligible occupied seat clockwise from the small blind.
- Preflop action starts with the first eligible occupied seat clockwise from the big blind, commonly under the gun.
- Postflop action starts with the first eligible active seat clockwise from the button.

Three-handed play must be validated before generic four-to-six-seat implementation because it exposes the assumptions hidden by heads-up:

- Dealer is no longer automatically the small blind.
- Under-the-gun exists.
- Preflop and postflop order differ.
- More than one opponent can remain active.
- Folded players may have contributed chips.
- Side-pot eligibility becomes meaningful.

## 9. Betting-Round Completion

Decision: External baseline.

A betting round completes when every non-folded, non-all-in player has either:

- Matched the current bet, or
- Checked when there is no bet to call,

and no full raise has reopened action for them.

A street must not advance while an eligible player still has a legal action pending.

If all remaining non-folded players are all-in, the hand automatically runs out remaining streets and settles.

If all but one player folds, the remaining player wins the pot uncontested.

## 10. Showdown, Reveal, and Muck Behavior

Decision: Unresolved for full product; current simplified convention below.

Current simplified convention:

- At showdown, non-folded players' hole cards are revealed for settlement.
- Folded players' hole cards are not revealed.
- Current event shape records revealed showdown cards.

Future product decision required:

- Whether a player may muck a losing hand at showdown.
- Whether all-in showdown cards are revealed immediately or only at settlement.
- What public spectators can see.
- What private hand-history owners can see.
- What retained records may store.

Proposed default:

- For deterministic replay and audit, the authoritative table may retain private cards in restricted records.
- Player-facing public history should reveal only cards exposed by the approved showdown/muck rules.

## 11. Burn-Card Modeling

Decision: Unresolved; current product behavior omits burns from the internal model.

Current implementation:

- No burn cards are modeled internally.
- Fixed decks provide only hole and community cards needed by the engine.

Product options:

- Continue omitting burn cards because the product is digital and burn cards do not affect player-visible game state.
- Model burn cards internally for closer live-poker convention and audit/replay fidelity.

Proposed default:

- Continue omitting burn cards for the current heads-up foundation.
- Reconsider before server-authoritative multiplayer audit design.

## 12. Format Lifecycle Rules

Formats must not silently share lifecycle behavior.

### Freezeout Matches

Decision: ParaPoker convention.

- Players begin with fixed starting stacks.
- No rebuys during the match.
- A player with zero chips is eliminated or out.
- The match ends when one player remains with chips.
- Current game: heads-up fixed-blind freezeout match.

### Sit-and-Go Tournaments

Decision: Unresolved.

Future sit-and-go modes require:

- Blind schedules.
- Level advancement rule, such as timed levels or hand-count levels.
- Elimination order.
- Prize/standing model if competitive formats use results.

### Cash-Style Tables

Decision: Unresolved.

Future cash-style modes require distinct lifecycle rules:

- Joins and leaves.
- Seat buy-ins.
- Possible rebuys or top-ups.
- Table stakes.
- Handling players sitting out.
- Hand boundaries for joins/leaves.

### League-Defined Competitive Formats

Decision: Unresolved.

League formats may define:

- Match length.
- Scoring.
- Blind structure.
- Allowed table size.
- Tie-breakers.
- Record retention.

## 13. Poker and Connection Status Separation

Decision: ParaPoker architecture convention.

Poker-engine statuses may include:

- Active.
- Folded.
- All-in.
- Eliminated or out.
- Sitting out between hands.
- Empty seat.

Controller or server connection statuses may include:

- Connected.
- Disconnected.
- Reconnecting.
- Timed out.
- Abandoned.

The pure poker engine must not own WebSocket or connection state. A controller or server must translate connection policy into poker consequences.

Possible policy translations:

- Check when checking is free.
- Fold when facing a bet.
- Consume a time bank.
- Remove a player after the hand.
- Allow an NPC substitute only in a specifically supported mode.

## 14. Replay Contract

Decision: ParaPoker convention; details to be implemented in Event Schema v1.

Deterministic replay must be based on:

- Rules contract version.
- Initial table configuration.
- Seed or explicit deck fixture for deterministic/test games.
- Ordered command stream.
- Ordered state-transition events with sequence numbers.

Timestamps may exist as observational metadata, but timestamps must not determine replay behavior.

Replay must be able to verify:

- Final stacks.
- Street progression.
- Community cards.
- Legal accepted actions.
- Rejected command behavior where recorded.
- Pot construction and awards.
- Revealed cards under approved visibility rules.

## 15. Event Contract Requirements

Decision: ParaPoker convention; must be finalized before NPC strategy and multi-seat implementation.

Event Schema v1 must include a stable envelope:

- Schema version.
- Stable event ID.
- Sequence number.
- Hand ID.
- Optional command correlation ID.
- Visibility scope.
- Event payload.

Visibility scopes must support:

- Public table events.
- Private seat events.
- Future spectator events.
- Future server/audit-only records.

Events must distinguish:

- Submitted commands.
- Accepted state-transition events.
- Rejected command errors.
- Controller/server observational metadata.

## 16. Randomness and Secrets

Decision: ParaPoker architecture convention.

Deterministic RNG is allowed for:

- Unit tests.
- Fixed-deck fixtures.
- Replay fixtures.
- NPC reproducibility.
- Simulation tests.

Live multiplayer must use server-side cryptographically secure randomness.

Live deck order, entropy, seeds, and RNG state remain accessible only to the authoritative table process during active play. Any audit retention must be encrypted, access-restricted, tamper-evident, and unavailable to players, operators, recap systems, and ordinary application logs. The product may retain derived verification records instead of raw live secrets.

Clients, NPC policies, recap systems, and ordinary application logs must never receive unauthorized live secrets.

## 17. Product-Owner Review Checklist

Before this contract is treated as binding, the product owner must review and decide:

- Governing external poker rules authority.
- Whether ParaPoker convention overrides any external rule in this document.
- Raise-to convention for engine, protocol, and UI.
- Minimum opening bet convention.
- Minimum full-raise increment convention.
- Short all-in and reopening-action rules.
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
- Default freezeout stacks and blinds.
- Tournament blind schedules.
- Cash-table join, leave, and rebuy lifecycle.
- League-format lifecycle and scoring rules.
- Disconnect and time-bank policy.
- First multi-seat target.
- Hand-history privacy and retention.
- Recap generation approach and grounding boundaries.

## 18. Implementation Gate

No further poker-engine rule work should proceed until:

- This contract is reviewed.
- Open product-owner decisions are either resolved or explicitly deferred.
- Any chosen external authority and ParaPoker overrides are recorded.
- The next task, the full hand-evaluator regression matrix, can cite this contract as its source of truth.
