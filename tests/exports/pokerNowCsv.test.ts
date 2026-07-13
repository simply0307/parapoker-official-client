import { describe, expect, it } from 'vitest'
import { completedSessionPackageToPokerNowCsv } from '../../src/exports/pokerNowCsv'
import { LocalSoloSession, type LocalSoloSessionConfig } from '../../src/table-controllers/local-single-player/LocalSoloSession'

const baseConfig: LocalSoloSessionConfig = {
  mode: 'heads-up',
  startingStack: 1,
  smallBlind: 1,
  bigBlind: 1,
  seed: 'poker-now-csv-seed-must-not-leak',
  matchId: 'poker-now-csv-match',
}

describe('Poker Now-style CSV export', () => {
  it('exports completed public hand history as entry, at, and order rows', async () => {
    const session = await completedSession(baseConfig)
    const exported = await session.exportCompletedSessionPackage()
    const csv = completedSessionPackageToPokerNowCsv(exported)
    const lines = csv.split('\n')

    expect(lines[0]).toBe('entry,at,order')
    expect(lines[1]).toMatch(/^"The player "".+"" finishes the match with a stack of \d+\.",/)
    expect(csv).toContain("\"-- starting hand #1 (id: hand-1) No Limit Texas Hold'em")
    expect(csv).toContain('Player stacks: #1')
    expect(csv).toContain('posts a small blind')
    expect(csv).toContain('posts a big blind')
    expect(csv).toContain('collected')
    expect(csv).toContain('"-- ending hand #1 --"')

    expect(csv).not.toContain('holeCardsDealt')
    expect(csv).not.toContain('deck')
    expect(csv).not.toContain('rngState')
    expect(csv).not.toContain('poker-now-csv-seed-must-not-leak')
  })

  it('escapes quotes so player names remain valid CSV cells', async () => {
    const session = await completedSession({
      ...baseConfig,
      matchId: 'quoted-name-csv-match',
      blueprint: {
        id: 'quoted-blueprint',
        name: 'Quoted Blueprint',
        mode: 'heads-up',
        visibility: 'private',
        startingStack: 1,
        smallBlind: 1,
        bigBlind: 1,
        seed: 'quoted-name-seed',
        seats: [
          { seatId: 'human', kind: 'human', displayName: 'Quote "Hero"' },
          { seatId: 'npc-1', kind: 'npc', npcDefinitionId: 'npc-maven' },
        ],
      },
    })
    const exported = await session.exportCompletedSessionPackage()
    const csv = completedSessionPackageToPokerNowCsv(exported)

    expect(csv).toContain('""Quote """"Hero""""""')
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
