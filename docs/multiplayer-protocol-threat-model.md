# Multiplayer Protocol and Threat Model

Status: Draft architecture document. Do not implement server infrastructure from this document until it has been reviewed.

This document defines the intended future multiplayer boundary for ParaPoker. It preserves the current shared poker engine, local solo controller, trusted internal `EngineCommand` gateway, public/private projections, deterministic replay model, and hidden-information protections.

It does not add networking, accounts, persistence, server code, database schemas, production deployment, or UI changes.

## 1. Goals

- Define the future client-to-server poker action boundary.
- Prevent client-authoritative assumptions from entering the product.
- Preserve reuse of the shared poker engine on an authoritative server.
- Specify projection, event, idempotency, state-version, timer, reconnect, and audit expectations before server implementation.
- Identify threats and required mitigations for real-player multiplayer.

## 2. Non-Goals

- No WebSocket, HTTP, lobby, authentication, persistence, database, or deployment implementation.
- No changes to `EngineCommand`, `GameState`, projections, tests, UI, or NPC policy.
- No real-money, payments, wagering, rake, compliance, or fraud systems.
- No final production security review. This is an implementation-planning artifact.

## 3. Source of Truth

This document depends on:

- `docs/poker-rules-contract.md`
- `docs/full-product-roadmap.md`
- `docs/first-playable-architecture.md`
- Current engine API exported by `src/poker-engine/index.ts`

Rules semantics come from the Poker Rules Contract. Protocol semantics in this document must not silently override poker rules.

## 4. Authority Model

The multiplayer server owns canonical table state.

Authoritative server responsibilities:

- Own canonical `GameState` for each active table.
- Own live deck order, entropy, seeds, and RNG state.
- Bind authenticated connections to player accounts and table seats.
- Validate state version, turn ownership, idempotency, and poker legality.
- Construct trusted internal `EngineCommand` objects.
- Call the shared engine APIs.
- Emit ordered events and visibility-scoped projections.
- Apply timer, disconnect, sitting-out, and table-lifecycle policies outside the pure poker engine.

Client responsibilities:

- Render public and private projections.
- Display legal actions received through projections.
- Submit action requests.
- Treat the server as the table authority.

The client must never own canonical poker state in multiplayer.

## 5. Internal and External Commands

The internal `EngineCommand` remains a trusted server-side command shape. It may be used by:

- The poker engine.
- The local single-player controller.
- A future server-authoritative table process.
- Server-owned NPC seat controllers.

An untrusted human client must not directly submit an internal `EngineCommand`.

Future network boundary:

- A human client submits a `PlayerActionRequest`.
- The request contains a command ID, table ID, expected state version, and requested poker action.
- The client does not choose or assert its trusted seat identity.
- The client does not choose its action source.
- The authoritative server binds the authenticated connection to a seat.
- The server constructs the internal `EngineCommand`.
- The server validates turn ownership, legality, idempotency, and state version.

Client-supplied seat IDs and action sources must never be trusted.

## 6. PlayerActionRequest

Draft request envelope:

```ts
interface PlayerActionRequest {
  protocolVersion: 'parapoker-multiplayer-v1'
  commandId: string
  tableId: string
  expectedStateVersion: number
  requestedAction: RequestedPokerAction
}
```

Draft requested action union:

```ts
type RequestedPokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }
```

Amount convention:

- `bet.amount` and `raise.amount` mean target street contribution, also described as "bet to" or "raise to".
- The server must validate the requested amount against current legal actions.
- UI copy may display alternate wording only if it converts to the protocol's raise-to convention before submission.

Rejected request examples:

- Unknown table ID.
- Unauthenticated connection.
- Connection not seated at that table.
- Duplicate command ID with conflicting payload.
- Stale or future expected state version.
- Action not available to the bound seat.
- Amount outside the legal action range.
- Malformed protocol version or payload.

## 7. Server Command Construction

For every accepted `PlayerActionRequest`, the server constructs the internal command.

Construction algorithm:

