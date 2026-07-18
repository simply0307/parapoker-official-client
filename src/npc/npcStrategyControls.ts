export interface NpcStrategyControlMapping {
  controlId: string
  runtimeTargets: string[]
  effect: 'direct' | 'compiled' | 'metadata' | 'unused'
}

export const NPC_STRATEGY_CONTROL_MAPPINGS: NpcStrategyControlMapping[] = [
  { controlId: 'simple.preflopStyle', runtimeTargets: ['preflopStrategy.nodes[*].hands', 'policyConfig.preflopLooseness'], effect: 'compiled' },
  { controlId: 'simple.pressure', runtimeTargets: ['preflopStrategy.nodes[*].hands', 'policyConfig.preflopAggression', 'policyConfig.postflopAggression', 'policyConfig.pressureRaiseMultiplier'], effect: 'compiled' },
  { controlId: 'simple.postflopPlan', runtimeTargets: ['postflopStrategy.frequencies', 'postflopStrategy.thresholds'], effect: 'compiled' },
  { controlId: 'simple.defense', runtimeTargets: ['postflopStrategy.defense'], effect: 'compiled' },
  { controlId: 'simple.sizing', runtimeTargets: ['preflopStrategy.sizing', 'postflopStrategy.sizing'], effect: 'compiled' },
  { controlId: 'simple.context', runtimeTargets: ['postflopStrategy.modifiers', 'postflopStrategy.defense'], effect: 'compiled' },
  { controlId: 'policyConfig.*', runtimeTargets: ['legacy preflop/postflop fallback'], effect: 'direct' },
  { controlId: 'preflopStrategy.nodes[*].hands', runtimeTargets: ['choosePreflopRangeDecision'], effect: 'direct' },
  { controlId: 'preflopStrategy.sizing.*', runtimeTargets: ['choosePreflopRangeDecision'], effect: 'direct' },
  { controlId: 'postflopStrategy.frequencies.*', runtimeTargets: ['chooseProactivePostflopDecision'], effect: 'direct' },
  { controlId: 'postflopStrategy.sizing.*', runtimeTargets: ['chooseProactivePostflopDecision'], effect: 'direct' },
  { controlId: 'postflopStrategy.thresholds.*', runtimeTargets: ['chooseProactivePostflopDecision', 'choosePostflopDefenseDecision'], effect: 'direct' },
  { controlId: 'postflopStrategy.modifiers.*', runtimeTargets: ['chooseProactivePostflopDecision'], effect: 'direct' },
  { controlId: 'postflopStrategy.defense.*', runtimeTargets: ['choosePostflopDefenseDecision'], effect: 'direct' },
  { controlId: 'calibrationTarget.*', runtimeTargets: ['projected/observed comparison only'], effect: 'metadata' },
  { controlId: 'modules[*].enabled', runtimeTargets: ['teaching coverage description'], effect: 'metadata' },
  { controlId: 'modules[*].weight', runtimeTargets: ['none; read-only compatibility metadata'], effect: 'metadata' },
  { controlId: 'teaching.*', runtimeTargets: ['decision tags', 'Admin teaching identity', 'archive snapshot'], effect: 'metadata' },
  { controlId: 'profile.id/name/status/description', runtimeTargets: ['registry and presentation'], effect: 'metadata' },
]

export function strategyControlMapping(controlId: string): NpcStrategyControlMapping | undefined {
  return NPC_STRATEGY_CONTROL_MAPPINGS.find((mapping) =>
    mapping.controlId === controlId ||
    (mapping.controlId.endsWith('.*') && controlId.startsWith(mapping.controlId.slice(0, -1))))
}
