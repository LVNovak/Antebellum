/**
 * LaborRoster.tsx
 *
 * Shows all workers grouped by labor type.
 * Default view: pooled summary per category.
 * Tap a category to expand individual worker cards.
 *
 * All workers are named individuals — see GDD Section 5.2.
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'
import { Worker, LaborType, HealthLevel, FamilyMemberRole } from '@engine/types'
import { getHealthLabel, getHealthColorClass } from '@engine/labor'

const LABOR_TYPE_LABELS: Record<LaborType, string> = {
  [LaborType.EnslavedPurchased]: 'Enslaved (Purchased)',
  [LaborType.EnslavedHiredOut]:  'Enslaved (Hired)',
  [LaborType.IndenturedBlack]:   'Indentured — Black',
  [LaborType.IndenturedWhite]:   'Indentured — White',
  [LaborType.FreeWage]:          'Free Wage Labor',
}

export default function LaborRoster() {
  const gameState = useGameStore(s => s.gameState)
  const [expandedType, setExpandedType] = useState<LaborType | null>(null)

  if (!gameState) return null

  const { workers, conditionsIndex, family } = gameState

  // Group workers by labor type
  const grouped = workers.reduce((acc, worker) => {
    const existing = acc[worker.laborType]
    if (!existing) acc[worker.laborType] = []
    acc[worker.laborType]!.push(worker)
    return acc
  }, {} as Partial<Record<LaborType, Worker[]>>)

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-earth-100 text-xl">Labor Roster</h2>
        <span className="text-earth-400 text-sm">{workers.length} workers</span>
      </div>

      {/* Family section — always shown first */}
      <div className="bg-earth-800 border border-earth-700 rounded overflow-hidden">
        <div className="px-4 py-2 bg-earth-750 border-b border-earth-700">
          <span className="text-earth-300 text-xs font-bold uppercase tracking-wide">Household</span>
        </div>
        {(family ?? []).map(member => (
          <div key={member.id} className="px-4 py-3 flex justify-between items-center border-b border-earth-700 last:border-0">
            <div>
              <span className="text-earth-100 text-sm font-bold">{member.name}</span>
              <span className="text-earth-500 text-xs ml-2">{member.role}</span>
              {member.age !== null && (
                <span className="text-earth-600 text-xs ml-1">age {member.age}</span>
              )}
            </div>
            <div className="text-right">
              <div className="text-earth-400 text-xs">
                {member.laborUnits === 0 ? 'No labor yet'
                  : member.laborUnits < 1 ? `${Math.round(member.laborUnits * 100)}% capacity`
                  : 'Full labor unit'}
              </div>
              {member.assignedTask && (
                <div className="text-earth-300 text-xs mt-0.5">{member.assignedTask.type ?? member.assignedTask}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Conditions Index */}
      <ConditionsIndexBar value={conditionsIndex} />

      {/* Labor category groups */}
      {(Object.keys(LABOR_TYPE_LABELS) as LaborType[]).map(type => {
        const group = grouped[type]
        if (!group || group.length === 0) return null

        const isExpanded = expandedType === type

        return (
          <div key={type} className="bg-earth-800 border border-earth-700 rounded overflow-hidden">
            {/* Group header — tap to expand */}
            <button
              onClick={() => setExpandedType(isExpanded ? null : type)}
              className="w-full px-4 py-3 flex items-center justify-between text-left"
            >
              <div>
                <div className="font-serif text-earth-100 text-sm font-bold">
                  {LABOR_TYPE_LABELS[type]}
                </div>
                <div className="text-earth-400 text-xs mt-0.5">
                  {group.length} worker{group.length !== 1 ? 's' : ''} · {getGroupHealthSummary(group)}
                </div>
              </div>
              <span className="text-earth-500 text-lg">{isExpanded ? '▲' : '▼'}</span>
            </button>

            {/* Individual worker cards — shown when expanded */}
            {isExpanded && (
              <div className="border-t border-earth-700 divide-y divide-earth-700">
                {group.map(worker => (
                  <WorkerCard key={worker.id} worker={worker} />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {workers.length === 0 && (
        <p className="text-earth-500 text-sm italic text-center py-8">
          No workers on the roster.
        </p>
      )}
    </div>
  )
}

// ── Conditions Index bar ───────────────────────────────────────────────────

function ConditionsIndexBar({ value }: { value: number }) {
  const color = value >= 70 ? 'bg-soil-good' : value >= 40 ? 'bg-soil-fair' : 'bg-soil-poor'
  const label = value >= 70 ? 'Good' : value >= 40 ? 'Strained' : 'Critical'

  return (
    <div className="bg-earth-800 border border-earth-700 rounded p-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-earth-300 text-xs">Conditions Index</span>
        <span className="text-earth-400 text-xs">{label}</span>
      </div>
      <div className="w-full bg-earth-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="text-earth-500 text-xs mt-1">
        Reflects the aggregate welfare of enslaved workers. Low values lead to resistance and productivity loss.
      </p>
    </div>
  )
}

// ── Individual worker card ─────────────────────────────────────────────────

function WorkerCard({ worker }: { worker: Worker; [key: string]: unknown }) {
  const healthClass = getHealthColorClass(worker.health)
  const healthLabel = getHealthLabel(worker.health)
  const releaseWorker = useGameStore(s => s.releaseWorker)
  const [confirming, setConfirming] = useState(false)

  const earlyContract = worker.contractSeasonsRemaining !== null && worker.contractSeasonsRemaining > 0

  function handleReleaseClick() {
    if (!confirming) { setConfirming(true); return }
    releaseWorker(worker.id)
  }

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-earth-100 text-sm font-bold">{worker.name}</div>
        <div className="text-earth-400 text-xs">
          Age {worker.age} · {worker.skill}
          {worker.contractSeasonsRemaining !== null && (
            <> · {worker.contractSeasonsRemaining} seasons on contract</>
          )}
        </div>
        {worker.assignedTask && (
          <div className="text-earth-500 text-xs mt-0.5">
            Task: {formatTask(worker.assignedTask)}
          </div>
        )}
        {confirming && (
          <div className="text-xs mt-1">
            <span className="text-soil-poor">
              {worker.laborType === LaborType.EnslavedPurchased && 'Sell for ~$250 (loss vs. purchase price)? '}
              {(worker.laborType === LaborType.IndenturedBlack || worker.laborType === LaborType.IndenturedWhite) && earlyContract && 'Releasing early costs $50 (contract dispute)? '}
              {(worker.laborType === LaborType.IndenturedBlack || worker.laborType === LaborType.IndenturedWhite) && !earlyContract && 'Contract complete — release with no penalty? '}
              {worker.laborType === LaborType.EnslavedHiredOut && 'End this hire-out arrangement? '}
              {worker.laborType === LaborType.FreeWage && 'End this worker\'s employment? '}
            </span>
            <button onClick={() => setConfirming(false)} className="text-earth-500 underline ml-1">Cancel</button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className={`text-xs font-bold ${healthClass}`}>
          {healthLabel}
        </div>
        <button
          onClick={handleReleaseClick}
          className={`text-[10px] px-2 py-0.5 rounded border ${
            confirming
              ? 'bg-red-900 border-red-700 text-red-200'
              : 'bg-earth-700 border-earth-600 text-earth-400'
          }`}
        >
          {confirming ? 'Confirm' : 'Release'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getGroupHealthSummary(workers: Worker[]): string {
  const healthy  = workers.filter(w => w.health === HealthLevel.Healthy).length
  const troubled = workers.filter(w =>
    w.health === HealthLevel.Sick || w.health === HealthLevel.VerySick
  ).length

  if (troubled > 0) return `${troubled} sick`
  if (healthy === workers.length) return 'All healthy'
  return `${healthy} healthy`
}

function formatTask(task: Worker['assignedTask']): string {
  if (!task) return 'Unassigned'
  switch (task.type) {
    case 'ClearLand':    return 'Clearing land'
    case 'PlantCrop':    return `Planting ${task.crop}`
    case 'TendCrop':     return 'Tending crops'
    case 'HarvestCrop':  return 'Harvesting'
    case 'RepairCabin':  return 'Repairing quarters'
    case 'ManageStorage': return 'Managing storage'
    case 'TendCompost': return 'Tending compost'
    case 'Rest':         return 'Resting'
    default:             return 'Working'
  }
}
