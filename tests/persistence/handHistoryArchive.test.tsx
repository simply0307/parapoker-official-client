import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminPortal } from '../../src/ui/AdminPortal'
import {
  buildArchiveParticipants,
  IndexedDbHandHistoryArchiveStore,
  InMemoryHandHistoryArchiveStore,
  stableArchiveChecksum,
} from '../../src/persistence'
import { createGameBlueprint } from '../../src/game-config/gameBlueprint'
import { LocalSoloSession, type LocalSoloSessionConfig } from '../../src/table-controllers/local-single-player/LocalSoloSession'

const archiveConfig: LocalSoloSessionConfig = {
  mode: 'heads-up',
  startingStack: 200,
  smallBlind: 1,
  bigBlind: 2,
  seed: 'archive-seed-private',
  matchId: 'archive-match',
}

describe('hand-history archive stores', () => {
  it('creates an active archive when a local solo game starts', async () => {
    const archiveStore = new InMemoryHandHistoryArchiveStore()

    const session = await LocalSoloSession.create(archiveConfig, { archiveStore })
    const archive = await session.getArchivedSession()

    expect(archive?.session.status).toBe('active')
    expect(archive?.session.matchId).toBe('archive-match')
    expect(archive?.session.privateMetadata?.localSeed).toBe('archive-seed-private')
    expect(archive?.session.participants.map((participant) => participant.displayName)).toContain('Maven')
  })

  it('saves a completed hand before the match completes and keeps private hero cards separate', async () => {
    const archiveStore = new InMemoryHandHistoryArchiveStore()
    const session = await LocalSoloSession.create({ ...archiveConfig, matchId: 'incremental-archive' }, { archiveStore })

    await session.submitHumanAction({ type: 'fold' })

    const archive = await session.getArchivedSession()
    const publicJson = JSON.stringify(archive?.hands)
    const privateJson = JSON.stringify(archive?.privateHands)

    expect(session.getSnapshot().summary).toBeUndefined()
    expect(archive?.hands).toHaveLength(1)
    expect(archive?.privateHands).toHaveLength(1)
    expect(archive?.privateHands[0].seatId).toBe('human')
    expect(privateJson).toContain('holeCardsDealt')
    expect(publicJson).not.toContain('holeCardsDealt')
    expect(publicJson).not.toContain('archive-seed-private')
  })

  it('does not duplicate completed hand archives when later transitions occur', async () => {
    const archiveStore = new InMemoryHandHistoryArchiveStore()
    const session = await LocalSoloSession.create({ ...archiveConfig, matchId: 'no-duplicates' }, { archiveStore })

    await session.submitHumanAction({ type: 'fold' })
    await session.startNextHand()
    await session.submitHumanAction({ type: 'fold' })

    const archive = await session.getArchivedSession()
    expect(archive?.hands.map((hand) => hand.handNumber)).toEqual([1, 2])
  })

  it('stores the public package and checksum after match completion without hidden information', async () => {
    const archiveStore = new InMemoryHandHistoryArchiveStore()
    const session = await playToCompletion({
      ...archiveConfig,
      startingStack: 1,
      smallBlind: 1,
      bigBlind: 1,
      matchId: 'complete-archive',
    }, archiveStore)

    const archive = await session.getArchivedSession()
    const publicPackage = archive?.session.publicPackage
    const packageJson = JSON.stringify(publicPackage)

    expect(archive?.session.status).toBe('export-ready')
    expect(archive?.session.packageChecksum).toBe(publicPackage?.integrity.checksum)
    expect(publicPackage?.source.sourceAuthority).toBe('local-browser')
    expect(publicPackage?.source.blueprintId).toBe('local-heads-up-blueprint')
    expect(packageJson).not.toContain('archive-seed-private')
    expect(packageJson).not.toContain('deck')
    expect(packageJson).not.toContain('rngState')
    expect(packageJson).not.toContain('entropy')
    expect(packageJson).not.toContain('canonical')
    expect(stableArchiveChecksum(publicPackage)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('finalizes a restricted completed table archive while public archive lists stay sanitized', async () => {
    const archiveStore = new InMemoryHandHistoryArchiveStore()
    const session = await playToCompletion({
      ...archiveConfig,
      startingStack: 1,
      smallBlind: 1,
      bigBlind: 1,
      matchId: 'authority-archive-local',
    }, archiveStore)

    const detail = await session.getArchivedSession()
    const listed = await archiveStore.listArchivedSessions()
    const archive = detail?.session.authorityArchive

    expect(archive).toEqual(expect.objectContaining({
      schemaVersion: 'para-completed-table-archive-v1',
      authorityClass: 'local-browser',
      matchId: 'authority-archive-local',
      closure: expect.objectContaining({ reason: 'match-complete' }),
      integrity: expect.objectContaining({
        checksumAlgorithm: 'stable-json-fnv1a32',
        eventCount: archive?.events.length,
        handCount: archive?.hands.length,
      }),
    }))
    expect(archive?.events.map((event) => event.tableSequence)).toEqual(
      Array.from({ length: archive?.events.length ?? 0 }, (_, index) => index + 1),
    )
    expect(archive?.events.some((event) => event.visibility === 'human' && event.event.type === 'holeCardsDealt')).toBe(true)
    expect(archive?.seatPrivateHands.some((hand) => hand.seatId === 'human' && hand.holeCards.length === 2)).toBe(true)
    expect(archive?.derivatives.publicPackage.integrity.checksum).toBe(detail?.session.publicPackage?.integrity.checksum)
    expect(JSON.stringify(archive?.derivatives.publicPackage)).not.toContain('holeCardsDealt')
    expect(listed.find((record) => record.matchId === 'authority-archive-local')?.authorityArchive).toBeUndefined()
    expect(JSON.stringify(listed)).not.toContain('archive-seed-private')
    expect(JSON.stringify(listed)).not.toContain('holeCardsDealt')
  })

  it('tracks local operator hand-history submission workflow statuses', async () => {
    const archiveStore = new InMemoryHandHistoryArchiveStore()
    const session = await playToCompletion({
      ...archiveConfig,
      startingStack: 1,
      smallBlind: 1,
      bigBlind: 1,
      matchId: 'operator-status-archive',
    }, archiveStore)

    await archiveStore.updateImportStatus('operator-status-archive', 'csv-generated')
    await archiveStore.updateImportStatus('operator-status-archive', 'submitted')
    await archiveStore.updateImportStatus('operator-status-archive', 'imported')

    const archive = await session.getArchivedSession()
    const listed = await archiveStore.listArchivedSessions()

    expect(archive?.session.status).toBe('imported')
    expect(archive?.session.importStatus).toBe('imported')
    expect(listed.find((record) => record.matchId === 'operator-status-archive')?.importStatus).toBe('imported')
  })

  it('retains IndexedDB-backed records across store re-instantiation', async () => {
    const databaseName = `test-archive-${Date.now()}`
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'idb-private-seed',
    })
    const first = new IndexedDbHandHistoryArchiveStore(databaseName)

    await first.createActiveSession({
      matchId: 'idb-match',
      tableId: 'idb-table',
      blueprint,
      config: { mode: 'heads-up', startingStack: 200, smallBlind: 1, bigBlind: 2, seed: 'idb-private-seed' },
      participants: buildArchiveParticipants(blueprint),
      rulesContractVersion: 'para-poker-rules-v0',
      eventSchemaVersion: 'poker-event-v1',
    })

    const second = new IndexedDbHandHistoryArchiveStore(databaseName)
    expect((await second.listArchivedSessions()).map((session) => session.matchId)).toContain('idb-match')
  })

  it('loads archived matches in the admin hand histories section', async () => {
    const archiveStore = new IndexedDbHandHistoryArchiveStore()
    await archiveStore.deleteArchivedSession('admin-archive-match')
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'admin-private-seed',
    })
    await archiveStore.createActiveSession({
      matchId: 'admin-archive-match',
      tableId: 'admin-archive-table',
      blueprint,
      config: { mode: 'heads-up', startingStack: 200, smallBlind: 1, bigBlind: 2, seed: 'admin-private-seed' },
      participants: buildArchiveParticipants(blueprint),
      rulesContractVersion: 'para-poker-rules-v0',
      eventSchemaVersion: 'poker-event-v1',
    })

    render(<AdminPortal />)

    await waitFor(() => expect(screen.getByText('admin-archive-match')).toBeInTheDocument())
    expect(screen.getByLabelText('Archived hand histories')).toBeInTheDocument()

    await archiveStore.deleteArchivedSession('admin-archive-match')
  })
})

async function playToCompletion(
  config: LocalSoloSessionConfig,
  archiveStore: InMemoryHandHistoryArchiveStore,
): Promise<LocalSoloSession> {
  const session = await LocalSoloSession.create(config, { archiveStore })
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
