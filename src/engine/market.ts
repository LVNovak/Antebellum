/**
 * market.ts
 *
 * Commodity market simulation.
 *
 * Handles:
 *   - Generating market prices each season with realistic fluctuation
 *   - Processing queued sales through the factor
 *   - Applying spoilage to stored crops
 *   - Computing factor commission and relationship effects
 *
 * The market is not a real-time auction — it's a seasonal snapshot.
 * Prices are set at the start of each season and hold until the next turn.
 * See GDD Section 9.
 */

import {
  CropType,
  MarketPrices,
  QueuedSale,
  Factor,
  Storage,
} from './types'

import {
  MARKET_BASE_PRICE,
  MARKET_VOLATILITY,
  FACTOR_RELATIONSHIP_PRICE_BONUS_MAX,
  SPOILAGE_RATE_PER_SEASON,
  COOPER_SPOILAGE_REDUCTION,
} from './constants'

// ---------------------------------------------------------------------------
// PRICE GENERATION
// ---------------------------------------------------------------------------

/**
 * Generates new market prices for the coming season.
 */
export function generateSeasonalPrices(
  previousPrices: MarketPrices,
  factorRelationship: number
): MarketPrices {
  const newPrices: Partial<Record<CropType, number>> = {}

  for (const crop of SELLABLE_CROPS) {
    const base       = MARKET_BASE_PRICE[crop] ?? 0
    const volatility = MARKET_VOLATILITY[crop]  ?? 0.10
    const fluctuation = (Math.random() * 2 - 1) * volatility
    let price = base * (1 + fluctuation)

    if (Math.random() < DEMAND_SHOCK_PROBABILITY) {
      const shockMagnitude = Math.random() * 0.40 + 0.10
      const shockDirection = Math.random() < 0.5 ? 1 : -1
      price = price * (1 + shockMagnitude * shockDirection)
    }

    const relationshipBonus = (factorRelationship / 100) * FACTOR_RELATIONSHIP_PRICE_BONUS_MAX
    price = price * (1 + relationshipBonus)
    newPrices[crop] = Math.max(PRICE_FLOOR, Math.round(price * 100) / 100)
  }

  const updatedHistory = [
    ...previousPrices.priceHistory.slice(-3),
    previousPrices.prices,
  ]

  return { prices: newPrices, priceHistory: updatedHistory }
}

const SELLABLE_CROPS: CropType[] = [
  CropType.Tobacco,
  CropType.Rice,
  CropType.Indigo,
  CropType.Corn,
  CropType.Cowpeas,
  CropType.SweetPotato,
]

const DEMAND_SHOCK_PROBABILITY = 0.08
const PRICE_FLOOR = 0.50

// ---------------------------------------------------------------------------
// SALE PROCESSING
// ---------------------------------------------------------------------------

export interface SaleResult {
  revenue:          number
  factorCommission: number
  salesExecuted:    ExecutedSale[]
  salesRejected:    RejectedSale[]
  updatedStorage:   Storage
  updatedFactor:    Factor
}

export interface ExecutedSale {
  crop:          CropType
  quantity:      number
  pricePerUnit:  number
  grossRevenue:  number
  commission:    number
  netRevenue:    number
}

export interface RejectedSale {
  saleId: string
  reason: string
}

/**
 * Processes all queued sales through the factor.
 */
