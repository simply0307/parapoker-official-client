import { useEffect, useMemo, useState } from 'react'
import type { NpcStrategyProfile } from '../npc/config'
import {
  calibrateNpcStrategy,
  DEFAULT_NPC_CALIBRATION_FILTERS,
  type NpcCalibrationFilters,
  type NpcCalibrationMetric,
} from '../npc/npcStrategyCalibration'
import { StrategyCalibrationSummary } from './AdminStrategyIntent'
import { validateNpcStrategyBehavior } from '../npc/npcStrategyValidation'

export function AdminStrategyCalibration({ profile, profiles }: {
  profile: NpcStrategyProfile
  profiles: NpcStrategyProfile[]
}) {
  const [filters, setFilters] = useState<NpcCalibrationFilters>({ ...DEFAULT_NPC_CALIBRATION_FILTERS })
  const [comparisonProfileId, setComparisonProfileId] = useState(
    profiles.find((candidate) => candidate.id !== profile.id)?.id ?? '',
  )
  const validation = useMemo(() => validateNpcStrategyBehavior(profile, filters), [filters, profile])
  const report = validation.calibration
  const comparisonProfile = profiles.find((candidate) => candidate.id === comparisonProfileId && candidate.id !== profile.id)
  const comparison = useMemo(
    () => comparisonProfile ? calibrateNpcStrategy(comparisonProfile, filters) : undefined,
    [comparisonProfile, filters],
  )

  useEffect(() => {
    if (comparisonProfileId === profile.id || !profiles.some((candidate) => candidate.id === comparisonProfileId)) {
      setComparisonProfileId(profiles.find((candidate) => candidate.id !== profile.id)?.id ?? '')
    }
  }, [comparisonProfileId, profile.id, profiles])

  function updateFilter<TKey extends keyof NpcCalibrationFilters>(key: TKey, value: NpcCalibrationFilters[TKey]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className="strategy-editor-band calibration-editor" aria-label="NPC strategy calibration">
      <div className="section-heading">
        <h3>Batch Calibration</h3>
        <span>{report.preflop.nodeCount} range nodes</span>
      </div>
      <StrategyCalibrationSummary profile={profile} validation={validation} />
      <div className="calibration-toolbar">
        <CalibrationSelect
          label="Calibration format"
          value={filters.format}
          onChange={(value) => updateFilter('format', value as NpcCalibrationFilters['format'])}
          options={['all', 'heads-up', 'six-max']}
        />
        <CalibrationSelect
          label="Calibration stack"
          value={filters.stackDepth}
          onChange={(value) => updateFilter('stackDepth', value as NpcCalibrationFilters['stackDepth'])}
          options={['all', 'short', 'medium', 'deep']}
        />
        <CalibrationSelect
          label="Calibration position"
          value={filters.position}
          onChange={(value) => updateFilter('position', value as NpcCalibrationFilters['position'])}
          options={['all', 'BTN/SB', 'BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']}
        />
        <CalibrationSelect
          label="Calibration situation"
          value={filters.situation}
          onChange={(value) => updateFilter('situation', value as NpcCalibrationFilters['situation'])}
          options={['all', 'unopened', 'facingLimp', 'facingOpen', 'facingOpenWithCallers', 'facingRaiseAfterLimp', 'facingThreeBet', 'facingFourBet']}
        />
        <CalibrationSelect
          label="Calibration texture"
          value={filters.texture}
          onChange={(value) => updateFilter('texture', value as NpcCalibrationFilters['texture'])}
          options={['all', 'dry', 'dynamic', 'wet', 'paired']}
        />
        <CalibrationSelect
          label="Calibration table shape"
          value={filters.tableShape}
          onChange={(value) => updateFilter('tableShape', value as NpcCalibrationFilters['tableShape'])}
          options={['all', 'heads-up', 'multiway']}
        />
        <CalibrationSelect
          label="Calibration bet size"
          value={filters.betSize}
          onChange={(value) => updateFilter('betSize', value as NpcCalibrationFilters['betSize'])}
          options={['all', 'small', 'medium', 'large']}
        />
        <label>
          <span>Comparison profile</span>
          <select
            aria-label="Comparison profile"
            value={comparisonProfile?.id ?? ''}
            onChange={(event) => setComparisonProfileId(event.target.value)}
          >
            <option value="">None</option>
            {profiles.filter((candidate) => candidate.id !== profile.id).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name} v{candidate.version}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="calibration-results-scroll">
        <ValidationSampleTable validation={validation} />
        <CalibrationRateTable
          title="Preflop Projection"
          currentName={profile.name}
          comparisonName={comparisonProfile?.name}
          rows={[
            calibrationMetricRow('Projected VPIP', report.preflop.vpipRate, comparison?.preflop.vpipRate),
            calibrationMetricRow('Open raise', report.preflop.openRaiseRate, comparison?.preflop.openRaiseRate),
            calibrationMetricRow('Three-bet', report.preflop.threeBetRate, comparison?.preflop.threeBetRate),
            calibrationMetricRow('Squeeze', report.preflop.squeezeRate, comparison?.preflop.squeezeRate),
            calibrationMetricRow('Fold to three-bet', report.preflop.foldToThreeBetRate, comparison?.preflop.foldToThreeBetRate),
          ]}
        />
        <CalibrationRateTable
          title={`Defense Batch (${report.postflopDefense.scenarioCount} scenarios)`}
          currentName={profile.name}
          comparisonName={comparisonProfile?.name}
          rows={[
            rateRow('Continue overall', report.postflopDefense.expectedContinueRate, comparison?.postflopDefense.expectedContinueRate),
            rateRow('Continue vs small bet', report.postflopDefense.smallBetContinueRate, comparison?.postflopDefense.smallBetContinueRate),
            rateRow('Continue vs large bet', report.postflopDefense.largeBetContinueRate, comparison?.postflopDefense.largeBetContinueRate),
            rateRow('Continue with draw', report.postflopDefense.drawContinueRate, comparison?.postflopDefense.drawContinueRate),
            rateRow('Bluff catch', report.postflopDefense.bluffCatchContinueRate, comparison?.postflopDefense.bluffCatchContinueRate),
            rateRow('Heads-up continue', report.postflopDefense.headsUpContinueRate, comparison?.postflopDefense.headsUpContinueRate),
            rateRow('Multiway continue', report.postflopDefense.multiwayContinueRate, comparison?.postflopDefense.multiwayContinueRate),
          ]}
        />
        <CalibrationRateTable
          title={`Initiative Batch (${report.postflopProactive.scenarioCount} scenarios)`}
          currentName={profile.name}
          comparisonName={comparisonProfile?.name}
          rows={[
            rateRow('Bet overall', report.postflopProactive.betRate, comparison?.postflopProactive.betRate),
            rateRow('Continuation bet', report.postflopProactive.continuationBetRate, comparison?.postflopProactive.continuationBetRate),
            rateRow('Barrel', report.postflopProactive.barrelRate, comparison?.postflopProactive.barrelRate),
            rateRow('Probe bet', report.postflopProactive.probeBetRate, comparison?.postflopProactive.probeBetRate),
            rateRow('Semi-bluff', report.postflopProactive.semiBluffRate, comparison?.postflopProactive.semiBluffRate),
            rateRow('Value bet', report.postflopProactive.valueBetRate, comparison?.postflopProactive.valueBetRate),
            rateRow('Pure bluff', report.postflopProactive.bluffBetRate, comparison?.postflopProactive.bluffBetRate),
            rateRow('Average pot fraction', report.postflopProactive.averagePotFraction, comparison?.postflopProactive.averagePotFraction),
          ]}
        />
      </div>
    </section>
  )
}

