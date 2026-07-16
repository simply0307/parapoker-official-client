import type {
  NpcPreflopAction,
  NpcPreflopActionFrequency,
  NpcPreflopStrategy,
  NpcStrategyProfile,
} from './config'

export interface CreateStrategyProfileVersionDraftOptions {
  id?: string
  name?: string
}

export function createStrategyProfileVersionDraft(
  source: NpcStrategyProfile,
  options: CreateStrategyProfileVersionDraftOptions = {},
): NpcStrategyProfile {
  const nextVersion = source.version + 1
  const draft = clone(source)
  draft.id = options.id?.trim() || nextProfileId(source.id, nextVersion)
  draft.version = nextVersion
  draft.name = options.name?.trim() || `${source.name} Custom`
  draft.status = 'draft'
  if (draft.preflopStrategy) {
    draft.preflopStrategy.id = nextNestedStrategyId(draft.preflopStrategy.id, draft.preflopStrategy.version + 1)
    draft.preflopStrategy.version += 1
  }
  if (draft.postflopStrategy) {
    draft.postflopStrategy.id = nextNestedStrategyId(draft.postflopStrategy.id, draft.postflopStrategy.version + 1)
    draft.postflopStrategy.version += 1
  }
  return draft
}

export function updatePreflopHandActionFrequency(
  strategy: NpcPreflopStrategy,
  nodeId: string,
  handClass: string,
  action: NpcPreflopAction,
  frequency: number,
): NpcPreflopStrategy {
  const next = clone(strategy)
  const node = next.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`Unknown preflop range node: ${nodeId}`)
  }
  const current = node.hands[handClass]
  if (!current) {
    throw new Error(`Unknown preflop hand class for ${nodeId}: ${handClass}`)
  }
  node.hands[handClass] = rebalanceMix(current, action, clamp01(frequency))
  return next
}

function rebalanceMix(
  current: NpcPreflopActionFrequency[],
  selectedAction: NpcPreflopAction,
  selectedFrequency: number,
): NpcPreflopActionFrequency[] {
  if (selectedFrequency >= 1) {
    return [{ action: selectedAction, frequency: 1 }]
  }
  const others = current.filter((entry) => entry.action !== selectedAction)
  const remaining = 1 - selectedFrequency
  if (others.length === 0) {
    const fallbackAction: NpcPreflopAction = selectedAction === 'fold' ? 'call' : 'fold'
    return [
      { action: selectedAction, frequency: roundFrequency(selectedFrequency) },
      { action: fallbackAction, frequency: roundFrequency(remaining) },
    ].filter((entry) => entry.frequency > 0)
  }
  const otherTotal = others.reduce((sum, entry) => sum + entry.frequency, 0)
  const scaled = others.map((entry) => ({
    action: entry.action,
    frequency: roundFrequency(otherTotal > 0 ? entry.frequency / otherTotal * remaining : remaining / others.length),
  }))
  const result = [
    { action: selectedAction, frequency: roundFrequency(selectedFrequency) },
    ...scaled,
  ].filter((entry) => entry.frequency > 0)
  const total = result.reduce((sum, entry) => sum + entry.frequency, 0)
  result[result.length - 1].frequency = roundFrequency(result[result.length - 1].frequency + (1 - total))
  return result
}

function nextProfileId(sourceId: string, version: number): string {
  const base = sourceId.replace(/(?:-custom)?-v\d+$/i, '')
  return `${base}-custom-v${version}`
}

function nextNestedStrategyId(sourceId: string, version: number): string {
  return `${sourceId.replace(/-v\d+$/i, '')}-v${version}`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function roundFrequency(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
