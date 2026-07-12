import { describe, expect, it } from 'vitest'
import {
  createRandomLocalSeed,
  LocalSoloSession,
  type LocalSoloSessionConfig,
} from '../../src/table-controllers/local-single-player/LocalSoloSession'

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
})
