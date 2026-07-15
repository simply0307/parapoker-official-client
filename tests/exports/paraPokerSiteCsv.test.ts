import { describe, expect, it } from 'vitest'
import {
  completedSessionPackageToParaPokerSiteCsv,
  stableSessionNumber,
} from '../../src/exports/paraPokerSiteCsv'
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
  it('exports normalized rows with required session metadata for site import', async () => {
    const session = await completedSession(baseConfig)
    const exported = await session.exportCompletedSessionPackage()
    const csv = completedSessionPackageToParaPokerSiteCsv(exported)
    const lines = csv.split('\n')
    const headers = lines[0].split(',')
    const firstRow = parseCsvLine(lines[1])
    const column = (name: string) => firstRow[headers.indexOf(name)]

    expect(headers).toEqual([
      'session_number',
      'session_code',
      'season_code',
      'table_name',
      'format',
      'played_at',
      'hand_no',
      'hand_code',
      'start_time',
      'board',
      'winner_name',
      'pot_collected',
      'winning_hand',
      'showdown',
      'raw_result',
      'log_order',
      'street',
      'player_name',
      'action',
      'amount',
      'target_contribution',
      'raise_to',
      'all_in',
      'raw_entry',
    ])
    expect(Number(column('session_number'))).toBeGreaterThan(0)
    expect(Number(column('session_number'))).toBeLessThanOrEqual(2_000_000_000)
    expect(column('session_code')).toBe('local-match-1784123964485-118673')
    expect(column('season_code')).toBe('LOCAL')
    expect(column('hand_no')).toMatch(/^\d+$/)
    expect(column('player_name')).not.toBe('')
    expect(column('action')).not.toBe('')
    expect(column('raw_entry')).not.toBe('')
    expect(csv).not.toContain('para-site-csv-seed-must-not-leak')
    expect(csv).not.toContain('holeCardsDealt')
    expect(csv).not.toContain('deck')
    expect(csv).not.toContain('rngState')
  })

  it('derives stable positive session numbers from session codes', () => {
    expect(stableSessionNumber('local-match-1784123964485-118673')).toBe(
      stableSessionNumber('local-match-1784123964485-118673'),
    )
    expect(stableSessionNumber('local-match-1784123964485-118673')).not.toBe(
      stableSessionNumber('local-match-1784123964485-118674'),
    )
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
