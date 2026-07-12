# Persistence and Para Identity Plan

Status: Draft implementation-planning document. Do not add a production database, account provider, durable storage service, or generated recap system until this plan is reviewed.

This document defines the intended persistence and player identity boundaries for ParaPoker. It preserves the current shared poker engine, server-authoritative table boundary, visibility-scoped projections, deterministic replay model, and Para presentation rule that recaps consume verified facts and derived statistics only.

## 1. Goals

- Define durable player, NPC, session, match, hand-history, and settings concepts.
- Separate account identity, table seat identity, NPC identity, and recap/persona presentation.
- Define privacy boundaries for public events, private seat events, server/audit-only records, derived statistics, and player-facing recaps.
- Define minimum persistence interfaces before selecting a database.
- Ensure persistence supports replay, exports, reconnect support, records, standings, and future Para presentation without exposing live secrets.

## 2. Non-Goals

- No production database selection.
- No account login, OAuth, password flow, or identity provider integration.
- No networking or deployment changes.
- No schema migration implementation.
- No generated narrative implementation.
- No real-money, payment, rake, compliance, or fraud systems.
- No storage of live deck order, entropy, seeds, or RNG state for ordinary product features.

## 3. Source of Truth

This plan depends on:

- `docs/poker-rules-contract.md`
- `docs/full-product-roadmap.md`
- `docs/multiplayer-protocol-threat-model.md`
- Event Schema v1 as implemented in the poker engine
- Current server-authoritative controller boundary under `src/table-controllers/server-authoritative/`

Poker rules remain owned by the poker engine and rules contract. Persistence records what happened; it must not decide legal actions, hand strength, shuffle, or settlement.

## 4. Identity Concepts

Use distinct identities for distinct responsibilities.

### Account Identity

Represents a real user account once accounts exist.

Examples:

- `accountId`
- Login credentials or external provider identity
- Account status
- Security settings
- Moderation flags

The poker engine must not know account identity.

### Player Profile Identity

Represents the player-facing persona attached to an account.

Examples:

- `playerId`
- Display name
- Avatar or visual preferences
- Region or locale preferences
- Public profile settings
- Private settings

One account may eventually own multiple profiles only if explicitly supported. Until then, assume one profile per account.

### Table Seat Identity

Represents a seat assignment at one table or match.

Examples:

- `tableId`
- `seatId`
- `playerId` or `npcId`
- Buy-in or starting stack for the format
- Seat lifecycle status outside the pure engine, such as sitting out or disconnected

Clients must never choose trusted seat identity. Server authority binds authenticated connections to seats.

### NPC Identity

Represents product-owned opponents and their presentation metadata.

Examples:

- `npcId`
- Display name
- Archetype
- Difficulty
- Visual profile
- Approved flavor/personality metadata
- Policy configuration reference

NPC identity and flavor must not alter poker rules. NPC poker decisions are governed by policy code and legal action projections, not by narrative systems.

### Session Identity

Represents a player's continuous play session.

Examples:

- `sessionId`
- `playerId`
- Started and ended timestamps
- Device or client metadata, if approved
- Tables joined
- Matches completed

Session records are useful for recaps, support, and analytics, but timestamps must not determine replay behavior.

## 5. Durable Record Types

Minimum future records:

- `PlayerProfile`
- `NpcProfile`
- `TableRecord`
- `MatchRecord`
- `HandRecord`
- `EventRecord`
- `CommandRecord`
- `SessionRecord`
- `PlayerSettings`
- `DerivedStatsSnapshot`
- `RecapRecord`
- `AuditVerificationRecord`

These are conceptual records, not database tables yet.

## 6. Match and Hand Records

Match records should store:

- Match ID.
- Format: freezeout, sit-and-go, cash-style table, or league-defined format.
- Rules contract version.
- Event schema version.
- Table size and seat assignments.
- Starting stacks and blinds or format-specific structure.
- Started and completed timestamps as observational metadata.
- Final status.
- Winner or final standings.
- Durable references to hand records and event streams.

Hand records should store:

- Hand ID.
- Match ID.
- Hand number.
- Button/dealer seat.
- Blind assignments.
- Initial stacks.
- Final stacks.
- Public board cards.
- Pot awards.
- Revealed cards according to approved showdown/muck rules.
- Durable references to public and private events.

