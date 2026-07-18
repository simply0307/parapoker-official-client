import { describe, expect, it } from 'vitest'
import {
  createRandomLocalSeed,
  LocalSoloSession,
  type LocalSoloSessionConfig,
} from '../../src/table-controllers/local-single-player/LocalSoloSession'
import { completedSessionPackageToParaPokerSiteCsv } from '../../src/exports/paraPokerSiteCsv'
import { createGameBlueprint } from '../../src/game-config/gameBlueprint'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'
import { InMemoryHandHistoryArchiveStore } from '../../src/persistence'

const baseConfig: LocalSoloSessionConfig = {
  mode: 'heads-up',
  startingStack: 200,
  smallBlind: 1,
  bigBlind: 2,
  seed: 'session-test',
}

describe('local solo session integration', () => {
  it('records heads-up human and NPC transition events exactly once', async () => {
    const session = await LocalSoloSession.create(baseConfig)

    const transition = await session.submitHumanAction({ type: 'call' })
    const actionEvents = transition.heroView.events.filter((event) => event.type === 'actionApplied')
    const publicRecords = await session.listPublicSessionEvents()

    expect(actionEvents.some((event) => event.payload.seatId === 'human')).toBe(true)
    expect(actionEvents.some((event) => event.payload.seatId === 'npc-1')).toBe(true)
    expect(new Set(publicRecords.map((record) => record.eventId)).size).toBe(publicRecords.length)
  })

  it('counts every funded six-max participant as playing the hand', async () => {
    const session = await LocalSoloSession.create({ ...baseConfig, mode: 'six-max', seed: 'six-max-session' })

    const stats = await session.listMatchStats()

    expect(stats).toHaveLength(6)
    expect(stats.map((stat) => stat.handsPlayed)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('accepts configurable NPC lineups and preserves the resolved game blueprint', async () => {
    const session = await LocalSoloSession.create({
      ...baseConfig,
      seed: 'custom-lineup',
      visibility: 'unlisted',
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: 'npc-vega' }],
    })

    const snapshot = session.getSnapshot()
    const match = await session.getMatchRecord()

    expect(snapshot.publicView.seats.map((seat) => seat.name)).toEqual(['You', 'Vega'])
    expect(snapshot.blueprint.visibility).toBe('unlisted')
    expect(snapshot.blueprint.seats).toEqual([
      { seatId: 'human', kind: 'human', displayName: 'You', playerId: 'local-human' },
      {
        seatId: 'npc-1',
        kind: 'npc',
        npcDefinitionId: 'npc-vega',
        npcStrategyProfileId: 'strategy-value-hunter-v5',
        npcStrategyProfileVersion: 5,
      },
    ])
    expect(match?.seatAssignments).toEqual([
      { seatId: 'human', playerId: 'local-human' },
      { seatId: 'npc-1', npcId: 'npc-vega' },
    ])
  })

  it('retains the player profile identity through the table, archive package, and hand history', async () => {
    const session = await LocalSoloSession.create({
      ...baseConfig,
      startingStack: 1,
      smallBlind: 1,
      bigBlind: 1,
      matchId: 'profile-identity-match',
      humanPlayer: {
        playerId: 'profile-river-port',
        displayName: 'RiverPort',
      },
    })

    expect(session.getSnapshot().publicView.seats[0].name).toBe('RiverPort')
    expect((await session.getMatchRecord())?.seatAssignments[0]).toEqual({
      seatId: 'human',
      playerId: 'profile-river-port',
    })

    const exported = await session.exportCompletedSessionPackage()
    const human = exported.participants.find((participant) => participant.seatId === 'human')
    const csv = completedSessionPackageToParaPokerSiteCsv(exported)

    expect(human).toEqual(expect.objectContaining({
      displayName: 'RiverPort',
      optionalParaPlayerId: 'profile-river-port',
    }))
    expect(exported.paraPokerSite.players).toContainEqual(
      expect.objectContaining({ display_name: 'RiverPort', optional_para_player_id: 'profile-river-port' }),
    )
    expect(exported.paraPokerSite.rawText).toContain('"RiverPort"')
    expect(csv).toContain('""RiverPort""')
    expect(csv).not.toContain('""You""')
  })

  it('isolates stats by match ID and seat ID', async () => {
    const first = await LocalSoloSession.create({ ...baseConfig, matchId: 'match-a', seed: 'match-a' })
    const second = await LocalSoloSession.create({ ...baseConfig, matchId: 'match-b', seed: 'match-b' })

    await first.submitHumanAction({ type: 'fold' })

    expect(await first.getMatchSeatStats('human')).toEqual(expect.objectContaining({ matchId: 'match-a', folds: 1 }))
    expect(await second.getMatchSeatStats('human')).toEqual(expect.objectContaining({ matchId: 'match-b', folds: 0 }))
  })

  it('starts a new match without mutating the previous session record', async () => {
    const first = await LocalSoloSession.create({ ...baseConfig, matchId: 'old-match', seed: 'old-match' })
    const before = await first.listPublicSessionEvents()
    const second = await LocalSoloSession.create({ ...baseConfig, matchId: 'new-match', seed: 'new-match' })

    expect(first.getSnapshot().matchId).toBe('old-match')
    expect(second.getSnapshot().matchId).toBe('new-match')
    expect(await first.listPublicSessionEvents()).toEqual(before)
  })

  it('produces a factual completed-match summary from verified records and config', async () => {
    const session = await LocalSoloSession.create({
      ...baseConfig,
      startingStack: 1,
      smallBlind: 1,
      bigBlind: 1,
      seed: 'instant-complete',
    })
    const snapshot = session.getSnapshot()
    const match = await session.getMatchRecord()

    expect(snapshot.summary).toEqual(
      expect.objectContaining({
        handsPlayed: 1,
        mode: 'heads-up',
        seed: 'instant-complete',
      }),
    )
    expect(snapshot.summary?.winnerSeatId).toBeTruthy()
    expect(match?.status).toBe('complete')
    expect(match?.result?.finalStacks).toEqual(snapshot.summary?.finalStacks)
  })

  it('records the selected random local seed', async () => {
    const seed = createRandomLocalSeed()
    const session = await LocalSoloSession.create({ ...baseConfig, seed })

    expect(session.getSnapshot().seed).toBe(seed)
  })

  it('keeps entered seeds reproducible', async () => {
    const first = await LocalSoloSession.create({ ...baseConfig, seed: 'same-seed' })
    const second = await LocalSoloSession.create({ ...baseConfig, seed: 'same-seed' })

    expect(first.getSnapshot().heroView.holeCards).toEqual(second.getSnapshot().heroView.holeCards)
    expect(first.getSnapshot().heroView.events.map((event) => event.type)).toEqual(
      second.getSnapshot().heroView.events.map((event) => event.type),
    )
  })

  it('does not place deck, RNG state, or unrevealed opponent cards into public session records', async () => {
    const session = await LocalSoloSession.create({ ...baseConfig, seed: 'public-record-privacy' })
    const npcCards = session.getCanonicalStateForTests().seats.find((seat) => seat.id === 'npc-1')?.holeCards ?? []
    const publicRecords = await session.listPublicSessionEvents()
    const publicJson = JSON.stringify(publicRecords)

    expect(publicJson).not.toContain('deck')
    expect(publicJson).not.toContain('rngState')
    for (const card of npcCards) {
      expect(publicJson).not.toContain(JSON.stringify(card))
    }
  })

  it('runs and exports the strategy version pinned by Admin instead of the compiled roster default', async () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    profile.id = 'strategy-admin-fold-v11'
    profile.version = 11
    if (!profile.preflopStrategy) {
      throw new Error('Expected a preflop strategy fixture.')
    }
    profile.preflopStrategy = {
      ...profile.preflopStrategy,
      id: 'admin-fold-preflop-v11',
      version: 11,
      nodes: profile.preflopStrategy.nodes.map((node) => ({
        ...node,
        hands: Object.fromEntries(Object.keys(node.hands).map((handClass) => [
          handClass,
          [{ action: 'fold' as const, frequency: 1 }],
        ])),
      })),
    }
    const definition = {
      ...structuredClone(LOCAL_NPC_DEFINITIONS[0]),
      strategyProfileId: profile.id,
    }
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'admin-strategy-authority',
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: definition.id }],
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })
    const session = await LocalSoloSession.create({ ...baseConfig, blueprint }, {
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })

    const afterRaise = await session.submitHumanAction({ type: 'raise', amount: 4 })

    expect(afterRaise.publicView.events).toContainEqual(expect.objectContaining({
      type: 'actionApplied',
      payload: expect.objectContaining({ seatId: 'npc-1', action: 'fold' }),
    }))
    const archiveBlueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 4,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'admin-strategy-archive',
      npcLineup: [{ seatId: 'npc-1', npcDefinitionId: definition.id }],
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })
    const completedSession = await LocalSoloSession.create({
      ...baseConfig,
      startingStack: 4,
      blueprint: archiveBlueprint,
    }, {
      archiveStore: new InMemoryHandHistoryArchiveStore(),
      npcDefinitions: [definition],
      npcStrategyProfiles: [profile],
    })
    let safety = 0
    while (!completedSession.getSnapshot().summary) {
      safety += 1
      if (safety > 20) throw new Error('Pinned-strategy archive fixture did not complete.')
      const snapshot = completedSession.getSnapshot()
      if (snapshot.canonicalStatus === 'handInProgress' && snapshot.heroView.pendingSeatId === snapshot.heroView.heroSeatId) {
        await completedSession.submitHumanAction({ type: 'allIn' })
      } else {
        await completedSession.startNextHand()
      }
    }
    const completed = await completedSession.exportCompletedSessionPackage()
    const archived = await completedSession.getArchivedSession()

    expect(completed.participants[1]).toEqual(expect.objectContaining({
      npcStrategyProfileId: profile.id,
      npcStrategyProfileVersion: 11,
    }))
    expect(archived?.session.authorityArchive?.npcStrategySnapshots).toEqual([
      expect.objectContaining({
        npcDefinitionId: definition.id,
        strategyProfile: expect.objectContaining({
          id: profile.id,
          version: 11,
          teaching: expect.objectContaining({ teachingObjective: expect.any(String) }),
        }),
      }),
    ])
    expect(archived?.session.authorityArchive?.integrity.npcDecisionCount)
      .toBe(archived?.session.authorityArchive?.npcDecisionTraces.length)
    expect(archived?.session.authorityArchive?.npcDecisionTraces.length).toBeGreaterThan(0)
    expect(archived?.session.authorityArchive?.npcDecisionTraces.every((trace) =>
      trace.matchId === archived.session.matchId &&
      trace.tableId === archived.session.tableId &&
      trace.traceId.length > 0 &&
      trace.decisionSequence > 0
    )).toBe(true)
    expect(archived?.session.authorityArchive?.npcDecisionTraces.map((trace) => trace.decisionSequence)).toEqual(
      archived?.session.authorityArchive?.npcDecisionTraces.map((_, index) => index + 1),
    )
    expect(JSON.stringify(completed)).not.toMatch(/npcDecisionTrace|strategySnapshot/i)
  })
})
