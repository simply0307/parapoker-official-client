import { useEffect, useMemo, useState } from 'react'
import type {
  NpcPostflopStrategy,
  NpcPreflopAction,
  NpcPreflopFormat,
  NpcPreflopStackDepth,
  NpcPreflopStrategy,
  NpcStrategyCalibrationMetricId,
  NpcStrategyProfile,
  NpcStrategyTargetPresetId,
} from '../npc/config'
import {
  simulatePostflopDefenseScenario,
  type NpcPostflopDefenseScenario,
} from '../npc/npcScenarioSimulator'
import {
  createStrategyProfileVersionDraft,
  updatePreflopHandActionFrequency,
} from '../npc/strategyEditing'
import { AdminStrategyCalibration } from './AdminStrategyCalibration'
import { AdminStrategyIntent, StrategyCalibrationSummary } from './AdminStrategyIntent'
import { createNpcStrategyCalibrationTarget } from '../npc/npcStrategyValidation'

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const
const PREFLOP_ACTIONS: NpcPreflopAction[] = ['fold', 'check', 'call', 'raise', 'allIn']
const WORKSPACE_STAGES = ['Intent', 'Profile', 'Preflop', 'Postflop', 'Decision Lab', 'Calibration'] as const
type WorkspaceStage = typeof WORKSPACE_STAGES[number]

export function AdminStrategyWorkspace({
  profiles,
  onCreateVersion,
}: {
  profiles: NpcStrategyProfile[]
  onCreateVersion: (sourceProfileId: string, profile: NpcStrategyProfile) => Promise<void>
}) {
  const [selectedProfileId, setSelectedProfileId] = useState(profiles[0]?.id ?? '')
  const [sourceProfileId, setSourceProfileId] = useState('')
  const [draft, setDraft] = useState<NpcStrategyProfile | null>(null)
  const [activeStage, setActiveStage] = useState<WorkspaceStage>('Intent')
  const [editorMessage, setEditorMessage] = useState('Select a profile and create a new version to edit safely.')
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0]
  const workingProfile = draft ?? selectedProfile

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? '')
    }
  }, [profiles, selectedProfileId])

  function beginVersion() {
    if (!selectedProfile) {
      return
    }
    setSourceProfileId(selectedProfile.id)
    setDraft(createStrategyProfileVersionDraft(selectedProfile))
    setActiveStage('Intent')
    setEditorMessage(`Editing an independent v${selectedProfile.version + 1} draft.`)
  }

  async function saveVersion() {
    if (!draft || !sourceProfileId) {
      return
    }
    try {
      await onCreateVersion(sourceProfileId, draft)
      setSelectedProfileId(draft.id)
      setDraft(null)
      setSourceProfileId('')
      setEditorMessage(`Saved ${draft.name} v${draft.version}. Assign it to an NPC when ready.`)
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="strategy-workspace">
      <div className="strategy-toolbar">
        <label>
          <span>Source profile</span>
          <select
            aria-label="Strategy source profile"
            value={selectedProfile?.id ?? ''}
            disabled={Boolean(draft)}
            onChange={(event) => setSelectedProfileId(event.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name} v{profile.version}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={beginVersion} disabled={!selectedProfile || Boolean(draft)}>
          Create editable version
        </button>
        {draft && (
          <>
            <button type="button" className="primary" onClick={() => void saveVersion()}>
              Save profile version
            </button>
            <button type="button" onClick={() => setDraft(null)}>Discard draft</button>
          </>
        )}
      </div>
      <p className="muted" role="status">{editorMessage}</p>

      <div className="strategy-stage-tabs" role="tablist" aria-label="Strategy workbench stages">
        {WORKSPACE_STAGES.map((stage) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeStage === stage}
            key={stage}
            onClick={() => setActiveStage(stage)}
          >
            {stage}
          </button>
        ))}
      </div>

      {workingProfile && (
        <div className="strategy-stage-content" role="tabpanel" aria-label={`${activeStage} strategy stage`}>
          {activeStage === 'Intent' && (
            <AdminStrategyIntent
              profile={workingProfile}
              editable={Boolean(draft)}
              onSelectPreset={(presetId: NpcStrategyTargetPresetId) => updateDraft(setDraft, (next) => {
                next.calibrationTarget = createNpcStrategyCalibrationTarget(presetId)
              })}
              onUpdateBand={(metricId: NpcStrategyCalibrationMetricId, band) => updateDraft(setDraft, (next) => {
                const target = next.calibrationTarget ?? createNpcStrategyCalibrationTarget('balanced')
                target.presetId = 'custom'
                const min = Math.max(0, Math.min(1.25, Number.isFinite(band.min) ? band.min : 0))
                const max = Math.max(min, Math.min(1.25, Number.isFinite(band.max) ? band.max : 1))
                target.bands[metricId] = { min, max }
                next.calibrationTarget = target
              })}
            />
          )}
          {activeStage === 'Profile' && (
            <>
              <StrategyCalibrationSummary profile={workingProfile} onOpenCalibration={() => setActiveStage('Calibration')} />
              <ProfileIdentityEditor profile={workingProfile} draft={draft} setDraft={setDraft} />
              <ModuleEditor profile={workingProfile} draft={draft} setDraft={setDraft} />
            </>
          )}
          {activeStage === 'Preflop' && (
            <PreflopEditor profile={workingProfile} draft={draft} setDraft={setDraft} />
          )}
          {activeStage === 'Postflop' && (
            <PostflopEditor profile={workingProfile} draft={draft} setDraft={setDraft} />
          )}
          {activeStage === 'Decision Lab' && <ScenarioSimulator profile={workingProfile} />}
          {activeStage === 'Calibration' && (
            <AdminStrategyCalibration profile={workingProfile} profiles={profiles} />
          )}
        </div>
      )}
    </div>
  )
}

