import { describe, expect, it } from 'vitest'
import type { EngineCommand, HandHistoryEvent } from '../../src/poker-engine'
import {
  buildArchivedHandRecord,
  HAND_HISTORY_ARCHIVE_SCHEMA_VERSION,
  type ArchivedParticipant,
  type ArchivedSessionDetail,
} from '../../src/persistence'
import {
  deriveNpcStrategyEvidence,
} from '../../src/npc/npcObservedStrategyStats'
import {
  LOCAL_NPC_STRATEGY_PROFILES,
  localNpcDefinitionForSeat,
} from '../../src/npc/roster'
import {
  createSixMaxSoloConfig,
  LocalSinglePlayerController,
  type LocalSinglePlayerTransition,
} from '../../src/table-controllers/local-single-player/LocalSinglePlayerController'

describe('observed NPC strategy statistics', () => {
  it('derives version-pinned public behavior metrics from completed archives', () => {
    const detail = archiveDetail('observed-match', syntheticHands())
    const first = deriveNpcStrategyEvidence([detail])
    const second = deriveNpcStrategyEvidence([structuredClone(detail)])
    const evidence = first.find((sample) => sample.profileId === 'strategy-balanced-caller-v4')

    expect(first).toEqual(second)
    expect(evidence).toEqual(expect.objectContaining({
      schemaVersion: 'npc-observed-strategy-v1',
      profileVersion: 4,
      handCount: 2,
      matchIds: ['observed-match'],
    }))
    expect(evidence?.metrics['preflop.vpip']).toEqual({ value: 1, opportunities: 2, successes: 2 })
    expect(evidence?.metrics['preflop.openRaise']).toEqual({ value: 1, opportunities: 2, successes: 2 })
    expect(evidence?.metrics['preflop.foldToThreeBet']).toEqual({ value: 0.5, opportunities: 2, successes: 1 })
    expect(evidence?.metrics['proactive.bet']).toEqual({ value: 1, opportunities: 2, successes: 2 })
    expect(evidence?.metrics['proactive.barrel']).toEqual({ value: 1, opportunities: 1, successes: 1 })
    expect(JSON.stringify(first)).not.toMatch(/holeCards|deck|entropy|rngState/i)
  })

  it('aggregates deterministic six-max hands produced by the real NPC controller', () => {
    const first = runSixMaxEvidence('observed-six-max')
    const second = runSixMaxEvidence('observed-six-max')

    expect(first).toEqual(second)
    expect(first.length).toBe(5)
    expect(first.every((sample) => sample.handCount >= 8)).toBe(true)
    expect(first.every((sample) => (sample.metrics['preflop.vpip']?.opportunities ?? 0) >= 8)).toBe(true)
    expect(first.some((sample) => (sample.metrics['proactive.continuationBet']?.opportunities ?? 0) > 0)).toBe(true)
  })
})

function runSixMaxEvidence(seed: string) {
  const controller = new LocalSinglePlayerController(createSixMaxSoloConfig({
    seed,
    startingStack: 500,
    smallBlind: 1,
    bigBlind: 2,
  }))
  const publicEvents = new Map<string, HandHistoryEvent>()
  record(controller.consumeInitialTransition(), publicEvents)
  let safety = 0

  while (completedHandCount(publicEvents) < 12 && controller.getSnapshot().canonicalStatus !== 'complete') {
    safety += 1
    if (safety > 500) throw new Error('Six-max observed behavior simulation exceeded safety limit.')
    const snapshot = controller.getSnapshot()
    if (snapshot.canonicalStatus === 'handInProgress' && snapshot.heroView.pendingSeatId === snapshot.heroView.heroSeatId) {
      record(controller.submitHumanAction(humanCommand(snapshot.heroView.legalActions.map((action) => action.type))), publicEvents)
    } else if (snapshot.canonicalStatus !== 'complete') {
      record(controller.startNextHand(), publicEvents)
    }
  }

  const events = [...publicEvents.values()]
  const handNumbers = [...new Set(events.filter((event) => event.type === 'potAwarded').map((event) => event.handId))]
  const hands = handNumbers.map((handNumber) => buildArchivedHandRecord({
    matchId: seed,
    tableId: `${seed}:table`,
    handNumber,
    publicEvents: events,
    completedAt: '2026-07-16T00:00:00.000Z',
  }))
  return deriveNpcStrategyEvidence([archiveDetail(seed, hands)])
}

function record(transition: LocalSinglePlayerTransition, events: Map<string, HandHistoryEvent>): void {
  for (const event of transition.events) {
    if (event.visibility === 'public') events.set(event.eventId, event)
  }
}

function completedHandCount(events: Map<string, HandHistoryEvent>): number {
  return [...events.values()].filter((event) => event.type === 'potAwarded').length
}

function humanCommand(actions: EngineCommand['type'][]): Omit<EngineCommand, 'seatId' | 'source'> {
  if (actions.includes('check')) return { type: 'check' }
  if (actions.includes('call')) return { type: 'call' }
  if (actions.includes('fold')) return { type: 'fold' }
  return { type: 'allIn' }
}

