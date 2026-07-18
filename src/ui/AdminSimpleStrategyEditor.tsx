import { useMemo, useState } from 'react'
import type { NpcStrategyProfile } from '../npc/config'
import type { NpcObservedStrategyEvidence } from '../npc/npcObservedStrategyStats'
import {
  inferSimpleStrategyIntent,
  previewSimpleStrategyChange,
  type NpcSimpleStrategyIntent,
} from '../npc/npcSimpleStrategy'

export function AdminSimpleStrategyEditor({
  profile,
  editable,
  onApply,
  evidence,
}: {
  profile: NpcStrategyProfile
  editable: boolean
  onApply: (intent: NpcSimpleStrategyIntent) => void
  evidence?: NpcObservedStrategyEvidence
}) {
  const [intent, setIntent] = useState<NpcSimpleStrategyIntent>(() => inferSimpleStrategyIntent(profile))

  const preview = useMemo(() => previewSimpleStrategyChange(profile, intent), [intent, profile])

  function update<TKey extends keyof NpcSimpleStrategyIntent>(
    key: TKey,
    value: NpcSimpleStrategyIntent[TKey],
  ) {
    setIntent((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className="simple-strategy-editor" aria-label="Simple strategy editor">
      <div className="simple-strategy-intro">
        <div>
          <p className="eyebrow">Broad strategy builder</p>
          <h3>Describe the player you want at the table</h3>
        </div>
        <span>{editable ? 'Draft ready' : 'Create a version to apply'}</span>
      </div>

      <div className="simple-strategy-controls">
        <Choice
          label="Preflop ranges"
          value={intent.preflopStyle}
          options={[['tight', 'Tight'], ['balanced', 'Balanced'], ['loose', 'Loose']]}
          onChange={(value) => update('preflopStyle', value as NpcSimpleStrategyIntent['preflopStyle'])}
        />
        <Choice
          label="Pressure"
          value={intent.pressure}
          options={[['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High']]}
          onChange={(value) => update('pressure', value as NpcSimpleStrategyIntent['pressure'])}
        />
        <Choice
          label="Postflop plan"
          value={intent.postflopPlan}
          options={[['pot-control', 'Pot control'], ['balanced', 'Balanced'], ['value-first', 'Value first'], ['draw-pressure', 'Draw pressure']]}
          onChange={(value) => update('postflopPlan', value as NpcSimpleStrategyIntent['postflopPlan'])}
        />
        <Choice
          label="Defense"
          value={intent.defense}
          options={[['selective', 'Selective'], ['balanced', 'Balanced'], ['sticky', 'Sticky']]}
          onChange={(value) => update('defense', value as NpcSimpleStrategyIntent['defense'])}
        />
        <Choice
          label="Bet sizing"
          value={intent.sizing}
          options={[['small', 'Small'], ['mixed', 'Mixed'], ['large', 'Large']]}
          onChange={(value) => update('sizing', value as NpcSimpleStrategyIntent['sizing'])}
        />
        <Choice
          label="Context awareness"
          value={intent.context}
          options={[['straightforward', 'Straightforward'], ['position-aware', 'Position aware'], ['multiway-cautious', 'Multiway cautious']]}
          onChange={(value) => update('context', value as NpcSimpleStrategyIntent['context'])}
        />
      </div>

      <div className="simple-strategy-sentence" aria-label="Simple strategy summary">
        <strong>At the table</strong>
        <p>{preview.sentence}</p>
        <span>Calibration target: {preview.targetName}</span>
      </div>

      <div className="simple-teaching-identity" aria-label="Teaching identity summary">
        <strong>Teaching identity</strong>
        <span>{profile.teaching?.teachingObjective ?? 'No teaching objective configured.'}</span>
        <span>{profile.teaching?.intentionallyExploitable ? 'Intentionally exploitable' : 'No intentional strategic leak declared'}</span>
        <small>{profile.teaching?.intendedTendencies.map((tendency) => tendency.id).join(', ') || 'No intended leak tags'}</small>
      </div>

      <div className="simple-strategy-preview" aria-label="Simple strategy change preview">
        <div className="section-heading">
          <h3>Change preview</h3>
          <span>Current to proposed</span>
        </div>
        <dl>
          {preview.metrics.map((metric) => (
            <div key={metric.label}>
              <dt>{metric.label}</dt>
              <dd>
                <span>{format(metric.before)}</span>
                <span aria-hidden="true">to</span>
                <strong>{format(metric.after)}</strong>
              </dd>
            </div>
          ))}
        </dl>
        <div className="simple-causal-preview" aria-label="Causal strategy preview">
          <strong>Causal changes</strong>
          {preview.controlChanges.length === 0 ? (
            <p>No broad control differs from the closest Simple representation of this profile.</p>
          ) : preview.controlChanges.map((change) => (
            <div key={change.control}>
              <span>{change.control}: {change.before} to {change.after}</span>
              <small>Runtime: {change.runtimeChanges.join(', ')}</small>
              <p>{change.projectedEffect}</p>
            </div>
          ))}
        </div>
        <div className="simple-strategy-module-summary">
          <strong>Coverage tags changed</strong>
          <span>{preview.changedModules.length > 0 ? preview.changedModules.join(', ') : 'No descriptive module changes'}</span>
        </div>
        <div className={`simple-strategy-validation ${preview.warnings.length > 0 ? 'review' : 'clear'}`}>
          <strong>{preview.warnings.length > 0 ? 'Configuration review' : 'Configuration valid'}</strong>
          <span>{preview.warnings.length > 0 ? preview.warnings.join(' ') : 'No structural strategy warnings in the generated profile.'}</span>
        </div>
      </div>

      <div className="simple-coverage-summary" aria-label="Strategy decision coverage">
        <strong>Observed decision coverage</strong>
        {!evidence?.decisionCoverage || evidence.decisionCoverage.totalDecisions === 0 ? (
          <span>Insufficient archived trace sample.</span>
        ) : (
          <>
            <span>{evidence.decisionCoverage.totalDecisions} archived decisions; {(evidence.decisionCoverage.fallbackRate * 100).toFixed(1)}% fallback.</span>
            <small>
              Range {(evidence.decisionCoverage.sourceRates['preflop-range'] * 100).toFixed(1)}% · proactive {(evidence.decisionCoverage.sourceRates['proactive-postflop'] * 100).toFixed(1)}% · defense {(evidence.decisionCoverage.sourceRates['postflop-defense'] * 100).toFixed(1)}%
            </small>
          </>
        )}
      </div>

      <div className="simple-strategy-apply">
        <p>
          Applying regenerates the covered preflop ranges and postflop controls. Review or refine the result in Advanced mode before saving.
        </p>
        <button type="button" className="primary" disabled={!editable} onClick={() => onApply(intent)}>
          Apply broad changes
        </button>
      </div>
    </section>
  )
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )
}

function format(value: number): string {
  return value.toFixed(2)
}