function ProfileIdentityEditor({
  profile,
  draft,
  setDraft,
}: EditorProps) {
  return (
    <section className="strategy-editor-band" aria-label="Strategy version identity">
      <div className="section-heading">
        <h3>Version Identity</h3>
        <span>{draft ? 'editable draft' : 'read only'}</span>
      </div>
      <div className="strategy-field-grid">
        <TextControl
          label="Profile ID"
          value={profile.id}
          disabled={!draft}
          onChange={(id) => updateDraft(setDraft, (next) => { next.id = id })}
        />
        <TextControl
          label="Name"
          value={profile.name}
          disabled={!draft}
          onChange={(name) => updateDraft(setDraft, (next) => { next.name = name })}
        />
        <label>
          <span>Status</span>
          <select
            aria-label="Strategy profile status"
            value={profile.status}
            disabled={!draft}
            onChange={(event) => updateDraft(setDraft, (next) => {
              next.status = event.target.value as 'draft' | 'active' | 'retired'
            })}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
        </label>
      </div>
      <div className="strategy-control-grid">
        {Object.entries(profile.policyConfig).map(([key, value]) => (
          <NumericControl
            key={key}
            label={humanize(key)}
            value={value}
            min={0}
            max={key === 'pressureRaiseMultiplier' ? 6 : 1}
            step={0.01}
            disabled={!draft}
            onChange={(nextValue) => updateDraft(setDraft, (next) => {
              setNumeric(next.policyConfig, key, nextValue)
            })}
          />
        ))}
      </div>
    </section>
  )
}