1. Authenticate the connection.
2. Resolve `tableId` to an authoritative table process.
3. Resolve the connection's trusted player identity.
4. Resolve the identity to a trusted seat assignment for the table.
5. Validate `commandId` idempotency for that table, player, and state version.
6. Validate `expectedStateVersion`.
7. Fetch the bound seat's current legal actions from the engine projection or engine API.
8. Validate that the requested action matches one legal action.
9. Construct `EngineCommand` with server-owned `seatId`, server-owned `source`, and the client command ID as correlation metadata.
10. Apply the command through the engine.
11. Persist or buffer resulting ordered events according to the event and retention policy.
12. Increment state version and send new projections/events to authorized recipients.

Draft internal construction:

```ts
const command: EngineCommand = {
  ...validatedRequestedAction,
  seatId: trustedSeatId,
  source: 'human',
  commandId: request.commandId,
}
```

The server, not the client, supplies `trustedSeatId` and `source`.

## 8. State Versions

Every authoritative table state should have a monotonic `stateVersion`.

State-version rules:

- Increment after each accepted state transition.
- Do not increment for rejected malformed requests.
- Rejected legal-intent requests may be recorded as observational command errors, but they must not change poker state.
- Projection messages include the state version they describe.
- `PlayerActionRequest.expectedStateVersion` protects against stale UI actions.

Stale request behavior:

- If the command ID has already been accepted, return the original accepted result or current projection without applying again.
- If the request is stale and not previously accepted, reject with a structured version conflict.
- The client should refresh from the latest projection and ask the player to choose again if necessary.

## 9. Idempotency

Each player action request must contain a stable `commandId`.

Idempotency requirements:

- `commandId` must be unique per table and player connection context.
- Retain command IDs at least for the lifetime of the hand and reconnection window.
- A repeated identical command ID returns the same accepted or rejected result.
- A repeated command ID with a different payload is rejected as an idempotency conflict.
- Accepted command IDs correlate to event `commandId` values.

Idempotency is required because clients may retry after transport failures.

## 10. Server Messages

Draft server-to-client message families:

```ts
type ServerMessage =
  | ProjectionMessage
  | EventMessage
  | CommandAckMessage
  | CommandRejectedMessage
  | TimerMessage
  | ConnectionPolicyMessage
```

Projection message:

```ts
interface ProjectionMessage {
  type: 'projection'
  tableId: string
  stateVersion: number
  publicView: PublicTableView
  privateSeatView?: PrivateSeatView
}
```

Event message:

```ts
interface EventMessage {
  type: 'events'
  tableId: string
  stateVersion: number
  events: HandHistoryEvent[]
}
```

Command acknowledgement:

```ts
interface CommandAckMessage {
  type: 'commandAccepted'
  tableId: string
  commandId: string
  stateVersion: number
}
```

Command rejection:

```ts
interface CommandRejectedMessage {
  type: 'commandRejected'
  tableId: string
  commandId?: string
  stateVersion: number
  reason: string
  retryable: boolean
}
```

These shapes are draft contracts. Exact TypeScript types should be introduced only when server work begins.

## 11. Projections and Visibility

Projection rules:

- Public table viewers receive `PublicTableView` only.
- A seated player receives `PublicTableView` plus their own `PrivateSeatView`.
- A player never receives another seat's private hole cards unless those cards are revealed by approved showdown or all-in reveal rules.
- Spectators receive public or delayed spectator projections only.
- Server/audit-only records are not client projections.

Never expose through client projections:

- Deck order.
- Undealt cards.
- Opponent hidden hole cards.
- Live entropy.
- Seeds.
- RNG state.
- Server-only audit secrets.
- Trusted connection-to-seat binding internals.

Projection objects sent over the network should be treated as immutable snapshots. Clients may cache them for rendering, but they do not become canonical state.

## 12. Event and Replay Model

Multiplayer event delivery must use Event Schema v1 or a reviewed successor.

Event envelope requirements:

- Schema version.
- Stable event ID.
- Sequence number.
- Hand ID.
- Optional command correlation ID.
- Visibility scope.
- Event payload.

Replay rules:

- Sequence numbers and accepted commands determine deterministic replay.
- Timestamps may be observational metadata, but timestamps must not determine replay behavior.
- The server may emit command rejection records for synchronization and support, but rejected requests must not mutate poker state.
- Private events must be delivered only to authorized recipients.

Event stream consumers:

