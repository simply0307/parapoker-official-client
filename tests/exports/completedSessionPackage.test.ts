import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LocalSoloSession, type LocalSoloSessionConfig } from '../../src/table-controllers/local-single-player/LocalSoloSession'
import { buildCompletedSessionPackage } from '../../src/exports/completedSessionPackage'
import type { EventRecord, MatchRecord } from '../../src/persistence'
import type { HandHistoryEvent, PublicSeatView } from '../../src/poker-engine'

const baseConfig: LocalSoloSessionConfig = {
  mode: 'heads-up',
  startingStack: 1,
  smallBlind: 1,
  bigBlind: 1,
  seed: 'export-seed-must-not-leak',
  matchId: 'export-match',
}

describe('completed session package export', () => {
  it('rejects export until the local solo match is complete', async () => {
    const session = await LocalSoloSession.create({
      ...baseConfig,
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'incomplete-export',
      matchId: 'incomplete-export',
    })

    await expect(session.exportCompletedSessionPackage()).rejects.toThrow('completed')
  })

  it('builds a Para site compatible package without live secrets or private-only cards', async () => {
    const session = await completedSession(baseConfig)
    const exported = await session.exportCompletedSessionPackage()
    const exportJson = JSON.stringify(exported)

    expect(exported.schemaVersion).toBe('para-completed-session-v1')
    expect(exported.source.sourceAuthority).toBe('local-browser')
    expect(exported.source.packageCreationVersion).toBe('para-completed-session-v1')
    expect(exported.source.blueprintId).toBe('local-heads-up-blueprint')
    expect(exported.source.gameVisibility).toBe('private')
    expect(exported.paraPokerSite.targetVersion).toBe('para-poker-site-import-v1')
    expect(exported.paraPokerSite.metadata.sessionCode).toBe('export-match')
    expect(exported.paraPokerSite.players.map((player) => player.display_name)).toContain('Maven')
    expect(exported.paraPokerSite.hands.length).toBeGreaterThan(0)
    expect(exported.paraPokerSite.actions.length).toBeGreaterThan(0)
    expect(exported.paraPokerSite.rawText).toContain('Hand #')
    expect(exported.paraPokerSite.rawText).toContain('collected')
    expect(exported.source.packageCreatedAt).not.toBe('1970-01-01T00:00:00.000Z')
    expect(exported.hands[0]).toEqual(expect.objectContaining({
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      endedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      blinds: expect.objectContaining({ smallBlind: 1, bigBlind: 1 }),
      stackCheckpoints: expect.objectContaining({
        initial: expect.any(Object),
        final: expect.any(Object),
      }),
      potSummary: expect.objectContaining({
        totalContributed: expect.any(Number),
        totalAwarded: expect.any(Number),
        pots: expect.any(Array),
        refunds: expect.any(Array),
      }),
    }))
    expect(exported.hands[0].positions).toEqual(expect.objectContaining({
      human: expect.any(String),
      'npc-1': expect.any(String),
    }))
    expect(exported.result.finishOrder.map((entry) => entry.finish)).toEqual([1, 2])
    expect(exported.result.eliminationOrder).toEqual(expect.arrayContaining(['human', 'npc-1']))
    expect(exported.paraPokerSite.actions.every((action) => Number.isFinite(action.target_contribution))).toBe(true)
    expect(exported.paraPokerSite.sessionResults[0]).toEqual(
      expect.objectContaining({ approved: false, finish: 1 }),
    )
    expect(exported.integrity.eventCount).toBe(exported.orderedPublicEvents.length)
    expect(exported.integrity.handCount).toBe(exported.hands.length)
    expect(exported.integrity.checksum).toMatch(/^[0-9a-f]{8}$/)

    expect(exportJson).not.toContain('deck')
    expect(exportJson).not.toContain('rngState')
    expect(exportJson).not.toContain('entropy')
    expect(exportJson).not.toContain('export-seed-must-not-leak')
    expect(exportJson).not.toContain('holeCardsDealt')
  })

  it('exports deterministically for the same completed session state', async () => {
    const session = await completedSession({ ...baseConfig, matchId: 'deterministic-export' })

    const first = await session.exportCompletedSessionPackage()
    const second = await session.exportCompletedSessionPackage()

    expect(second).toEqual(first)
  })

  it('keeps the generated package and deterministic fixture aligned with the public schema shape', async () => {
    const schema = JSON.parse(readFileSync('schemas/para-completed-session-v1.schema.json', 'utf8')) as Record<string, unknown>
    const fixture = JSON.parse(readFileSync('tests/fixtures/para-completed-session-v1.json', 'utf8')) as Record<string, unknown>
    const session = await completedSession({ ...baseConfig, matchId: 'schema-export' })
    const exported = await session.exportCompletedSessionPackage()

    expect(schema).toEqual(expect.objectContaining({
      title: 'ParaPoker Completed Session Package v1',
      required: expect.arrayContaining(['schemaVersion', 'source', 'rules', 'participants', 'hands', 'orderedPublicEvents', 'integrity']),
    }))
    for (const packageCandidate of [fixture, exported]) {
      const json = JSON.stringify(packageCandidate)
      expect(packageCandidate.schemaVersion).toBe('para-completed-session-v1')
      expect(packageCandidate.source).toEqual(expect.objectContaining({
        app: 'parapoker-official-client',
        sourceAuthority: 'local-browser',
        packageCreationVersion: 'para-completed-session-v1',
      }))
      expect(packageCandidate).toEqual(expect.objectContaining({
        result: expect.objectContaining({
          finishOrder: expect.any(Array),
          eliminationOrder: expect.any(Array),
        }),
      }))
      expect(packageCandidate.integrity).toEqual(expect.objectContaining({
        checksumAlgorithm: 'stable-json-fnv1a32',
      }))
      expect(json).not.toContain('holeCardsDealt')
      expect(json).not.toContain('deck')
      expect(json).not.toContain('rngState')
      expect(json).not.toContain('entropy')
    }
  })

  it('preserves raise-to evidence and conserving hand checkpoints for Para site import', () => {
    const exported = buildCompletedSessionPackage({
      match: completedRaiseMatch(),
      publicEvents: raiseHandRecords(),
      snapshotSeats: raiseSnapshotSeats(),
      summary: {
        winnerSeatId: 'human',
        winnerName: 'Hero',
        handsPlayed: 1,
        finalStacks: { human: 106, 'npc-1': 94 },
        stats: [],
        mode: 'heads-up',
        seed: 'must-not-export',
      },
      config: {
        mode: 'heads-up',
        startingStack: 100,
        smallBlind: 1,
        bigBlind: 2,
        seed: 'must-not-export',
        matchId: 'raise-export',
      },
      appVersion: 'test',
    })

    const raiseAction = exported.paraPokerSite.actions.find((action) => action.action === 'raises')
    expect(raiseAction).toEqual(expect.objectContaining({
      amount: 4,
      target_contribution: 6,
      raise_to: 6,
      raw_entry: '"Maven" raises to 6',
    }))
    expect(exported.source.packageCreatedAt).toBe('2026-07-15T12:00:10.000Z')
    expect(exported.paraPokerSite.metadata.playedAt).toBe('2026-07-15T12:00:01.000Z')
    expect(exported.hands[0]).toEqual(expect.objectContaining({
      contributions: { human: 6, 'npc-1': 6 },
      stackCheckpoints: {
        initial: { human: 100, 'npc-1': 100 },
        final: { human: 106, 'npc-1': 94 },
      },
      potSummary: expect.objectContaining({
        totalContributed: 12,
        totalAwarded: 12,
        refunds: [],
      }),
    }))
    expect(conservesHandChips(exported.hands[0])).toBe(true)
    expect(JSON.stringify(exported)).not.toContain('must-not-export')
  })
})