function ModuleEditor({ profile, draft, setDraft }: EditorProps) {
  return (
    <section className="strategy-editor-band" aria-label="Strategy modules">
      <div className="section-heading">
        <h3>Safe Modules</h3>
        <span>{profile.modules.filter((module) => module.enabled).length} enabled</span>
      </div>
      <div className="module-control-grid">
        {profile.modules.map((module, index) => (
          <div className="module-control" key={`${module.id}-${index}`}>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={module.enabled}
                disabled={!draft}
                onChange={(event) => updateDraft(setDraft, (next) => {
                  next.modules[index].enabled = event.target.checked
                })}
              />
              <span>{humanize(module.id)}</span>
            </label>
            <NumericControl
              label="Weight"
              value={module.weight}
              min={0}
              max={1}
              step={0.01}
              disabled={!draft}
              onChange={(value) => updateDraft(setDraft, (next) => {
                next.modules[index].weight = value
              })}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function PreflopEditor({ profile, draft, setDraft }: EditorProps) {
  const strategy = profile.preflopStrategy
  const [editorMode, setEditorMode] = useState<'ranges' | 'sizing'>('ranges')
  const [format, setFormat] = useState<'all' | NpcPreflopFormat>('all')
  const [position, setPosition] = useState('all')
  const [stackDepth, setStackDepth] = useState<'all' | NpcPreflopStackDepth>('all')
  const [situation, setSituation] = useState('all')
  const [selectedNodeId, setSelectedNodeId] = useState(strategy?.nodes[0]?.id ?? '')
  const [selectedHandClass, setSelectedHandClass] = useState('AA')
  const filteredNodes = useMemo(() => strategy?.nodes.filter((node) =>
    (format === 'all' || node.formats.includes(format)) &&
    (position === 'all' || node.positions.includes(position as never)) &&
    (stackDepth === 'all' || node.stackDepths.includes(stackDepth)) &&
    (situation === 'all' || node.situations.includes(situation as never))) ?? [],
  [format, position, situation, stackDepth, strategy])
  const selectedNode = filteredNodes.find((node) => node.id === selectedNodeId) ?? filteredNodes[0]

  useEffect(() => {
    if (selectedNode && selectedNode.id !== selectedNodeId) {
      setSelectedNodeId(selectedNode.id)
    }
  }, [selectedNode, selectedNodeId])

  if (!strategy) {
    return <section className="strategy-editor-band"><p className="muted">No preflop strategy configured.</p></section>
  }
  const mix = selectedNode?.hands[selectedHandClass] ?? []

  function updateMix(action: NpcPreflopAction, frequency: number) {
    if (!draft || !selectedNode) {
      return
    }
    updateDraft(setDraft, (next) => {
      if (!next.preflopStrategy) {
        return
      }
      next.preflopStrategy = updatePreflopHandActionFrequency(
        next.preflopStrategy,
        selectedNode.id,
        selectedHandClass,
        action,
        frequency,
      )
    })
  }

  return (
    <section className="strategy-editor-band" aria-label="Preflop range editor">
      <div className="section-heading">
        <h3>Preflop Range Construction</h3>
        <span>{strategy.nodes.length} nodes</span>
      </div>
      <div className="strategy-mode-switch" aria-label="Preflop editor mode">
        <button type="button" aria-pressed={editorMode === 'ranges'} onClick={() => setEditorMode('ranges')}>Ranges</button>
        <button type="button" aria-pressed={editorMode === 'sizing'} onClick={() => setEditorMode('sizing')}>Sizing</button>
      </div>
      {editorMode === 'ranges' ? (
        <>
          <div className="strategy-filter-grid">
            <SelectControl label="Format" value={format} onChange={(value) => setFormat(value as typeof format)} options={['all', 'heads-up', 'six-max']} />
            <SelectControl label="Position" value={position} onChange={setPosition} options={['all', 'BTN/SB', 'BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']} />
            <SelectControl label="Stack" value={stackDepth} onChange={(value) => setStackDepth(value as typeof stackDepth)} options={['all', 'short', 'medium', 'deep']} />
            <SelectControl label="Situation" value={situation} onChange={setSituation} options={['all', 'unopened', 'facingLimp', 'facingOpen', 'facingOpenWithCallers', 'facingRaiseAfterLimp', 'facingThreeBet', 'facingFourBet']} />
          </div>
          <label>
            <span>Range node</span>
            <select aria-label="Preflop range node" value={selectedNode?.id ?? ''} onChange={(event) => setSelectedNodeId(event.target.value)}>
              {filteredNodes.map((node) => (
                <option key={node.id} value={node.id}>{node.id}</option>
              ))}
            </select>
          </label>
          {selectedNode ? (
            <div className="range-editor-layout">
              <div className="preflop-matrix-scroll">
                <div className="preflop-matrix" role="grid" aria-label="Preflop hand matrix">
                  {RANKS.flatMap((rowRank, rowIndex) => RANKS.map((columnRank, columnIndex) => {
                    const handClass = matrixHandClass(rowRank, columnRank, rowIndex, columnIndex)
                    const handMix = selectedNode.hands[handClass]
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        className={`${dominantMixClass(handMix)} ${selectedHandClass === handClass ? 'selected' : ''}`}
                        aria-pressed={selectedHandClass === handClass}
                        title={mixTitle(handMix)}
                        key={handClass}
                        onClick={() => setSelectedHandClass(handClass)}
                      >
                        {handClass}
                      </button>
                    )
                  }))}
                </div>
              </div>
              <div className="hand-mix-editor">
                <strong>{selectedHandClass}</strong>
                {PREFLOP_ACTIONS.map((action) => (
                  <NumericControl
                    key={action}
                    label={humanize(action)}
                    value={mix.find((entry) => entry.action === action)?.frequency ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!draft}
                    onChange={(value) => updateMix(action, value)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">No range nodes match these filters.</p>
          )}
        </>
      ) : (
        <NumericObjectEditor
          title="Preflop Sizing"
          values={strategy.sizing}
          disabled={!draft}
          max={6}
          onChange={(key, value) => updateDraft(setDraft, (next) => {
            if (next.preflopStrategy) {
              setNumeric(next.preflopStrategy.sizing, key, value)
            }
          })}
        />
      )}
    </section>
  )
}

function PostflopEditor({ profile, draft, setDraft }: EditorProps) {
  const strategy = profile.postflopStrategy
  const [selectedGroup, setSelectedGroup] = useState<keyof Pick<NpcPostflopStrategy, 'frequencies' | 'sizing' | 'thresholds' | 'modifiers' | 'defense'>>('frequencies')
  if (!strategy) {
    return <section className="strategy-editor-band"><p className="muted">No postflop strategy configured.</p></section>
  }
  const groups: Array<{ title: string; key: keyof Pick<NpcPostflopStrategy, 'frequencies' | 'sizing' | 'thresholds' | 'modifiers' | 'defense'>; min?: number; max: number }> = [
    { title: 'Action Frequencies', key: 'frequencies', max: 1 },
    { title: 'Bet Sizing', key: 'sizing', max: 5 },
    { title: 'Hand Thresholds', key: 'thresholds', max: 1 },
    { title: 'Context Modifiers', key: 'modifiers', max: 1 },
    { title: 'MDF Defense', key: 'defense', min: 0, max: 1 },
  ]
  const group = groups.find((candidate) => candidate.key === selectedGroup) ?? groups[0]
  const values = strategy[group.key]
  return (
    <section className="strategy-editor-band" aria-label="Postflop strategy editor">
      <div className="section-heading">
        <h3>Postflop Strategy</h3>
        <span>{strategy.id}</span>
      </div>
      <label className="postflop-group-picker">
        <span>Parameter group</span>
        <select
          aria-label="Postflop parameter group"
          value={group.key}
          onChange={(event) => setSelectedGroup(event.target.value as typeof selectedGroup)}
        >
          {groups.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>{candidate.title}</option>
          ))}
        </select>
      </label>
      {values && (
        <NumericObjectEditor
          key={group.key}
          title={group.title}
          values={values}
          min={group.min}
          max={group.max}
          disabled={!draft}
          onChange={(key, value) => updateDraft(setDraft, (next) => {
            const target = next.postflopStrategy?.[group.key]
            if (target) {
              setNumeric(target, key, value)
            }
          })}
        />
      )}
    </section>
  )
}

function ScenarioSimulator({ profile }: { profile: NpcStrategyProfile }) {
  const [scenario, setScenario] = useState<NpcPostflopDefenseScenario>({
    potBeforeWager: 100,
    wager: 50,
    heroStack: 200,
    madeStrength: 0.4,
    draw: 'none',
    boardTexture: 'dry',
    heroPosition: 'BB',
    opponentCount: 1,
    heroRangeTop: 0.3,
    opponentRangeTop: 0.3,
    roll: 0.55,
  })
  const result = useMemo(() => simulatePostflopDefenseScenario(profile, scenario), [profile, scenario])
  return (
    <section className="strategy-editor-band" aria-label="NPC decision simulator">
      <div className="section-heading">
        <h3>Decision Simulator</h3>
        <span>fixed roll {scenario.roll.toFixed(2)}</span>
      </div>
      <div className="simulator-layout">
        <div className="strategy-control-grid">
          <ScenarioNumber label="Pot before wager" field="potBeforeWager" scenario={scenario} setScenario={setScenario} max={1000} />
          <ScenarioNumber label="Wager" field="wager" scenario={scenario} setScenario={setScenario} max={1000} />
          <ScenarioNumber label="Effective stack" field="heroStack" scenario={scenario} setScenario={setScenario} max={2000} />
          <ScenarioNumber label="Made strength" field="madeStrength" scenario={scenario} setScenario={setScenario} max={1} step={0.01} />
          <ScenarioNumber label="Hero range top" field="heroRangeTop" scenario={scenario} setScenario={setScenario} max={1} step={0.01} />
          <ScenarioNumber label="Opponent range top" field="opponentRangeTop" scenario={scenario} setScenario={setScenario} max={1} step={0.01} />
          <ScenarioNumber label="Policy roll" field="roll" scenario={scenario} setScenario={setScenario} max={1} step={0.01} />
          <ScenarioNumber label="Opponents" field="opponentCount" scenario={scenario} setScenario={setScenario} max={5} step={1} />
          <SelectControl label="Draw" value={scenario.draw} onChange={(draw) => setScenario((current) => ({ ...current, draw: draw as typeof scenario.draw }))} options={['none', 'draw', 'strongDraw']} />
          <SelectControl label="Texture" value={scenario.boardTexture} onChange={(boardTexture) => setScenario((current) => ({ ...current, boardTexture: boardTexture as typeof scenario.boardTexture }))} options={['dry', 'dynamic', 'wet', 'paired']} />
          <SelectControl label="Position" value={scenario.heroPosition} onChange={(heroPosition) => setScenario((current) => ({ ...current, heroPosition: heroPosition as typeof scenario.heroPosition }))} options={['BTN', 'CO', 'BB']} />
        </div>
        <div className="simulation-trace" aria-live="polite">
          {result.ok ? (
            <>
              <strong>{result.decision.command.type}</strong>
              <span>{humanize(result.decision.reason)}</span>
              <dl>
                <TraceMetric label="Continue" value={result.decision.continueProbability} />
                <TraceMetric label="MDF" value={result.decision.metrics.minimumDefenseFrequency} />
                <TraceMetric label="Pot odds" value={result.decision.metrics.potOdds} />
                <TraceMetric label="Bet / pot" value={result.decision.metrics.betToPotRatio} />
                <TraceMetric label="Range disadvantage" value={result.decision.rangeDisadvantage} />
                <TraceMetric label="Effective SPR" value={result.decision.effectiveStackToPotRatio} />
              </dl>
            </>
          ) : <p className="error">{result.error}</p>}
        </div>
      </div>
    </section>
  )
}

interface EditorProps {
  profile: NpcStrategyProfile
  draft: NpcStrategyProfile | null
  setDraft: React.Dispatch<React.SetStateAction<NpcStrategyProfile | null>>
}

function NumericObjectEditor({
  title,
  values,
  disabled,
  min = 0,
  max,
  onChange,
}: {
  title: string
  values: object
  disabled: boolean
  min?: number
  max: number
  onChange: (key: string, value: number) => void
}) {
  return (
    <div className="numeric-object-editor">
      <strong>{title}</strong>
      <div className="strategy-control-grid">
        {Object.entries(values).map(([key, value]) => (
          <NumericControl
            key={key}
            label={humanize(key)}
            value={value}
            min={key === 'foldBias' ? -0.5 : min}
            max={max}
            step={0.01}
            disabled={disabled}
            onChange={(nextValue) => onChange(key, nextValue)}
          />
        ))}
      </div>
    </div>
  )
}

function NumericControl({ label, value, min, max, step, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="strategy-number-control">
      <span>{label}</span>
      <div>
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
        <input aria-label={label} type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </label>
  )
}

function ScenarioNumber({ label, field, scenario, setScenario, max, step = 1 }: {
  label: string
  field: keyof Pick<NpcPostflopDefenseScenario, 'potBeforeWager' | 'wager' | 'heroStack' | 'madeStrength' | 'opponentCount' | 'heroRangeTop' | 'opponentRangeTop' | 'roll'>
  scenario: NpcPostflopDefenseScenario
  setScenario: React.Dispatch<React.SetStateAction<NpcPostflopDefenseScenario>>
  max: number
  step?: number
}) {
  return <NumericControl label={label} value={scenario[field]} min={field === 'opponentCount' ? 1 : 0} max={max} step={step} disabled={false} onChange={(value) => setScenario((current) => ({ ...current, [field]: value }))} />
}

function TextControl({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>
}

function SelectControl({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}</select></label>
}

function TraceMetric({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value.toFixed(3)}</dd></div>
}

function updateDraft(
  setDraft: React.Dispatch<React.SetStateAction<NpcStrategyProfile | null>>,
  mutate: (draft: NpcStrategyProfile) => void,
) {
  setDraft((current) => {
    if (!current) {
      return current
    }
    const next = structuredClone(current)
    mutate(next)
    return next
  })
}

function setNumeric(target: object, key: string, value: number) {
  const record = target as Record<string, number>
  record[key] = value
}

function matrixHandClass(rowRank: string, columnRank: string, rowIndex: number, columnIndex: number): string {
  if (rowIndex === columnIndex) {
    return `${rowRank}${columnRank}`
  }
  return rowIndex < columnIndex ? `${rowRank}${columnRank}s` : `${columnRank}${rowRank}o`
}

function dominantMixClass(mix: NpcPreflopStrategy['nodes'][number]['hands'][string]): string {
  const dominant = [...mix].sort((left, right) => right.frequency - left.frequency)[0]?.action ?? 'fold'
  return `mix-${dominant}`
}

function mixTitle(mix: NpcPreflopStrategy['nodes'][number]['hands'][string]): string {
  return mix.map((entry) => `${humanize(entry.action)} ${Math.round(entry.frequency * 100)}%`).join(', ')
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}
