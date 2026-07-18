import { useMemo } from 'react'
import type {
  NpcStrategyCalibrationBand,
  NpcStrategyCalibrationMetricId,
  NpcStrategyProfile,
  NpcStrategyTargetPresetId,
} from '../npc/config'
import {
  NPC_STRATEGY_TARGET_PRESETS,
  validateNpcStrategyBehavior,
  type NpcStrategyValidationReport,
} from '../npc/npcStrategyValidation'
import type { NpcObservedStrategyEvidence } from '../npc/npcObservedStrategyStats'

export function AdminStrategyIntent({
  profile,
  evidence,
  editable,
  onSelectPreset,
  onUpdateBand,
}: {
  profile: NpcStrategyProfile
  evidence?: NpcObservedStrategyEvidence
  editable: boolean
  onSelectPreset: (presetId: NpcStrategyTargetPresetId) => void
  onUpdateBand: (metricId: NpcStrategyCalibrationMetricId, band: NpcStrategyCalibrationBand) => void
}) {
  const validation = useMemo(() => validateNpcStrategyBehavior(profile, undefined, evidence), [evidence, profile])
  const preset = NPC_STRATEGY_TARGET_PRESETS.find((candidate) => candidate.id === validation.target.presetId)

  return (
    <section className="strategy-editor-band strategy-intent" aria-label="Strategy calibration intent">
      <div className="section-heading">
        <h3>1. Choose The Intended Player</h3>
        <span>{editable ? 'editable target' : 'create a version to change'}</span>
      </div>
      <p className="strategy-intro">
        Start with the behavior you want to observe. Ranges, frequencies, sizing, and context modifiers are the
        implementation; calibration checks whether they produce that intended style.
      </p>
      <label className="strategy-target-picker">
        <span>Calibration target</span>
        <select
          aria-label="Strategy calibration target"
          value={validation.target.presetId}
          disabled={!editable}
          onChange={(event) => onSelectPreset(event.target.value as NpcStrategyTargetPresetId)}
        >
          {NPC_STRATEGY_TARGET_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </select>
      </label>
      <p className="strategy-target-summary">{preset?.summary}</p>
      <StrategyCalibrationSummary profile={profile} evidence={evidence} validation={validation} />

      <details className="strategy-band-editor">
        <summary>Fine-tune target bands</summary>
        <p className="muted">
          Bands describe acceptable observed behavior, not exact actions in every hand. Editing a preset band creates a custom target.
        </p>
        <div className="strategy-band-table-wrap">
          <table className="strategy-band-table">
            <thead><tr><th>Metric</th><th>Minimum</th><th>Maximum</th><th>Current</th></tr></thead>
            <tbody>
              {validation.metrics.map((metric) => (
                <tr key={metric.id}>
                  <th scope="row">{metric.label}</th>
                  <td><BandInput label={`${metric.label} minimum`} value={metric.band?.min ?? 0} disabled={!editable} onChange={(min) => onUpdateBand(metric.id, { min, max: metric.band?.max ?? 1 })} /></td>
                  <td><BandInput label={`${metric.label} maximum`} value={metric.band?.max ?? 1} disabled={!editable} onChange={(max) => onUpdateBand(metric.id, { min: metric.band?.min ?? 0, max })} /></td>
                  <td>{formatRate(metric.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <StrategyEditorGuide />
    </section>
  )
}

export function StrategyCalibrationSummary({
  profile,
  evidence,
  validation: suppliedValidation,
  onOpenCalibration,
}: {
  profile: NpcStrategyProfile
  evidence?: NpcObservedStrategyEvidence
  validation?: NpcStrategyValidationReport
  onOpenCalibration?: () => void
}) {
  const computedValidation = useMemo(() => validateNpcStrategyBehavior(profile, undefined, evidence), [evidence, profile])
  const validation = suppliedValidation ?? computedValidation
  const visibleMetrics = validation.metrics.slice(0, 6)
  const visibleIssues = validation.issues.slice(0, 4)
  return (
    <section className="strategy-validation-summary" aria-label="Strategy target summary">
      <div className="strategy-validation-heading">
        <div>
          <span className={`strategy-status ${validation.status}`}>{humanize(validation.status)}</span>
          <strong>{validation.targetName} target</strong>
        </div>
        <span>{evidence
          ? `${evidence.handCount} archived hands across ${evidence.matchIds.length} matches${evidence.handCount < 20 ? ' · insufficient sample' : ''}`
          : `${Math.round(validation.score * 100)}% of bounded metrics inside target`}</span>
      </div>
      <div className="strategy-metric-strip">
        {visibleMetrics.map((metric) => (
          <div key={metric.id} className={`strategy-metric ${metric.status}`}>
            <span>{metric.label}</span>
            <strong>{formatRate(metric.observedSource === 'verified-match' ? metric.observed : metric.value)}</strong>
            <small>{metric.observedSource === 'verified-match'
              ? `archived n=${metric.observedSampleCount}${metric.observedSampleCount < 20 ? ' · small sample' : ''}`
              : metric.band ? `${formatRate(metric.band.min)}-${formatRate(metric.band.max)}` : 'No band'}</small>
          </div>
        ))}
      </div>
      {visibleIssues.length > 0 ? (
        <ul className="strategy-issue-list">
          {visibleIssues.map((issue) => <li className={issue.severity} key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : <p className="strategy-validation-clear">Configuration valid; no target or structural warnings in this view.</p>}
      {onOpenCalibration && <button type="button" onClick={onOpenCalibration}>Open full calibration</button>}
    </section>
  )
}

function StrategyEditorGuide() {
  return (
    <details className="strategy-guide">
      <summary>Strategy editor key and poker-theory guide</summary>
      <div className="strategy-guide-grid">
        <GuideItem term="Target bands" text="Expected population-level behavior. Being outside a band is a review signal, not proof that an individual action is wrong." />
        <GuideItem term="Range and frequency" text="A range is the set of hand classes reaching a node. A frequency is how often an allowed action is mixed with those hands." />
        <GuideItem term="VPIP" text="Voluntarily put chips in pot. It approximates preflop looseness; blind posts and free checks are not voluntary actions." />
        <GuideItem term="Open raise / three-bet" text="Open raise is first-in aggression. A three-bet reraises an opener. Squeezes are reraises after an open and at least one caller." />
        <GuideItem term="Pot odds" text="The immediate price of calling. Draw equity, implied value, stack pressure, and range composition can justify deviating from the raw price." />
        <GuideItem term="MDF" text="Minimum defense frequency is pot divided by pot plus bet. It is a heads-up bluff-indifference reference, not an instruction to defend every hand at that rate." />
        <GuideItem term="C-bet / barrel / probe" text="A continuation bet follows prior-street initiative; a barrel continues betting later; a probe attacks after the previous aggressor declines to bet." />
        <GuideItem term="Texture and range advantage" text="Connected or suited boards change draw density. Range advantage estimates which player retains more strong combinations after the action history." />
        <GuideItem term="Effective stack and SPR" text="Only chips that can be contested matter. Lower stack-to-pot ratios increase commitment and reduce room for multi-street maneuvering." />
        <GuideItem term="Configuration review" text="Projected rates come from configured ranges and bounded decision scenarios. Deterministic samples check stability; they are not a GTO solve or an all-game-tree calculation." />
      </div>
    </details>
  )
}

function GuideItem({ term, text }: { term: string; text: string }) {
  return <div><strong>{term}</strong><p>{text}</p></div>
}

function BandInput({ label, value, disabled, onChange }: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return <input aria-label={label} type="number" min={0} max={1.25} step={0.01} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function humanize(value: string): string {
  return value.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase())
}
