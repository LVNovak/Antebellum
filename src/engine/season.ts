/**
 * season.ts
 *
 * The core turn engine — the heart of the game.
 *
 * resolveSeasonEnd() takes the current GameState and returns a new GameState
 * representing the end of the current season. It is a pure function:
 * same input always produces the same output (aside from random events).
 *
 * Order of resolution each season:
 *   1. Draw weather event
 *   2. Update all tile soil values (one O(n) pass)
 *   3. Compute harvests for tiles with crops ready
 *   4. Apply spoilage to storage
 *   5. Process queued sales through factor
 *   6. Apply labor health changes
 *   7. Pay labor and housing upkeep
 *   8. Draw and resolve labor/economic events
 *   9. Update Conditions Index
 *   10. Check achievements
 *   11. Advance to next season/year
 *
 * This function never mutates its input — it always returns a fresh object.
 * This makes the game state easy to save, load, and debug.
 */

import {
  GameState,
  GameEvent,
  Season,
  WeatherEvent,
  CropType,
  LaborType,
  CabinCondition,
  DebugEntry,
  TileHistoryEntry,
} from './types'

import {
  WEATHER_WEIGHTS,
  WEATHER_YIELD_MODIFIER,
  CROP_BASE_YIELD_PER_TILE,
  FINANCE_RATES,
  LABOR_UNITS_PER_WORKER_PER_SEASON,
  CLEARED_MATERIAL_YIELD,
  TEND_MITIGATION_PER_WORKER,
  TEND_MAX_MITIGATION,
  LABOR_UPKEEP,
  LABOR_SEASONAL_COST,
  FREEDOM_DUES_CORN_UNITS,
  FREEDOM_DUES_CASH,
  FREEDOM_DUES_BUYOUT_CASH,
  CROP_COMPOST_YIELD_CHANCE,
  CROP_WEATHER_RESISTANCE,
  CROP_MIN_SEASONS_TO_HARVEST,
  CROP_YIELD_SCALE_BY_SEASONS,
} from './constants'

import { applySeasonalSoilUpdate, getSoilHint } from './soil'
import { recordTransaction } from './transactions'
import {
  applySeasonalHealthChanges,
  computeConditionsIndex,
  getResistanceProbability,
} from './labor'
import { generateSeasonalPrices, processQueuedSales, applySpoilage } from './market'
import { checkAchievements } from './achievements'

// ---------------------------------------------------------------------------
// MAIN SEASON RESOLVER
// ---------------------------------------------------------------------------

/**
 * Resolves the end of the current season and returns the next game state.
 *
 * This is the only function the UI ever needs to call to advance the game.
 * Everything else in the engine exists to support this function.
 */
