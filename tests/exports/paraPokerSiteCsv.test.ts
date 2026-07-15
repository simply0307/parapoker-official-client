import { describe, expect, it } from 'vitest'
import { completedSessionPackageToParaPokerSiteCsv } from '../../src/exports/paraPokerSiteCsv'
import { LocalSoloSession, type LocalSoloSessionConfig } from '../../src/table-controllers/local-single-player/LocalSoloSession'

const baseConfig: LocalSoloSessionConfig = {
  mode: 'heads-up',
  startingStack: 1,
  smallBlind: 1,
  bigBlind: 1,
  seed: 'para-site-csv-seed-must-not-leak',
  matchId: 'local-match-1784123964485-118673',
}

describe('Para Poker site CSV export', () => {
  it('exports Poker Now-style rows with hand boundaries recognized by the site importer', async () => {
    const session = await completedSession(baseConfig)
    const exported = await session.exportCompletedSessionPackage()
    const csv = completedSessionPackageToParaPokerSiteCsv(exported)
    const rows = parseCsv(csv)
    const entries = rows.map((row) => row.entry)
    const startingHands = entries.filter((entry) => /-- starting hand #\d+/i.test(entry))
    const endingHands = entries.filter((entry) => /-- ending hand #\d+/i.test(entry))

    expect(csv.split('\n')[0]).toBe('entry,at,order')
    expect(startingHands).toHaveLength(exported.hands.length)
    expect(endingHands).toHaveLength(exported.hands.length)
    expect(entries.some((entry) => /collected \d+ from pot/i.test(entry))).toBe(true)
    expect(entries.some((entry) => /posts a (small|big) blind of \d+/i.test(entry))).toBe(true)
    expect(rows.every((row) => Number.isFinite(Number(row.order)))).toBe(true)
    expect(csv).not.toContain('para-site-csv-seed-must-not-leak')
    expect(csv).not.toContain('holeCardsDealt')
    expect(csv).not.toContain('deck')
    expect(csv).not.toContain('rngState')
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

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.split('\n')
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}