- Table clients.
- Reconnect synchronization.
- Replay tools.
- Persistence.
- Para recap systems.
- Audit and support tools.

Para recap systems consume verified game facts and derived statistics only. They must not receive live deck order, seeds, entropy, RNG state, or unauthorized private cards.

## 13. Timers and Disconnect Policy

Poker status and connection status remain separate.

Poker-engine concepts may include:

- Active.
- Folded.
- All-in.
- Eliminated or out.
- Sitting out between hands.
- Empty seat.

Server connection concepts may include:

- Connected.
- Disconnected.
- Reconnecting.
- Timed out.
- Abandoned.

The pure poker engine must not own WebSocket or connection state.

Timer policy is a controller/server concern:

- Each pending actor receives an action deadline.
- A time bank may extend the deadline if available.
- Timer updates are observational server messages, not poker events unless a timeout creates a poker action.
- The server must be the timer authority.
- Client clocks must never determine whether an action is accepted.

Default timeout translation proposal:

- If checking is free, submit a server-constructed check.
- If facing a bet, submit a server-constructed fold.
- If the player disconnects between hands, mark them sitting out or remove them according to the format policy.
- NPC substitution is allowed only in explicitly supported modes and must be announced as a controller policy, not hidden inside poker rules.

These choices require product-owner approval before implementation.

## 14. Reconnection and Synchronization

Reconnect flow:

1. Authenticate the returning connection.
2. Bind the player identity to the existing table seat if eligible.
3. Send the latest authorized projection.
4. Send missed visible events after the client's last acknowledged event sequence, if available.
5. Send current timer and connection-policy status.
6. Preserve idempotency records so retried commands are not double-applied.

Reconnection must not reveal:

- Missed private events for other seats.
- Deck order or RNG state.
- Unrevealed cards outside the reconnecting player's authorization.

If event retention is unavailable for the requested reconnect window, the server may send a fresh projection plus a synchronization notice rather than replaying every event.

## 15. NPCs in Multiplayer Tables

NPC seats in server-authoritative multiplayer must follow the same trusted internal gateway as humans.

Rules:

- NPC policy receives only the NPC seat's `PrivateSeatView`, legal actions, read-only table memory, policy config, and independent policy RNG.
- NPC table memory remains outside canonical poker rules state.
- The server constructs the NPC's internal `EngineCommand`.
- NPC decisions must be deterministic in tests and must not use live deck secrets.
- Each NPC receives an independent RNG stream. Changing one NPC's number of random decisions must not alter another NPC's future decision sequence.

An NPC may coexist with real human seats only when the product mode explicitly supports mixed tables.

## 16. Randomness and Audit

Live multiplayer deck shuffling must use cryptographically secure server-side randomness.

Required live-secret rule:

Live deck order, entropy, seeds, and RNG state remain accessible only to the authoritative table process during active play. Any audit retention must be encrypted, access-restricted, tamper-evident, and unavailable to players, operators, recap systems, and ordinary application logs. The product may retain derived verification records instead of raw live secrets.

Operational requirements:

- Never log live deck order, entropy, seeds, or RNG state in ordinary logs.
- Never include live secrets in crash reports, analytics, recaps, support exports, or client messages.
- Restrict any audit secret retention to a small, reviewed system boundary.
- Prefer derived verification records when raw secret retention is not required.

## 17. Threat Model

### Protected Assets

- Canonical table state.
- Live deck order and undealt cards.
- Seat-private hole cards.
- Player identity and seat binding.
- Command ordering and legal action integrity.
- Event stream integrity.
- Hand-history privacy.
- RNG entropy and state.
- Audit records.

### Attacker Types

- Malicious player controlling their own browser.
- Player replaying, delaying, duplicating, or modifying requests.
- Player attempting to impersonate another seat.
- Player trying to infer hidden cards from protocol data, logs, timing, or errors.
- Colluding players sharing authorized private information.
- Disconnected or unstable client accidentally retrying commands.
- Curious operator or support workflow with excessive log access.
- Compromised client build or browser extension.

### Required Mitigations

Client tampering:

- Treat every client request as untrusted.
- Never accept client-supplied seat IDs or action sources.
- Validate all actions against server-side legal actions.