Hand records should not store live deck order or RNG state for ordinary product features.

## 7. Event and Command Storage

Event storage must preserve Event Schema v1 or a reviewed successor.

Event records should include:

- Schema version.
- Stable event ID.
- Sequence number.
- Match ID.
- Hand ID.
- Table ID.
- Optional command correlation ID.
- Visibility scope.
- Event payload.
- Observational server timestamp.

Command records should include:

- Command ID.
- Table ID.
- Player ID or NPC controller ID.
- Trusted server-bound seat ID.
- Expected state version.
- Requested action payload.
- Accepted or rejected status.
- Rejection reason when applicable.
- Correlated event IDs for accepted commands.

Replay must be determined by initial config, rules contract version, seed or approved deck fixture for tests, command stream, and ordered events. Timestamps are observational only.

## 8. Visibility and Privacy Classes

Every durable event or derived record needs a privacy class.

Recommended classes:

- `public`: visible to all table participants and approved public/spectator consumers.
- `seatPrivate`: visible only to the authorized seat owner and approved restricted support/audit flows.
- `tablePrivate`: visible only to participants in that table, if a product mode needs it.
- `serverAudit`: restricted operational record, not player-facing.
- `derivedPublic`: derived statistics safe for public display.
- `derivedPrivate`: derived statistics visible only to the player.

Default rule:

If a record contains hole cards, private command timing, private settings, unrevealed cards, support notes, moderation data, or player identity metadata, it is not public.

## 9. Hand-History Access

Hand-history access must distinguish:

- Public hand history.
- Player's own private hand history.
- Opponent private hand history.
- Spectator history.
- Support/admin history.
- Audit or verification records.

Player-facing exports:

- A player may export public hand events and their own private seat events if product-owner approval allows it.
- A player must not export opponent unrevealed hole cards.
- A player must not export live secrets such as deck order, entropy, seeds, or RNG state.

Support access:

- Must be role-restricted.
- Must be logged.
- Must avoid exposing raw live secrets unless an approved audit process requires it.

## 10. Retention Policy Draft

Retention decisions remain product-owner decisions. Until decided, implement with minimization as the default.

Draft defaults:

- Public match summaries: retain long term.
- Public hand events: retain long term if storage cost is acceptable.
- Seat-private hand events: retain for the shortest period that supports player exports, support, and replay needs.
- Command rejections: retain for a limited support/debug window.
- Session metadata: retain only what is needed for account security, support, and product analytics.
- Raw audit secrets: do not retain by default.
- Derived statistics: retain long term if they do not contain hidden game information.
- Recaps: retain according to player settings and deletion policy.

Deletion policy must define how account deletion interacts with competitive records, public match records, and audit obligations.

## 11. Randomness and Audit Records

Live deck order, entropy, seeds, and RNG state remain accessible only to the authoritative table process during active play. Any audit retention must be encrypted, access-restricted, tamper-evident, and unavailable to players, operators, recap systems, and ordinary application logs. The product may retain derived verification records instead of raw live secrets.

Persistence must never make live secrets available to:

- Browser clients.
- Ordinary logs.
- Recap systems.
- Player exports.
- General operator dashboards.
- NPC policies.

If audit verification is required, prefer derived verification records that prove integrity without retaining raw live secrets.

## 12. Para Presentation Inputs

Para presentation systems may consume:

- Verified public game facts.
- The player's own authorized private events.
- Derived statistics.
- Player profile metadata.
- NPC profile metadata.
- Match and session summaries.

Para presentation systems must not consume:

- Live deck order.
- Entropy.
- Seeds.
- RNG state.
- Opponent unrevealed private cards.
- Server-only audit secrets.
- Unverified client claims.

Generated or templated recaps must separate:

- Verified facts.
- Derived statistics.
- Interpretive commentary.
- Fictional flavor.

Recaps must never invent game facts.

## 13. Minimum Persistence Interfaces

Before selecting a database, introduce small interfaces that can be implemented in memory for tests.

Suggested interfaces:

