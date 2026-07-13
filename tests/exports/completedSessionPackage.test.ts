import { describe, expect, it } from 'vitest'
import { LocalSoloSession, type LocalSoloSessionConfig } from '../../src/table-controllers/local-single-player/LocalSoloSession'

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
    expect(exported.paraPokerSite.targetVersion).toBe('para-poker-site-import-v1')
    expect(exported.paraPokerSite.metadata.sessionCode).toBe('export-match')
    expect(exported.paraPokerSite.players.map((player) => player.display_name)).toContain('Maven')
    expect(exported.paraPokerSite.hands.length).toBeGreaterThan(0)
    expect(exported.paraPokerSite.actions.length).toBeGreaterThan(0)
    expect(exported.paraPokerSite.rawText).toContain('Hand #')
    expect(exported.paraPokerSite.rawText).toContain('collected')
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