function syntheticHands() {
  const first = [
    event(1, 1, 'handStarted', { dealerSeatId: 'npc-1', participantSeatIds: ['npc-1', 'npc-2'] }),
    event(1, 2, 'blindPosted', { seatId: 'npc-1', blind: 'small', amount: 1 }),
    event(1, 3, 'blindPosted', { seatId: 'npc-2', blind: 'big', amount: 2 }),
    event(1, 4, 'actionApplied', { seatId: 'npc-1', action: 'raise', amount: 5, targetContribution: 6 }),
    event(1, 5, 'actionApplied', { seatId: 'npc-2', action: 'raise', amount: 16, targetContribution: 18 }),
    event(1, 6, 'actionApplied', { seatId: 'npc-1', action: 'call', amount: 12, targetContribution: 18 }),
    event(1, 7, 'streetAdvanced', { street: 'flop', communityCards: [] }),
    event(1, 8, 'actionApplied', { seatId: 'npc-2', action: 'check', amount: 0, targetContribution: 0 }),
    event(1, 9, 'actionApplied', { seatId: 'npc-1', action: 'bet', amount: 18, targetContribution: 18 }),
    event(1, 10, 'actionApplied', { seatId: 'npc-2', action: 'call', amount: 18, targetContribution: 18 }),
    event(1, 11, 'streetAdvanced', { street: 'turn', communityCards: [] }),
    event(1, 12, 'actionApplied', { seatId: 'npc-2', action: 'check', amount: 0, targetContribution: 0 }),
    event(1, 13, 'actionApplied', { seatId: 'npc-1', action: 'bet', amount: 36, targetContribution: 36 }),
    event(1, 14, 'actionApplied', { seatId: 'npc-2', action: 'fold', amount: 0, targetContribution: 0 }),
    event(1, 15, 'potAwarded', { winners: [{ seatId: 'npc-1', amount: 108 }] }),
  ]
  const second = [
    event(2, 1, 'handStarted', { dealerSeatId: 'npc-2', participantSeatIds: ['npc-1', 'npc-2'] }),
    event(2, 2, 'blindPosted', { seatId: 'npc-2', blind: 'small', amount: 1 }),
    event(2, 3, 'blindPosted', { seatId: 'npc-1', blind: 'big', amount: 2 }),
    event(2, 4, 'actionApplied', { seatId: 'npc-1', action: 'raise', amount: 4, targetContribution: 6 }),
    event(2, 5, 'actionApplied', { seatId: 'npc-2', action: 'raise', amount: 17, targetContribution: 18 }),
    event(2, 6, 'actionApplied', { seatId: 'npc-1', action: 'fold', amount: 0, targetContribution: 6 }),
    event(2, 7, 'potAwarded', { winners: [{ seatId: 'npc-2', amount: 24 }] }),
  ]
  return [archivedHand('observed-match', 1, first), archivedHand('observed-match', 2, second)]
}

function event(handId: number, sequenceNumber: number, type: HandHistoryEvent['type'], payload: unknown): HandHistoryEvent {
  return {
    schemaVersion: 'poker-event-v1',
    eventId: `hand-${handId}-event-${sequenceNumber}`,
    sequenceNumber,
    handId,
    visibility: 'public',
    type,
    payload,
  } as HandHistoryEvent
}

function archivedHand(matchId: string, handNumber: number, orderedPublicEvents: HandHistoryEvent[]) {
  return {
    schemaVersion: HAND_HISTORY_ARCHIVE_SCHEMA_VERSION,
    matchId,
    tableId: `${matchId}:table`,
    handId: `hand-${handNumber}`,
    handNumber,
    dealerSeatId: handNumber === 1 ? 'npc-1' : 'npc-2',
    participantSeatIds: ['npc-1', 'npc-2'],
    orderedPublicEvents,
    board: [],
    actions: [],
    potAwards: [],
    revealedCards: {},
    completedAt: '2026-07-16T00:00:00.000Z',
  }
}

function archiveDetail(matchId: string, hands: ReturnType<typeof archivedHand>[]): ArchivedSessionDetail {
  const participants: ArchivedParticipant[] = hands[0]?.participantSeatIds.length === 2
    ? [
        { seatId: 'npc-1', displayName: 'Maven', kind: 'npc', npcDefinitionId: 'npc-maven', npcStrategyProfileId: 'strategy-balanced-caller-v4', npcStrategyProfileVersion: 4 },
        { seatId: 'npc-2', displayName: 'Rook', kind: 'npc', npcDefinitionId: 'npc-rook', npcStrategyProfileId: 'strategy-pressure-raiser-v4', npcStrategyProfileVersion: 4 },
      ]
    : sixMaxParticipants()
  return {
    session: {
      schemaVersion: HAND_HISTORY_ARCHIVE_SCHEMA_VERSION,
      matchId,
      tableId: `${matchId}:table`,
      status: 'export-ready',
      mode: participants.length > 2 ? 'six-max' : 'heads-up',
      visibility: 'private',
      sourceAuthority: 'local-browser',
      blueprintId: `${matchId}:blueprint`,
      blueprintName: 'Observed strategy fixture',
      rulesContractVersion: 'para-poker-rules-v0',
      eventSchemaVersion: 'poker-event-v1',
      startingStack: 500,
      blinds: { smallBlind: 1, bigBlind: 2 },
      participants,
      handCount: hands.length,
      startedAt: '2026-07-16T00:00:00.000Z',
    },
    hands,
    privateHands: [],
  }
}

function sixMaxParticipants(): ArchivedParticipant[] {
  return ['npc-1', 'npc-2', 'npc-3', 'npc-4', 'npc-5'].map((seatId) => {
    const definition = localNpcDefinitionForSeat(seatId)
    const profile = LOCAL_NPC_STRATEGY_PROFILES.find((candidate) => candidate.id === definition?.strategyProfileId)
    if (!definition || !profile) throw new Error(`Missing fixture NPC for ${seatId}`)
    return {
      seatId,
      displayName: definition.name,
      kind: 'npc' as const,
      npcDefinitionId: definition.id,
      npcStrategyProfileId: profile.id,
      npcStrategyProfileVersion: profile.version,
    }
  })
}