async function completedSession(config: LocalSoloSessionConfig): Promise<LocalSoloSession> {
  const session = await LocalSoloSession.create(config)
  for (let hand = 0; hand < 20 && !session.getSnapshot().summary; hand += 1) {
    const snapshot = session.getSnapshot()
    const legalActions = snapshot.heroView.legalActions
    if (legalActions.some((action) => action.type === 'fold')) {
      await session.submitHumanAction({ type: 'fold' })
    } else if (legalActions.some((action) => action.type === 'check')) {
      await session.submitHumanAction({ type: 'check' })
    } else if (legalActions.some((action) => action.type === 'call')) {
      await session.submitHumanAction({ type: 'call' })
    } else if (legalActions.some((action) => action.type === 'allIn')) {
      await session.submitHumanAction({ type: 'allIn' })
    } else if (snapshot.canonicalStatus === 'waitingForHand') {
      await session.startNextHand()
    }
  }

  expect(session.getSnapshot().summary).toBeTruthy()
  return session
}

function completedRaiseMatch(): MatchRecord {
  return {
    matchId: 'raise-export',
    tableId: 'raise-export-table',
    format: 'freezeout',
    rulesContractVersion: 'para-poker-rules-v0',
    eventSchemaVersion: 'poker-event-v1',
    seatAssignments: [
      { seatId: 'human', kind: 'human', displayName: 'Hero' },
      { seatId: 'npc-1', kind: 'npc', displayName: 'Maven' },
    ],
    startingStacks: { human: 100, 'npc-1': 100 },
    blinds: { smallBlind: 1, bigBlind: 2 },
    createdAt: '2026-07-15T12:00:00.000Z',
    completedAt: '2026-07-15T12:00:10.000Z',
    status: 'complete',
    hands: [],
    result: {
      status: 'complete',
      winnerSeatIds: ['human'],
      finalStacks: { human: 106, 'npc-1': 94 },
      completedAt: '2026-07-15T12:00:10.000Z',
    },
  }
}