export function resolveSeasonEnd(state: GameState): GameState {
  // Work on a deep copy so we never mutate the input
  let next = deepCopyState(state)
  const events: GameEvent[] = []
  const season = state.currentSeason
  const year   = state.currentYear
  const seasonsPlayed = (year - 1) * 4 + seasonIndex(season)

  // ── Step 1: Draw weather ──────────────────────────────────────────────────
  const weather = drawWeatherEvent(season)
  events.push(buildWeatherEvent(weather, season, year))

  // ── Step 2: Land clearing progress ────────────────────────────────────────
  // Tiles with workers assigned to ClearLand make progress toward being cleared.
  // Each assigned worker contributes 1 labor-season toward clearingProgressRemaining.
  const clearingWorkersByTile = countCombinedByTask(next.workers, next.family ?? [], 'ClearLand')

  next.tiles = next.tiles.map(tile => {
    if (tile.isCleared) return tile

    const workersAssigned = clearingWorkersByTile.get(tile.id) ?? 0
    if (workersAssigned === 0) return tile

    // Each worker contributes LABOR_UNITS_PER_WORKER_PER_SEASON toward
    // the tile's clearing pool (see constants.ts to retune pacing).
    const progressThisSeason = workersAssigned * LABOR_UNITS_PER_WORKER_PER_SEASON
    const newRemaining = Math.max(0, tile.clearingProgressRemaining - progressThisSeason)
    const justCleared  = newRemaining === 0

    // Crop clearing — workers clearing a tile that has a standing crop
    // generate some compost material from the plant matter being removed.
    if (workersAssigned > 0 && !justCleared && tile.currentCrop) {
      if (Math.random() < CROP_COMPOST_YIELD_CHANCE.clearing * workersAssigned) {
        next.clearedMaterialOnHand = (next.clearedMaterialOnHand ?? 0) + 1
      }
    }

    if (justCleared) {
      const materialYield = CLEARED_MATERIAL_YIELD[tile.terrain]
      next.clearedMaterialOnHand += materialYield

      events.push({
        id: generateId(), season, year,
        category: 'Economic',
        title: 'Land Cleared',
        description: materialYield > 0
          ? `A ${tile.terrain.toLowerCase()} parcel has been fully cleared and is ready to plant. ${materialYield} unit(s) of cleared material were collected and can be composted onto a field.`
          : `A ${tile.terrain.toLowerCase()} parcel has been fully cleared and is ready to plant.`,
        effects: ['Tile available for planting next season'],
      })
    }

    return {
      ...tile,
      clearingProgressRemaining: newRemaining,
      isCleared: justCleared,
      // Newly cleared forest/swamp tiles get stump rot
      hasStumpRot: justCleared && tile.terrain !== 'Upland',
      stumpRotSeasonsLeft: justCleared && tile.terrain !== 'Upland' ? 2 : tile.stumpRotSeasonsLeft,
    }
  })

  // Capture soil state BEFORE Step 3 updates it — used in debug log.
  // Must be captured here, not inside the harvest loop, or it reflects
  // post-update values (the bug that made soilBefore = soilAfter).
  const soilSnapshots = new Map(
    next.tiles.map(tile => [tile.id, { ...tile.soil }])
  )

  // ── Step 3: Update soil on all cleared tiles ──────────────────────────────
  const tendingWorkersByTile = countCombinedByTask(next.workers, next.family ?? [], 'TendCrop')

  // Tending generates compost material from weeding/pruning across all tiles
  for (const [, workerCount] of tendingWorkersByTile) {
    if (workerCount > 0 && Math.random() < CROP_COMPOST_YIELD_CHANCE.tending * workerCount) {
      next.clearedMaterialOnHand = (next.clearedMaterialOnHand ?? 0) + 1
    }
  }

  next.tiles = next.tiles.map(tile => {
    if (!tile.isCleared) return tile  // uncleared tiles don't change

    const tendingWorkers = tendingWorkersByTile.get(tile.id) ?? 0
    const tendingMitigation = weather === WeatherEvent.Normal
      ? 0
      : Math.min(TEND_MAX_MITIGATION, tendingWorkers * TEND_MITIGATION_PER_WORKER)

    const updatedSoil = applySeasonalSoilUpdate(
      tile,
      weather,
      false,  // manure not implemented in Phase 1
      tendingMitigation
    )

    // Check soil for qualitative hints
    const hint = getSoilHint(updatedSoil, tile.currentCrop, seasonsPlayed)
    if (hint) {
      events.push({
        id:          generateId(),
        season,
        year,
        category:   'Soil',
        title:      'Field Observation',
        description: hint,
        effects:     [],
      })
    }

    // Tick down stump rot countdown
    const stumpRotSeasonsLeft = Math.max(0, tile.stumpRotSeasonsLeft - 1)
    const hasStumpRot = stumpRotSeasonsLeft > 0

    // Increment seasonsInGround for any active crop
    const seasonsInGround = tile.currentCrop ? tile.seasonsInGround + 1 : 0

    return {
      ...tile,
      soil:              updatedSoil,
      hasStumpRot,
      stumpRotSeasonsLeft,
      seasonsInGround,
    }
  })

  // ── Step 4: Compute harvests ──────────────────────────────────────────────
  let harvestedCorn = 0
  const harvestingWorkersByTile = countCombinedByTask(next.workers, next.family ?? [], 'HarvestCrop')
  const frostDestroyed = season === Season.Autumn && weather === WeatherEvent.EarlyFrost

  const debugTileData: DebugEntry['tiles'] = []

  for (const tile of next.tiles) {
    // Use pre-Step-3 snapshot for soilBefore — after Step 3 the soil
    // has already been updated so tile.soil is already the post value.
    const soilBefore = soilSnapshots.get(tile.id) ?? tile.soil

    if (!tile.isCleared || !tile.currentCrop) {
      debugTileData.push({
        id: tile.id, terrain: tile.terrain, isCleared: tile.isCleared,
        crop: tile.currentCrop,
        soilBefore: snapSoil(soilBefore),
        soilAfter:  snapSoil(tile.soil),
        workersClearing:   clearingWorkersByTile.get(tile.id) ?? 0,
        workersPlanting:   0,
        workersTending:    tendingWorkersByTile.get(tile.id) ?? 0,
        workersHarvesting: harvestingWorkersByTile.get(tile.id) ?? 0,
        yieldProduced: 0,
      })
      continue
    }
    if (tile.currentCrop === CropType.Fallow || tile.currentCrop === CropType.CoverCrop) {
      debugTileData.push({
        id: tile.id, terrain: tile.terrain, isCleared: tile.isCleared,
        crop: tile.currentCrop,
        soilBefore: snapSoil(soilBefore),
        soilAfter:  snapSoil(tile.soil),
        workersClearing: 0, workersPlanting: 0,
        workersTending:  tendingWorkersByTile.get(tile.id) ?? 0,
        workersHarvesting: 0,
        yieldProduced: 0,
      })
      continue
    }

    let yieldProduced = 0

    const workersHarvesting = harvestingWorkersByTile.get(tile.id) ?? 0

    // Early frost only destroys crops left standing in the field —
    // tiles with harvest workers assigned are protected because the
    // workers collect the crop before the frost hits.
    // Player committed their harvest plan before advancing; frost is a
    // consequence of NOT harvesting, not a random wipe of planned work.
    if (frostDestroyed && workersHarvesting === 0) {
      // Subsistence crops (corn, sweet potato, cowpeas) partially survive
      // early frost — they mature faster and/or are hardier than tobacco.
      // Their CROP_WEATHER_RESISTANCE[EarlyFrost] gives a partial yield
      // even without harvest workers.
      const cropFrostResistance = tile.currentCrop
        ? (CROP_WEATHER_RESISTANCE[tile.currentCrop]?.[WeatherEvent.EarlyFrost] ?? 0)
        : 0
      if (cropFrostResistance > 0) {
        // Partial yield — treat as a reduced harvest (no workers needed, frost did the threshing)
        const baseYield = CROP_BASE_YIELD_PER_TILE[tile.currentCrop!] ?? 0
        const soilModifier = computeYieldModifierFromSoil(tile.soil)
        const partialYield = Math.floor(baseYield * soilModifier * cropFrostResistance)
        if (partialYield > 0) {
          harvestedCorn += partialYield  // food crops go to provisions
          events.push({
            id: generateId(), season, year,
            category: 'Weather',
            title: 'Early Frost — Partial Harvest Saved',
            description: 'Frost hit but the hardier crop yielded ' + partialYield + ' units before it was fully destroyed.',
            effects: [partialYield + ' units salvaged to provisions'],
          })
        }
      } else {
        events.push({
          id: generateId(), season, year,
          category: 'Weather',
          title: 'Early Frost — Crops Destroyed',
          description: 'An early frost destroyed an unharvested crop on one of your fields.',
          effects: ['Harvest lost on this tile'],
        })
      }
      tile.currentCrop = null
      tile.seasonsInGround = 0
    } else {
      if (workersHarvesting > 0) {
        const minSeasons = CROP_MIN_SEASONS_TO_HARVEST[tile.currentCrop] ?? 1
        const tooEarly   = tile.seasonsInGround < minSeasons
        const baseYield  = CROP_BASE_YIELD_PER_TILE[tile.currentCrop] ?? 0

        if (tooEarly) {
          events.push({
            id: generateId(), season, year,
            category: 'Economic',
            title: `${tile.currentCrop} Not Ready`,
            description: `The ${tile.currentCrop.toLowerCase()} on this parcel hasn't had enough time to mature. Leave it another season.`,
            effects: ['No yield this season — crop still growing'],
          })
        } else if (baseYield > 0) {
          const soilModifier = computeYieldModifierFromSoil(tile.soil)
          const baseWeatherModifier = WEATHER_YIELD_MODIFIER[weather]
          const tendingWorkers = tendingWorkersByTile.get(tile.id) ?? 0
          const tendingMitigation = weather === WeatherEvent.Normal
            ? 0
            : Math.min(TEND_MAX_MITIGATION, tendingWorkers * TEND_MITIGATION_PER_WORKER)
          const weatherModifier = Math.min(1.0, baseWeatherModifier + tendingMitigation)

          const cropResistance = CROP_WEATHER_RESISTANCE[tile.currentCrop]
          const effectiveWeatherModifier = cropResistance?.[weather] !== undefined
            ? Math.max(weatherModifier, cropResistance[weather]!)
            : weatherModifier

          const isRiceDestroyedByDrought = tile.currentCrop === CropType.Rice && weather === WeatherEvent.Drought

          const workerFrostProtection = frostDestroyed && workersHarvesting > 0
          const finalWeatherModifier = workerFrostProtection ? 1.0 : effectiveWeatherModifier

          if (!isRiceDestroyedByDrought) {
            // Apply growth stage yield scale
            const scaleTable  = CROP_YIELD_SCALE_BY_SEASONS[tile.currentCrop]
            const scaleIdx    = Math.min(tile.seasonsInGround, (scaleTable?.length ?? 1) - 1)
            const growthScale = scaleTable?.[scaleIdx] ?? 1.0

            yieldProduced = Math.floor(baseYield * soilModifier * finalWeatherModifier * growthScale)

            if (yieldProduced > 0) {
              // Food crops (corn, sweet potato, cowpeas) go to provisions, not storage.
            // Cowpeas' primary value is soil nitrogen restoration, but the harvest
            // yield feeds the workforce rather than sitting unsellable in storage.
            if (tile.currentCrop === CropType.Corn || tile.currentCrop === CropType.SweetPotato || tile.currentCrop === CropType.Cowpeas) {
                harvestedCorn += yieldProduced
              } else {
                const currentStored = getTotalStoredUnits(next.storage)
                const spaceAvailable = next.storage.capacity - currentStored
                const toStore = Math.min(yieldProduced, spaceAvailable)

                if (toStore > 0) {
                  next.storage.inventory[tile.currentCrop] =
                    (next.storage.inventory[tile.currentCrop] ?? 0) + toStore
                }
                if (toStore < yieldProduced) {
                  events.push({
                    id: generateId(), season, year,
                    category: 'Economic',
                    title: 'Storage Full — Crop Lost',
                    description: `Storage was full at harvest. ${yieldProduced - toStore} units of ${tile.currentCrop} were lost.`,
                    effects: [`${yieldProduced - toStore} units of ${tile.currentCrop} spoiled at harvest`],
                  })
                }
              }

              // Phase 1 seed model: harvesting perpetuates seed stock for this crop
              // (farmer always saves seed from harvest — no quantity tracking yet)
              if (!next.seedInventory) next.seedInventory = {}
              next.seedInventory[tile.currentCrop] = 1

              // Harvest generates compost material from plant residue
              if (Math.random() < CROP_COMPOST_YIELD_CHANCE.harvesting * workersHarvesting) {
                next.clearedMaterialOnHand = (next.clearedMaterialOnHand ?? 0) + 1
              }
            }
          }
        }
        // Only clear crop if harvest was valid (not too early)
        if (!tooEarly) {
          tile.currentCrop = null
          tile.seasonsInGround = 0
        }
      }
    }

    // Record tile history entry
    const historyEntry: TileHistoryEntry = {
      season, year,
      crop:          tile.currentCrop ?? (yieldProduced > 0 ? null : tile.currentCrop),
      yieldProduced,
      soilComposite: Math.round(computeYieldModifierFromSoil(tile.soil) * 100),
    }
    tile.history = [...(tile.history ?? []), historyEntry]

    debugTileData.push({
      id: tile.id, terrain: tile.terrain, isCleared: tile.isCleared,
      crop: tile.currentCrop,
      soilBefore: snapSoil(soilBefore),
      soilAfter:  snapSoil(tile.soil),
      workersClearing: 0, workersPlanting: 0,
      workersTending:  tendingWorkersByTile.get(tile.id) ?? 0,
      workersHarvesting: harvestingWorkersByTile.get(tile.id) ?? 0,
      yieldProduced,
    })
  }

  next.cornOnHand = (next.cornOnHand ?? 0) + harvestedCorn

  // ── Step 5: Process queued sales ──────────────────────────────────────────
  // Sales execute BEFORE spoilage — the player sells from what they have
  // this season, then unsold inventory spoils. Previously spoilage ran first,
  // silently reducing inventory below queued quantities and causing sales to
  // be rejected without any notification to the player.
  const commissionRate = FINANCE_RATES.factorCommission.min +
    Math.random() * (FINANCE_RATES.factorCommission.max - FINANCE_RATES.factorCommission.min)

  const saleResult = processQueuedSales({
    sales:          next.finances.queuedSales,
    storage:        next.storage,
    market:         next.market,
    factor:         next.finances.factor,
    commissionRate,
  })

  next.storage             = saleResult.updatedStorage
  next.finances.factor     = saleResult.updatedFactor

  // Waterfall repayment: sale proceeds clear interest-accrued debt first,
  // then reduce principal, remainder goes to cashOnHand.
  // Historically, the factor took their share off the top before remitting
  // anything to the planter — commission is already deducted in saleResult.revenue.
  let saleProceeds = saleResult.revenue
  const debtBefore = next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt
  if (saleProceeds > 0 && debtBefore > 0.01) {
    // Apply to factor advance first (most urgent — highest compounding risk)
    if (next.finances.factorAdvanceDebt > 0.01) {
      const payment = Math.min(saleProceeds, next.finances.factorAdvanceDebt)
      next.finances.factorAdvanceDebt -= payment
      saleProceeds -= payment
      next.transactionLog.push(recordTransaction({
        description: 'Factor advance repaid from sale proceeds: $' + payment.toFixed(2),
        amount: -payment,
        newCashOnHand: next.finances.cashOnHand,
        season, year,
      }))
    }
    // Then personal note
    if (saleProceeds > 0 && next.finances.personalNoteDebt > 0.01) {
      const payment = Math.min(saleProceeds, next.finances.personalNoteDebt)
      next.finances.personalNoteDebt -= payment
      saleProceeds -= payment
      next.transactionLog.push(recordTransaction({
        description: 'Personal note repaid from sale proceeds: $' + payment.toFixed(2),
        amount: -payment,
        newCashOnHand: next.finances.cashOnHand,
        season, year,
      }))
    }
  }
  next.finances.cashOnHand += saleProceeds

  // Rejected sales persist to next season — don't silently drop them
  next.finances.queuedSales = saleResult.salesRejected
    .map(r => next.finances.queuedSales.find(s => s.id === r.saleId)!)
    .filter(Boolean)

  if (saleResult.salesExecuted.length > 0) {
    const saleDesc = saleResult.salesExecuted
      .map(s => `${s.quantity} units of ${s.crop} for $${s.netRevenue.toFixed(0)} net`)
      .join('; ')
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Factor Sale Complete',
      description: `Your factor executed ${saleResult.salesExecuted.length} sale(s): ${saleDesc}. Commission: $${saleResult.factorCommission.toFixed(0)}.`,
      effects: [`Revenue received: $${saleResult.revenue.toFixed(0)}`],
    })
    next.transactionLog.push(recordTransaction({
      description:   `Factor sale: ${saleDesc} (commission $${saleResult.factorCommission.toFixed(0)})`,
      amount:        saleResult.revenue,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Surface rejected sales — player needs to know why nothing sold
  for (const rejected of saleResult.salesRejected) {
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Sale Not Executed',
      description: rejected.reason,
      effects: ['Sale remains queued for next season'],
    })
  }

  // ── Step 6: Apply storage spoilage ───────────────────────────────────────
  const { updatedStorage, spoilageReport } = applySpoilage(next.storage)
  next.storage = updatedStorage

  if (spoilageReport.length > 0) {
    const spoilageDesc = spoilageReport
      .map(s => `${s.amountLost} units of ${s.crop}`)
      .join(', ')
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Crop Spoilage',
      description: `Spoilage in storage this season: ${spoilageDesc}.`,
      effects: spoilageReport.map(s => `${s.amountLost} units of ${s.crop} lost`),
    })
  }

  // ── Step 7: Labor health changes ──────────────────────────────────────────
  const healthResult = applySeasonalHealthChanges({
    workers:           next.workers,
    cabins:            next.cabins,
    cornAvailable:     next.cornOnHand,
    blanketsAvailable: next.blanketsOnHand,
    season,
    weatherWasStorm:   weather === WeatherEvent.Storm,
    provisionWorkerCount: next.workers.filter(w =>
      w.laborType === LaborType.EnslavedPurchased ||
      w.laborType === LaborType.IndenturedBlack ||
      w.laborType === LaborType.IndenturedWhite
    ).length,
  })

  next.workers = healthResult.updatedWorkers
  for (const e of healthResult.events) {
    events.push({ ...e, id: generateId(), season, year })
  }

  // ── Step 8: Pay upkeep ────────────────────────────────────────────────────
  // Provisions (corn, blankets) only apply to workers whose upkeep is the
  // planter's direct responsibility: purchased enslaved and indentured.
  // Hired-out enslaved and free wage workers provision themselves — their
  // cost is captured in the rental/wage fee below.
  const PROVISION_TYPES = new Set([
    LaborType.EnslavedPurchased,
    LaborType.IndenturedBlack,
    LaborType.IndenturedWhite,
  ])
  const RENTAL_TYPES = new Set([
    LaborType.EnslavedHiredOut,
    LaborType.FreeWage,
  ])

  const provisionWorkers = next.workers.filter(w => PROVISION_TYPES.has(w.laborType))
  const rentalWorkers    = next.workers.filter(w => RENTAL_TYPES.has(w.laborType))

  // Clothing ($1/season) applies only to workers the planter directly
  // provisions — purchased enslaved and indentured. Hired-out and free
  // wage workers' clothing is covered by their rental/wage fee.
  const clothingWorkers = next.workers.filter(w => PROVISION_TYPES.has(w.laborType))
  const clothingUpkeep = clothingWorkers.length * LABOR_UPKEEP.clothing
  next.finances.cashOnHand -= clothingUpkeep
  if (clothingUpkeep > 0) {
    next.transactionLog.push(recordTransaction({
      description:   `Worker clothing allowance (${clothingWorkers.length} × $${LABOR_UPKEEP.clothing})`,
      amount:        -clothingUpkeep,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Corn provisions — purchased enslaved and indentured only
  const cornNeeded  = provisionWorkers.length * LABOR_UPKEEP.corn
  const cornConsumed = Math.min(next.cornOnHand, cornNeeded)
  next.cornOnHand  -= cornConsumed
  const cornShortfall = Math.max(0, cornNeeded - cornConsumed)

  // Blanket provisions — purchased enslaved and indentured only
  const blanketsNeeded   = provisionWorkers.length * LABOR_UPKEEP.blankets
  const blanketsConsumed = Math.min(next.blanketsOnHand, blanketsNeeded)
  next.blanketsOnHand   -= blanketsConsumed

  if (cornShortfall > 0) {
    events.push({
      id: generateId(), season, year,
      category: 'Labor',
      title: 'Corn Shortage',
      description: `You are ${cornShortfall.toFixed(0)} unit(s) of corn short of feeding your workforce. Worker health will decline.`,
      effects: ['Labor health declining this season'],
    })
  }

  // Family upkeep — owner and household members draw from the same pools
  const familyMembers = next.family ?? []
  const activeFamilyMembers = familyMembers.filter(m => m.laborUnits > 0 || m.role === 'Owner')
  if (activeFamilyMembers.length > 0) {
    // Food — same rate as provisioned workers
    const familyCornNeeded = activeFamilyMembers.length * LABOR_UPKEEP.corn
    const familyCornConsumed = Math.min(next.cornOnHand, familyCornNeeded)
    next.cornOnHand -= familyCornConsumed

    // Blankets
    const familyBlanketsNeeded = activeFamilyMembers.length * LABOR_UPKEEP.blankets
    const familyBlanketsConsumed = Math.min(next.blanketsOnHand, familyBlanketsNeeded)
    next.blanketsOnHand -= familyBlanketsConsumed

    // Clothing — cash cost per family member
    const familyClothingCost = activeFamilyMembers.length * LABOR_UPKEEP.clothing
    next.finances.cashOnHand -= familyClothingCost
    if (familyClothingCost > 0) {
      next.transactionLog.push(recordTransaction({
        description:   `Household provisions (${activeFamilyMembers.length} family member${activeFamilyMembers.length !== 1 ? 's' : ''})`,
        amount:        -familyClothingCost,
        newCashOnHand: next.finances.cashOnHand,
        season, year,
      }))
    }
  }

  // Rental and wage fees — hired-out enslaved and free wage workers
  let totalRentalCost = 0
  for (const worker of rentalWorkers) {
    const fee = LABOR_SEASONAL_COST[worker.laborType].min
    totalRentalCost += fee
  }
  if (totalRentalCost > 0) {
    next.finances.cashOnHand -= totalRentalCost
    next.transactionLog.push(recordTransaction({
      description:   `Labor rental/wage fees (${rentalWorkers.length} worker${rentalWorkers.length !== 1 ? 's' : ''})`,
      amount:        -totalRentalCost,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Cabin condition — repair and decay
  // Cost pressure comes from: condition decay hurting productivity,
  // repair requiring a worker assignment, and building new cabins.
  // There is no passive per-season cash charge — that was double-counting
  // alongside provisions and repair costs.
  // One worker assigned RepairCabin covers ALL cabins on the plantation.
  // Simple shacks: if someone fixes it, it's fixed — restored to Good.
  // Decay is rare under normal conditions — these are new buildings.
  // Storms degrade immediately; neglect degrades slowly over years.
  const anyRepairWorker = next.workers.some(w => w.assignedTask?.type === 'RepairCabin')

  next.cabins = next.cabins.map(cabin => {
    if (anyRepairWorker) {
      // Repair restores to Good regardless of current condition.
      // One worker can handle all cabins in a season.
      if (cabin.condition !== CabinCondition.Good) {
        events.push({
          id: generateId(), season, year,
          category: 'Economic',
          title: 'Cabin Repaired',
          description: `Workers restored a cabin to Good condition.`,
          effects: ['Cabin condition: Good'],
        })
      }
      return { ...cabin, condition: CabinCondition.Good, receivedMaintenanceThisSeason: true }
    }

    // Storm damage — immediate one-tier degradation
    if (weather === WeatherEvent.Storm && cabin.condition !== CabinCondition.Damaged) {
      const newCondition = degradeCabinCondition(cabin.condition)
      // Dropping to Damaged triggers an emergency repair cost — basic shoring
      // up to keep the structure standing. Without cash this becomes debt.
      if (newCondition === CabinCondition.Damaged) {
        const emergencyCost = 30
        next.finances.cashOnHand -= emergencyCost
        events.push({
          id: generateId(), season, year,
          category: 'Economic',
          title: 'Cabin Storm Damage',
          description: `Storm seriously damaged a cabin — condition dropped from ${cabin.condition} to Damaged. Emergency shoring cost $${emergencyCost}.`,
          effects: [`Cabin condition: Damaged`, `-$${emergencyCost} emergency repair`],
        })
      } else {
        events.push({
          id: generateId(), season, year,
          category: 'Economic',
          title: 'Cabin Storm Damage',
          description: `Storm damaged a cabin — condition dropped from ${cabin.condition} to ${newCondition}.`,
          effects: [`Cabin condition: ${newCondition}`],
        })
      }
      return { ...cabin, condition: newCondition, receivedMaintenanceThisSeason: false }
    }

    // Slow neglect decay — only applies if cabin has gone multiple seasons
    // without any maintenance. At 10%/season, a cabin goes Good→Fair in
    // roughly 2-3 years of total neglect, matching simple construction lifespan.
    if (!cabin.receivedMaintenanceThisSeason && Math.random() < 0.10) {
      const newCondition = degradeCabinCondition(cabin.condition)
      events.push({
        id: generateId(), season, year,
        category: 'Economic',
        title: 'Cabin Decay',
        description: `A cabin has fallen into disrepair — condition dropped from ${cabin.condition} to ${newCondition}. Assign a worker to repair it.`,
        effects: [`Cabin condition: ${newCondition}`],
      })
      return { ...cabin, condition: newCondition, receivedMaintenanceThisSeason: false }
    }

    return { ...cabin, receivedMaintenanceThisSeason: false }
  })

  // Cash upkeep shortfall check — convert negative cash to emergency debt
  if (next.finances.cashOnHand < 0) {
    const shortfall = Math.abs(next.finances.cashOnHand)
    next.finances.personalNoteDebt = (next.finances.personalNoteDebt ?? 0) + shortfall
    next.finances.cashOnHand = 0
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Cash Shortfall',
      description: `Upkeep exceeded available cash by $${shortfall.toFixed(0)}. A personal note covers the gap — debt is growing.`,
      effects: [`$${shortfall.toFixed(0)} added to personal note debt`],
    })
  }

  // Interest accrual
  // Grace period: no interest until after the first Autumn (season 4).
  // Factors expected repayment from the first crop, not before it existed.
  const INTEREST_GRACE_SEASONS = 3
  const interestActive = seasonsPlayed > INTEREST_GRACE_SEASONS

  const factorInterestRate   = FINANCE_RATES.factorAdvancePerSeason.min
  const mortgageInterestRate = FINANCE_RATES.landMortgagePerYear.min / 4
  const noteInterestRate     = FINANCE_RATES.personalNotePerYear.min / 4

  const factorInterestAccrued   = interestActive ? next.finances.factorAdvanceDebt * factorInterestRate   : 0
  const mortgageInterestAccrued = interestActive ? next.finances.mortgageDebt * mortgageInterestRate       : 0
  const noteInterestAccrued     = interestActive ? next.finances.personalNoteDebt * noteInterestRate       : 0

  if (interestActive) {
    next.finances.factorAdvanceDebt *= (1 + factorInterestRate)
    next.finances.mortgageDebt      *= (1 + mortgageInterestRate)
    next.finances.personalNoteDebt  *= (1 + noteInterestRate)
  }

  const totalInterestAccrued = factorInterestAccrued + mortgageInterestAccrued + noteInterestAccrued
  if (totalInterestAccrued > 0.01) {
    next.transactionLog.push(recordTransaction({
      description:   'Interest accrued on outstanding debt (+$' + totalInterestAccrued.toFixed(2) + ' owed)',
      amount:        0,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  } else if (!interestActive && (next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt) > 0.01) {
    next.transactionLog.push(recordTransaction({
      description:   'Factor advance grace period active — no interest charged until after first harvest season',
      amount:        0,
      newCashOnHand: next.finances.cashOnHand,
      season, year,
    }))
  }

  // Foreclosure check
  // Grace period: first 4 seasons (give the player time to plant and sell).
  // Warning throttled: fires once when the threshold is crossed, then only
  // when the ratio meaningfully worsens (not every season).
  const FORECLOSURE_GRACE_PERIOD_SEASONS = 4
  const pastGracePeriod = seasonsPlayed > FORECLOSURE_GRACE_PERIOD_SEASONS
  const totalDebt   = next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt
  const totalAssets = next.finances.cashOnHand + estimateAssetValue(next)
  const debtRatio   = totalAssets > 0 ? totalDebt / totalAssets : Infinity
  // Only warn when ratio crosses 1.5 for the first time, or worsens past 2.0, 3.0
  const prevDebtRatio = state.finances.factorAdvanceDebt + state.finances.mortgageDebt + state.finances.personalNoteDebt > 0
    ? (state.finances.factorAdvanceDebt + state.finances.mortgageDebt + state.finances.personalNoteDebt) /
      Math.max(1, state.finances.cashOnHand + estimateAssetValue(state))
    : 0
  const crossedWarningThreshold = pastGracePeriod && debtRatio > 1.5 &&
    (prevDebtRatio <= 1.5 || (debtRatio > 2.0 && prevDebtRatio <= 2.0) || (debtRatio > 3.0 && prevDebtRatio <= 3.0))
  if (crossedWarningThreshold) {
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: 'Foreclosure Warning',
      description: 'Your debts have exceeded your total assets. The bank is watching closely. One more difficult season may trigger foreclosure.',
      effects: ['Foreclosure risk: high'],
    })
  }

  // ── Step 9: Labor and resistance events ───────────────────────────────────

  // Indenture contract countdown — decrement each season, fire event at expiry
  next.workers = next.workers.map(worker => {
    if (worker.contractSeasonsRemaining === null) return worker
    if (worker.laborType !== LaborType.IndenturedBlack && worker.laborType !== LaborType.IndenturedWhite) return worker

    const newRemaining = worker.contractSeasonsRemaining - 1

    if (newRemaining <= 0) {
      // Freedom dues — pay corn from stores + cash (standard), or cash buyout
      // Player presented with choice via event; default is standard dues.
      // For now we auto-apply standard dues and flag the event so the player
      // sees what was paid. Cash-buyout option is offered in the event effects.
      const cornAvailable = next.cornOnHand ?? 0
      const cornPaid = Math.min(FREEDOM_DUES_CORN_UNITS, cornAvailable)
      next.cornOnHand = cornAvailable - cornPaid
      next.finances.cashOnHand -= FREEDOM_DUES_CASH

      next.transactionLog.push(recordTransaction({
        description: `Freedom dues paid to ${worker.name} — ${cornPaid} corn + $${FREEDOM_DUES_CASH} cash (or pay $${FREEDOM_DUES_BUYOUT_CASH} buyout instead)`,
        amount: -FREEDOM_DUES_CASH,
        newCashOnHand: next.finances.cashOnHand,
        season, year,
      }))

      events.push({
        id: generateId(), season, year,
        category: 'Labor',
        title: 'Indenture Term Complete',
        description: `${worker.name}'s indenture has ended. Freedom dues of ${cornPaid} corn and $${FREEDOM_DUES_CASH} have been paid. They are now free — offer wage employment or release them in the Labor Roster.`,
        effects: [
          `${cornPaid} corn drawn from your stores`,
          `$${FREEDOM_DUES_CASH} cash paid as freedom dues`,
          `Alternative: pay $${FREEDOM_DUES_BUYOUT_CASH} cash buyout (no corn) — release via Labor Roster`,
        ],
      })
      // Convert to free wage on expiry — player can release via the roster
      return {
        ...worker,
        laborType: LaborType.FreeWage,
        contractSeasonsRemaining: null,
        wagePerSeason: LABOR_SEASONAL_COST[LaborType.FreeWage].min,
      }
    }

    return { ...worker, contractSeasonsRemaining: newRemaining }
  })
  next.conditionsIndex = computeConditionsIndex(next.workers)
  const resistanceChance = getResistanceProbability(next.conditionsIndex)

  if (Math.random() < resistanceChance) {
    const resistanceType = Math.random() < 0.6 ? 'slowdown' : 'escape'
    if (resistanceType === 'slowdown') {
      events.push({
        id: generateId(), season, year,
        category: 'Labor',
        title: 'Work Slowdown',
        description: 'Workers slowed their pace this season. Productivity was reduced.',
        effects: ['Labor output reduced approximately 20% this season'],
      })
    } else {
      events.push({
        id: generateId(), season, year,
        category: 'Labor',
        title: 'Escape Attempt',
        description: 'One of your workers attempted to flee. The incident has unsettled the plantation.',
        effects: ['Conditions Index declining', 'Productivity reduced this season'],
      })
      // Escape attempt worsens Conditions Index
      next.conditionsIndex = Math.max(0, next.conditionsIndex - 10)
    }
  }

  // ── Step 10: Generate new market prices for next season ────────────────────
  next.market = generateSeasonalPrices(next.market, next.finances.factor.relationshipScore)

  // ── Step 11: Check achievements ───────────────────────────────────────────
  const newTrophies = checkAchievements(next)
  for (const trophy of newTrophies) {
    next.trophies.push(trophy)
    events.push({
      id: generateId(), season, year,
      category: 'Economic',
      title: `Trophy Earned: ${trophy.name}`,
      description: trophy.condition,
      effects: [],
    })
  }

  // ── Step 12: Advance time ─────────────────────────────────────────────────
  const { nextSeason, nextYear } = advanceSeason(season, year)

  // Update enslaved-this-year tracking for Abolitionist Path trophy.
  // If any enslaved worker (purchased or hired-out) was in the roster this
  // season, mark the flag. Reset at the start of a new year (Winter → Spring).
  const hadEnslavedThisSeason = state.workers.some(
    w => w.laborType === LaborType.EnslavedPurchased ||
         w.laborType === LaborType.EnslavedHiredOut
  )
  if (nextYear > year) {
    // New year starting — reset both tracking flags
    next.enslavedUsedThisYear = false
    next.yearlyRevenue = 0
  } else {
    next.enslavedUsedThisYear = (next.enslavedUsedThisYear ?? false) || hadEnslavedThisSeason
    next.yearlyRevenue = (next.yearlyRevenue ?? 0) + saleResult.revenue
  }

  next.currentSeason = nextSeason
  next.currentYear   = nextYear
  next.lastSavedAt   = new Date().toISOString()

  // Add all events to the log
  next.eventLog = [...next.eventLog, ...events]

  // ── Debug log entry ───────────────────────────────────────────────────────
  const debugEntry: DebugEntry = {
    buildVersion: state.version,
    season, year,
    weather: weather as string,
    tiles: debugTileData,
    cabins: next.cabins.map(c => ({
      id:          c.id,
      condition:   c.condition as string,
      occupants:   c.occupants.length,
      receivedMaintenanceThisSeason: c.receivedMaintenanceThisSeason,
    })),
    workers: next.workers.map(w => ({
      id: w.id, name: w.name, type: w.laborType, health: w.health,
      task: w.assignedTask?.type ?? 'Unassigned',
    })),
    family: (next.family ?? []).map(m => ({
      id: m.id, name: m.name, role: m.role,
      task: m.assignedTask?.type ?? 'Rest',
    })),
    finances: {
      cashStart:      state.finances.cashOnHand,
      cashEnd:        next.finances.cashOnHand,
      debtTotal:      next.finances.factorAdvanceDebt + next.finances.mortgageDebt + next.finances.personalNoteDebt,
      salesRevenue:   saleResult.revenue,
      upkeepClothing: clothingUpkeep,
      upkeepRental:   totalRentalCost,
      upkeepInterest: totalInterestAccrued,
    },
    events: events.map(e => `[${e.category}] ${e.title}: ${e.description}`),
  }
  next.debugLog = [...(next.debugLog ?? []), debugEntry]

  return next
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Randomly draws a weather event for the current season.
 * Uses the weighted probability table from constants.ts.
 */
function drawWeatherEvent(season: Season): WeatherEvent {
  const weights = WEATHER_WEIGHTS[season]
  const entries = Object.entries(weights) as [WeatherEvent, number][]
  const total   = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll      = Math.random() * total

  for (const [event, weight] of entries) {
    roll -= weight
    if (roll <= 0) return event
  }

  return WeatherEvent.Normal  // fallback
}

function buildWeatherEvent(weather: WeatherEvent, season: Season, year: number): GameEvent {
  const descriptions: Record<WeatherEvent, string> = {
    [WeatherEvent.Normal]:     'Weather was unremarkable this season.',
    [WeatherEvent.Drought]:    'A serious drought gripped the region. Crops suffered significant losses.',
    [WeatherEvent.HeavyRain]:  'Heavy rains fell throughout the season. Some crop loss but soil moisture improved.',
    [WeatherEvent.Storm]:      'A severe storm struck. Housing may have been damaged and crops were affected.',
    [WeatherEvent.EarlyFrost]: 'An early frost swept through in Autumn. Unharvested crops were destroyed.',
  }

  return {
    id:          generateId(),
    season,
    year,
    category:   'Weather',
    title:      `Weather: ${weather}`,
    description: descriptions[weather],
    effects:     [],
  }
}

function advanceSeason(season: Season, year: number): { nextSeason: Season; nextYear: number } {
  switch (season) {
    case Season.Spring: return { nextSeason: Season.Summer, nextYear: year }
    case Season.Summer: return { nextSeason: Season.Autumn, nextYear: year }
    case Season.Autumn: return { nextSeason: Season.Winter, nextYear: year }
    case Season.Winter: return { nextSeason: Season.Spring, nextYear: year + 1 }
  }
}

function seasonIndex(season: Season): number {
  return { Spring: 1, Summer: 2, Autumn: 3, Winter: 4 }[season]
}

function getTotalStoredUnits(storage: { inventory: Partial<Record<CropType, number>> }): number {
  return Object.values(storage.inventory).reduce((sum, qty) => sum + (qty ?? 0), 0)
}

/**
 * Counts how many workers are assigned to a given task type, grouped by tileId.
 *
 * Used to determine how much progress a tile makes this season for tasks
 * like clearing or harvesting — each assigned worker contributes one
 * labor-season toward the task.
 *
 * Only considers tasks that include a tileId (ClearLand, HarvestCrop, etc.)
 */
/**
 * Builds a combined task map that includes both workers and family members.
 * Family members contribute laborUnits per tile (fractional units rounded down to 1 for simplicity).
 */
function countCombinedByTask(
  workers: GameState['workers'],
  family: GameState['family'],
  taskType: 'ClearLand' | 'HarvestCrop' | 'TendCrop'
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const worker of workers) {
    const task = worker.assignedTask
    if (!task || task.type !== taskType) continue
    if (!('tileId' in task)) continue
    counts.set(task.tileId, (counts.get(task.tileId) ?? 0) + 1)
  }
  for (const member of (family ?? [])) {
    if (member.laborUnits <= 0) continue
    const task = member.assignedTask
    if (!task || task.type !== taskType) continue
    if (!('tileId' in task)) continue
    counts.set(task.tileId, (counts.get(task.tileId) ?? 0) + Math.max(1, Math.floor(member.laborUnits)))
  }
  return counts
}

function estimateAssetValue(state: GameState): number {
  const storedCropValue = Object.entries(state.storage.inventory)
    .reduce((sum, [crop, qty]) => {
      const price = state.market.prices[crop as CropType] ?? 0
      return sum + (qty ?? 0) * price
    }, 0)

  const landValue = state.tiles.reduce((sum, tile) => {
    return sum + (tile.isCleared ? 100 : 40)
  }, 0)

  const laborValue = state.workers.reduce((sum, worker) => {
    if (worker.laborType === 'EnslavedPurchased') return sum + 200  // conservative liquidation at ~50% of $300-500 purchase price
    if (worker.laborType === 'IndenturedBlack' || worker.laborType === 'IndenturedWhite') return sum + 75
    return sum
  }, 0)

  const provisionsValue = state.cornOnHand * 2

  return storedCropValue + landValue + laborValue + provisionsValue
}

// Simplified yield modifier for the season resolver
// The full version is in soil.ts — this avoids a circular import in Phase 1
function computeYieldModifierFromSoil(soil: { organicMatter: number; nitrogen: number; soilFauna: number; moistureRetention: number }): number {
  const om = soil.organicMatter     / 100
  const n  = soil.nitrogen          / 100
  const sf = soil.soilFauna         / 100
  const mr = soil.moistureRetention / 100
  const effectiveOM = om * (0.5 + 0.5 * sf)
  const effectiveN  = n  * (0.4 + 0.6 * mr)
  return Math.max(0, Math.min(1,
    effectiveOM * 0.30 + effectiveN * 0.35 + sf * 0.20 + mr * 0.15
  ))
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function degradeCabinCondition(condition: CabinCondition): CabinCondition {
  const progression: Record<CabinCondition, CabinCondition> = {
    [CabinCondition.Good]:    CabinCondition.Fair,
    [CabinCondition.Fair]:    CabinCondition.Poor,
    [CabinCondition.Poor]:    CabinCondition.Damaged,
    [CabinCondition.Damaged]: CabinCondition.Damaged,
  }
  return progression[condition] ?? condition
}

function snapSoil(soil: { organicMatter: number; nitrogen: number; soilFauna: number; moistureRetention: number }): { om: number; n: number; sf: number; mr: number; composite: number } {
  return {
    om: Math.round(soil.organicMatter),
    n:  Math.round(soil.nitrogen),
    sf: Math.round(soil.soilFauna),
    mr: Math.round(soil.moistureRetention),
    composite: Math.round(computeYieldModifierFromSoil(soil) * 100),
  }
}

/**
 * Deep copies game state for safe mutation.
 * Uses JSON serialization — safe because GameState contains only
 * plain objects, arrays, strings, and numbers.
 */
function deepCopyState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state))
}