```ts
interface MatchRecordStore {
  createMatch(record: MatchRecordDraft): Promise<MatchRecord>
  appendHand(record: HandRecordDraft): Promise<HandRecord>
  completeMatch(matchId: string, result: MatchResultDraft): Promise<MatchRecord>
  getMatch(matchId: string): Promise<MatchRecord | undefined>
}

interface EventRecordStore {
  appendEvents(events: EventRecordDraft[]): Promise<void>
  listPublicEvents(matchId: string): Promise<EventRecord[]>
  listSeatEvents(matchId: string, seatId: string): Promise<EventRecord[]>
}

interface ProfileStore {
  getPlayerProfile(playerId: string): Promise<PlayerProfile | undefined>
  updatePlayerSettings(playerId: string, settings: PlayerSettingsPatch): Promise<PlayerProfile>
  getNpcProfile(npcId: string): Promise<NpcProfile | undefined>
}

interface StatsStore {
  updateFromVerifiedEvents(matchId: string): Promise<DerivedStatsSnapshot[]>
  getPlayerStats(playerId: string): Promise<DerivedStatsSnapshot | undefined>
}
```

The exact TypeScript names can change during implementation. The boundary is the important part: persistence receives verified records and events, not raw mutable engine state.

## 14. Storage Selection Criteria

Choose a storage system only after requirements are reviewed.

Required capabilities:

- Durable event and match storage.
- Privacy-scoped event reads.
- Queryable profiles, sessions, summaries, and standings.
- Transactional append or equivalent consistency for match/event writes.
- Migration support.
- Backup and recovery.
- Deletion and retention workflows.
- Access control for private hand history.
- Support for replay/export.
- Tamper-evident verification records if audit requirements demand them.

Do not choose storage based only on familiarity or convenience.

## 15. Implementation Sequence

Recommended order:

1. Review this plan and resolve product-owner decisions.
2. Add in-memory persistence interfaces and tests.
3. Persist match summaries from the in-memory server authority prototype.
4. Persist public and seat-private event records through visibility-scoped stores.
5. Add replay/export tests from stored records.
6. Add player and NPC profile stores.
7. Add derived statistics from verified events.
8. Add recap input builders that consume only authorized facts and derived stats.
9. Select production storage after interface and privacy tests are stable.
10. Implement database-backed stores and migrations.

## 16. Required Tests Before Production Storage

Persistence tests:

- Match summary can be created and completed.
- Public events can be appended and replayed in order.
- Seat-private events are visible only to the authorized seat owner.
- Opponent unrevealed cards never appear in another player's export.
- Event sequence order survives storage and reload.
- Rejected command records do not mutate replay state.
- Derived stats are reproducible from verified events.

Privacy tests:

- Public history excludes private hole-card events.
- Player private history includes only that player's private events.
- Spectator history excludes seat-private events.
- Recap inputs exclude live secrets and unauthorized private cards.
- Ordinary logs or exported records do not contain deck order, seeds, entropy, or RNG state.

Identity tests:

- Authenticated player resolves to a profile.
- Profile resolves to a trusted seat only through server authority.
- NPC profile metadata does not alter poker rules.
- Deleted or disabled accounts cannot join new tables.

## 17. Product-Owner Decisions

Required decisions:

- Which account identity provider or auth model to use.
- Whether one account may have multiple player profiles.
- Display-name uniqueness and moderation policy.
- Default player profile visibility.
- Default hand-history retention period.
- Whether players can export their own private hand histories.
- Whether support can inspect private hand histories and under what role controls.
- Whether raw audit secrets are ever retained.
- How account deletion affects public match records and competitive standings.
- Whether recaps are templated, generated, human-authored, or hybrid.
- Whether players can opt out of recap storage or profile statistics.
- NPC identity and flavor boundaries.

## 18. Review Gate

Do not implement production persistence until:

- Product-owner privacy and retention decisions are recorded.
- Event Schema v1 is stable enough for durable storage.
- Replay from stored events is tested.
- Profile and hand-history access rules are tested.
- Security review approves private-history and audit access boundaries.

## 19. Next Implementation Task

After review, the next implementation task should be:

Add in-memory persistence interfaces and tests for match summaries, visibility-scoped event storage, and replay/export reads.

Recommended reasoning level: High.