function raiseHandRecords(): EventRecord[] {
  const events: HandHistoryEvent[] = [
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-1',
      handId: 1,
      sequenceNumber: 1,
      visibility: 'public',
      type: 'handStarted',
      payload: { type: 'handStarted', dealerSeatId: 'human', participantSeatIds: ['human', 'npc-1'] },
    },
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-2',
      handId: 1,
      sequenceNumber: 4,
      visibility: 'public',
      type: 'blindPosted',
      payload: { type: 'blindPosted', seatId: 'human', blind: 'small', amount: 1 },
    },
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-3',
      handId: 1,
      sequenceNumber: 5,
      visibility: 'public',
      type: 'blindPosted',
      payload: { type: 'blindPosted', seatId: 'npc-1', blind: 'big', amount: 2 },
    },
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-4',
      handId: 1,
      sequenceNumber: 6,
      visibility: 'public',
      type: 'actionApplied',
      payload: { type: 'actionApplied', seatId: 'human', action: 'call', amount: 1, targetContribution: 2 },
    },
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-5',
      handId: 1,
      sequenceNumber: 7,
      visibility: 'public',
      type: 'actionApplied',
      payload: { type: 'actionApplied', seatId: 'npc-1', action: 'raise', amount: 4, targetContribution: 6 },
    },
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-6',
      handId: 1,
      sequenceNumber: 8,
      visibility: 'public',
      type: 'actionApplied',
      payload: { type: 'actionApplied', seatId: 'human', action: 'call', amount: 4, targetContribution: 6 },
    },
    {
      schemaVersion: 'poker-event-v1',
      eventId: 'raise-hand-7',
      handId: 1,
      sequenceNumber: 11,
      visibility: 'public',
      type: 'potAwarded',
      payload: {
        type: 'potAwarded',
        winners: [{ seatId: 'human', amount: 12 }],
        pots: [{ amount: 12, eligibleSeatIds: ['human', 'npc-1'] }],
        refunds: [],
      },
    },
  ]

  return events.map((event, index) => ({
    matchId: 'raise-export',
    tableId: 'raise-export-table',
    event,
    eventId: event.eventId,
    handId: event.handId,
    sequenceNumber: event.sequenceNumber,
    visibility: event.visibility,
    recordedAt: `2026-07-15T12:00:${String(index + 1).padStart(2, '0')}.000Z`,
    privacyClass: 'public',
  }))
}

function raiseSnapshotSeats(): PublicSeatView[] {
  return [
    {
      id: 'human',
      name: 'Hero',
      kind: 'human',
      position: 'BTN/SB',
      stack: 106,
      status: 'active',
      streetContribution: 0,
      totalContribution: 0,
      isDealer: true,
      isSmallBlind: true,
      isBigBlind: false,
    },
    {
      id: 'npc-1',
      name: 'Maven',
      kind: 'npc',
      position: 'BB',
      stack: 94,
      status: 'active',
      streetContribution: 0,
      totalContribution: 0,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: true,
    },
  ]
}

function conservesHandChips(hand: {
  participantSeatIds: string[]
  stackCheckpoints: { initial: Record<string, number>; final: Record<string, number> }
  contributions: Record<string, number>
  potSummary: { totalAwarded: number; refunds: Array<{ amount: number }> }
}): boolean {
  const initial = hand.participantSeatIds.reduce((sum, seatId) => sum + hand.stackCheckpoints.initial[seatId], 0)
  const final = hand.participantSeatIds.reduce((sum, seatId) => sum + hand.stackCheckpoints.final[seatId], 0)
  const contributions = Object.values(hand.contributions).reduce((sum, amount) => sum + amount, 0)
  const refunds = hand.potSummary.refunds.reduce((sum, refund) => sum + refund.amount, 0)
  return initial - contributions + hand.potSummary.totalAwarded + refunds === final
}
