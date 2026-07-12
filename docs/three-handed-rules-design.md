# Three-Handed Rules Design Gate

Status: mandatory review gate before generic multi-seat implementation.

This document records the first multi-seat rule target. It does not implement multi-seat poker. The current playable product remains a heads-up fixed-blind freezeout match.

## Source Of Truth

Rules come from `docs/poker-rules-contract.md`, especially:

- Section 5: uncalled excess, main pots, side pots, and folded-player eligibility.
- Section 6: odd-chip assignment.
- Section 8: multi-seat button, blinds, and action order.
- Section 9: betting-round completion.

## Three-Handed Target

For three active seats ordered clockwise as `human`, `npc-1`, `npc-2`:

- The dealer button starts on `human`.
- The small blind is the first eligible occupied seat clockwise from the button: `npc-1`.
- The big blind is the next eligible occupied seat clockwise from the small blind: `npc-2`.
- Preflop action starts with the first eligible occupied seat clockwise from the big blind: `human` as under the gun.
- Postflop action starts with the first active non-folded, non-all-in seat clockwise from the button: usually `npc-1`.

This differs from heads-up, where the button is also the small blind.

## Required Failing Tests

The test file `tests/poker-engine/threeHandedRules.test.ts` documents expected behavior with `it.fails` cases:

- Three-handed blind assignment and initial stacks.
- Three-handed preflop order, street progression, and postflop first actor.
- Folded-player contributions and side-pot eligibility.

These tests must be changed from expected failures to normal passing tests during the later `Generic Multi-Seat Engine Implementation` task.

## Review Gate

Do not begin generic four-to-six-seat implementation until product/engineering review confirms:

- Dealer, small blind, big blind, UTG, and postflop actor conventions.
- Whether this target seat ordering matches UI and fixture expectations.
- Folded-player contribution eligibility in multiway pots.
- Odd-chip assignment for multiway pots and side pots.
- Whether current freezeout elimination semantics are sufficient for three-handed solo tests.
