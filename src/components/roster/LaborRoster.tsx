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
import { Worker, LaborType, HealthLevel } from '@engine/types'
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

  const { workers, conditionsIndex } = gameState

  // Group workers by labor type
  const grouped = workers.reduce((acc, worker) => {
    if (!acc[worker.laborType]) acc[worker.laborType] = []
    acc[worker.laborType].push(worker)
    return acc
  }, {} as Partial<Record<LaborType, Worker[]>>)

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-earth-100 text-xl">Labor Roster</h2>
        <span className="text-earth-400 text-sm">{workers.length} total</span>
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

function WorkerCard({ worker }: { worker: Worker }) {
  const healthClass = getHealthColorClass(worker.health)
  const healthLabel = getHealthLabel(worker.health)

  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div>
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
      </div>
      <div className={`text-xs font-bold ${healthClass}`}>
        {healthLabel}
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
    case 'Rest':         return 'Resting'
    default:             return 'Working'
  }
}