Replay and duplicate submission:

- Require command IDs.
- Enforce idempotency.
- Validate expected state version.

Out-of-turn action:

- Server verifies trusted seat binding and pending actor.
- Engine remains the final legality gate.

Hidden-information leakage:

- Send only visibility-scoped projections.
- Filter events by recipient.
- Keep deck, seeds, entropy, RNG state, and opponent private cards server-side.

Transport loss:

- Use idempotent retries.
- Reconnect from state version and visible event sequence.

Timer abuse:

- Use server-authoritative timers.
- Ignore client clock assertions.
- Apply timeout policy server-side.

Operator and log leakage:

- Avoid raw secret logging.
- Restrict audit access.
- Encrypt and tamper-evidence retained audit secrets if retention is approved.

Collusion:

- Server authority cannot prevent all authorized information sharing.
- Future anti-collusion systems should analyze verified events and derived statistics.
- Do not expose extra private data in an attempt to support recaps, spectators, or debugging.

## 18. Structured Errors

Future protocol errors should be structured enough for clients to recover without exposing secrets.

Draft categories:

- `AUTH_REQUIRED`
- `TABLE_NOT_FOUND`
- `NOT_SEATED`
- `STATE_VERSION_CONFLICT`
- `DUPLICATE_COMMAND`
- `IDEMPOTENCY_CONFLICT`
- `NOT_PENDING_ACTOR`
- `ACTION_NOT_LEGAL`
- `INVALID_AMOUNT`
- `TABLE_CLOSED`
- `RATE_LIMITED`
- `MALFORMED_REQUEST`
- `SERVER_ERROR`

Error messages must not reveal hidden cards, deck state, RNG state, other players' private actions, or server internals.

## 19. Privacy and Retention

Hand-history privacy must distinguish:

- Public events visible to all table participants and future spectators.
- Private seat events visible to the authorized seat.
- Server/audit-only records.
- Derived statistics.
- Player-facing recaps.

Retention decisions still required:

- How long public hand histories are retained.
- How long private hand histories are retained.
- Whether players can export private hand histories.
- Whether support staff can view private histories.
- Whether raw audit secrets are retained at all.
- How deletion requests interact with competitive records and audit obligations.

Until these decisions are made, server implementation should minimize retained private data and avoid retaining live secrets.

## 20. Required Tests Before Server Implementation

Protocol tests:

- Client cannot set trusted seat ID.
- Client cannot set action source.
- Stale state version is rejected.
- Duplicate command ID is idempotent.
- Duplicate command ID with different payload is rejected.
- Out-of-turn action is rejected.
- Illegal amount is rejected.
- Accepted action increments state version.

Projection tests:

- Public projection excludes hidden cards and live secrets.
- Seat projection includes only that seat's private cards.
- Spectator projection excludes all private seat cards.
- Reconnect projection obeys visibility rules.

Event tests:

- Events are sequence ordered.
- Command IDs correlate accepted actions to events.
- Private events are delivered only to authorized recipients.
- Replay ignores timestamps.

Timer and disconnect tests:

- Server timeout checks when free.
- Server timeout folds when facing a bet.
- Disconnected status does not enter pure poker engine state.
- Reconnected player receives only authorized missed events.

Security tests:

- Malformed requests do not throw uncaught server errors.
- Request floods are rate limited.
- Logs do not contain deck order, seeds, entropy, RNG state, or unrevealed opponent cards.

## 21. Review Gate

This document must be reviewed before server-authoritative multiplayer implementation starts.

Review checklist:

- Product owner approves timeout and disconnect translations.
- Product owner approves spectator visibility.
- Product owner approves hand-history privacy and retention direction.
- Engineering approves `PlayerActionRequest` and server message envelope direction.
- Engineering approves state-version and idempotency behavior.
- Engineering approves secret-handling and audit posture.
- Security review confirms the threat model is sufficient for a play-money multiplayer prototype.

## 22. Next Implementation Task

After review, the next roadmap task is the Server Authority Prototype.

Recommended scope:

- In-memory authoritative table service.
- Server-side command validation.
- Projection delivery boundary.
- No persistence unless separately approved.
- No public multiplayer launch.

Recommended reasoning level: High.