function ValidationSampleTable({ validation }: {
  validation: ReturnType<typeof validateNpcStrategyBehavior>
}) {
  return (
    <section className="calibration-table-section" aria-label="Deterministic behavior validation">
      <h4>Target And Deterministic Sample</h4>
      <table className="calibration-table validation-sample-table">
        <thead>
          <tr><th>Metric</th><th>Projected</th><th>Observed sample</th><th>Target</th></tr>
        </thead>
        <tbody>
          {validation.metrics.map((metric) => (
            <tr key={metric.id}>
              <th scope="row">{metric.label}</th>
              <td>{formatRate(metric.value)}</td>
              <td>{formatRate(metric.observed)}</td>
              <td className={metric.status}>{metric.band ? `${formatRate(metric.band.min)}-${formatRate(metric.band.max)}` : 'Unbounded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Observed samples use independent deterministic streams over bounded decision scenarios; they test reproducibility, not solver optimality.</p>
    </section>
  )
}

function CalibrationSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
      </select>
    </label>
  )
}

interface CalibrationRow {
  label: string
  value: number
  comparison?: number
  sampleWeight?: number
}

function CalibrationRateTable({ title, currentName, comparisonName, rows }: {
  title: string
  currentName: string
  comparisonName?: string
  rows: CalibrationRow[]
}) {
  return (
    <section className="calibration-table-section">
      <h4>{title}</h4>
      <table className="calibration-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">{currentName}</th>
            {comparisonName && <th scope="col">{comparisonName}</th>}
            {comparisonName && <th scope="col">Delta</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">
                {row.label}
                {row.sampleWeight !== undefined && <span>{row.sampleWeight.toLocaleString()} combos</span>}
              </th>
              <td>{formatRate(row.value)}</td>
              {comparisonName && <td>{row.comparison === undefined ? 'n/a' : formatRate(row.comparison)}</td>}
              {comparisonName && <td>{row.comparison === undefined ? 'n/a' : formatDelta(row.value - row.comparison)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function calibrationMetricRow(label: string, metric: NpcCalibrationMetric, comparison?: NpcCalibrationMetric): CalibrationRow {
  return { label, value: metric.value, comparison: comparison?.value, sampleWeight: metric.sampleWeight }
}

function rateRow(label: string, value: number, comparison?: number): CalibrationRow {
  return { label, value, comparison }
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatDelta(value: number): string {
  const percentage = value * 100
  return `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)} pp`
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())
}