export function processQueuedSales(params: {
  sales:          QueuedSale[]
  storage:        Storage
  market:         MarketPrices
  factor:         Factor
  commissionRate: number
}): SaleResult {
  const { sales, storage, market, commissionRate } = params

  // Local mutable copy of factor — updated as sales succeed
  let currentFactor: Factor = { ...params.factor }

  let totalRevenue    = 0
  let totalCommission = 0
  const salesExecuted: ExecutedSale[] = []
  const salesRejected: RejectedSale[] = []
  const updatedInventory = { ...storage.inventory }

  for (let sale of sales) {
    if (currentFactor.relationshipScore < 20 && currentFactor.advanceOutstanding > currentFactor.creditLimit) {
      salesRejected.push({
        saleId: sale.id,
        reason: 'Factor declined — outstanding advance exceeds credit limit and relationship is poor.',
      })
      continue
    }

    const available = updatedInventory[sale.crop] ?? 0
    // If spoilage has reduced inventory below the queued quantity,
    // sell whatever remains rather than rejecting the sale entirely.
    // Only reject if nothing is left to sell.
    const effectiveQuantity = Math.min(sale.quantity, available)
    if (effectiveQuantity <= 0) {
      salesRejected.push({
        saleId: sale.id,
        reason: `No ${sale.crop} remaining in storage — spoilage may have consumed the stock.`,
      })
      continue
    }
    if (effectiveQuantity < sale.quantity) {
      // Partial fill — log it but proceed
      sale = { ...sale, quantity: effectiveQuantity }
    }

    const currentPrice = market.prices[sale.crop] ?? 0
    if (sale.minPriceFloor !== null && currentPrice < sale.minPriceFloor) {
      salesRejected.push({
        saleId: sale.id,
        reason: `Current price ($${currentPrice.toFixed(2)}) is below your minimum floor ($${sale.minPriceFloor.toFixed(2)}). Factor will hold.`,
      })
      continue
    }

    const grossRevenue = currentPrice * sale.quantity
    const commission   = grossRevenue * commissionRate
    const netRevenue   = grossRevenue - commission

    totalRevenue    += netRevenue
    totalCommission += commission
    updatedInventory[sale.crop] = available - sale.quantity

    salesExecuted.push({
      crop: sale.crop, quantity: sale.quantity,
      pricePerUnit: currentPrice, grossRevenue, commission, netRevenue,
    })

    // Successful sale improves factor relationship slightly
    currentFactor = {
      ...currentFactor,
      relationshipScore: Math.min(100, currentFactor.relationshipScore + 1),
    }
  }

  return {
    revenue:          totalRevenue,
    factorCommission: totalCommission,
    salesExecuted,
    salesRejected,
    updatedStorage: { ...storage, inventory: updatedInventory },
    updatedFactor:  currentFactor,
  }
}

// ---------------------------------------------------------------------------
// SPOILAGE
// ---------------------------------------------------------------------------

/**
 * Applies spoilage to all stored crops for one season.
 */
export function applySpoilage(storage: Storage): {
  updatedStorage:  Storage
  spoilageReport:  { crop: CropType; amountLost: number }[]
} {
  const updatedInventory    = { ...storage.inventory }
  const updatedSeasonsStored = { ...storage.seasonsStored }
  const spoilageReport: { crop: CropType; amountLost: number }[] = []

  for (const [cropKey, quantity] of Object.entries(updatedInventory)) {
    const crop = cropKey as CropType
    if (!quantity || quantity <= 0) continue

    const baseRate = SPOILAGE_RATE_PER_SEASON[crop] ?? 0
    if (baseRate === 0) continue

    const effectiveRate = storage.hasCooperAssigned
      ? baseRate * (1 - COOPER_SPOILAGE_REDUCTION)
      : baseRate

    const amountLost = Math.floor(quantity * effectiveRate)
    if (amountLost > 0) {
      updatedInventory[crop] = quantity - amountLost
      spoilageReport.push({ crop, amountLost })
    }

    updatedSeasonsStored[crop] = (updatedSeasonsStored[crop] ?? 0) + 1
  }

  return {
    updatedStorage: { ...storage, inventory: updatedInventory, seasonsStored: updatedSeasonsStored },
    spoilageReport,
  }
}

// ---------------------------------------------------------------------------
// FACTOR RELATIONSHIP
// ---------------------------------------------------------------------------

export function applyFactorRelationshipPenalty(
  factor: Factor,
  reason: 'default' | 'switch'
): Factor {
  const penalty = reason === 'default' ? 15 : 10
  return { ...factor, relationshipScore: Math.max(0, factor.relationshipScore - penalty) }
}

export function getFactorRelationshipLabel(score: number): string {
  if (score >= 80) return 'Excellent — your factor is a trusted partner'
  if (score >= 60) return 'Good — your factor works reliably with you'
  if (score >= 40) return 'Fair — standard terms, no special treatment'
  if (score >= 20) return 'Strained — your factor is cautious about credit'
  return 'Poor — your factor may decline sales or advances'
}
