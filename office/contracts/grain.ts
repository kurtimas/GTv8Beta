// Shared grain math & constants — used by both backend (authoritative
// calculations) and frontend (live previews). Single source of truth.

export const CROPS = [
  "Corn",
  "Wheat",
  "Soybeans",
  "Sorghum",
  "Barley",
  "Oats",
  "Canola",
  "Sunflowers",
] as const;

export type Crop = (typeof CROPS)[number];

/** Standard US bushel weights (lbs per bushel). */
export const BUSHEL_WEIGHT_LBS: Record<string, number> = {
  Corn: 56,
  Wheat: 60,
  Soybeans: 60,
  Sorghum: 56,
  Barley: 48,
  Oats: 32,
  Canola: 50,
  Sunflowers: 25,
};

/** Base (market) moisture % — moisture above this shrinks. */
export const BASE_MOISTURE_PCT: Record<string, number> = {
  Corn: 15.0,
  Wheat: 13.5,
  Soybeans: 13.0,
  Sorghum: 14.0,
  Barley: 14.5,
  Oats: 14.0,
  Canola: 10.0,
  Sunflowers: 10.0,
};

/** Shrink factor per point of moisture above base (industry common 1.3%). */
export const SHRINK_RATE_PER_POINT = 1.3;

export function bushelWeight(crop: string): number {
  return BUSHEL_WEIGHT_LBS[crop] ?? 60;
}

export function baseMoisture(crop: string): number {
  return BASE_MOISTURE_PCT[crop] ?? 13.0;
}

/** Moisture shrink % for a load. */
export function moistureShrinkPct(crop: string, moisturePct: number | null | undefined): number {
  if (moisturePct == null) return 0;
  const over = moisturePct - baseMoisture(crop);
  if (over <= 0) return 0;
  return round2(over * SHRINK_RATE_PER_POINT);
}

/**
 * Compute bushels for a load.
 *  grossBushels = netLbs / bushelWeight
 *  totalShrink  = moistureShrink + dockage (both % of gross bushels)
 *  netBushels   = grossBushels * (1 - totalShrink/100)
 */
export function computeBushels(
  crop: string,
  netLbs: number,
  moisturePct?: number | null,
  dockagePct?: number | null,
): { grossBushels: number; shrinkPct: number; netBushels: number } {
  const grossBushels = netLbs / bushelWeight(crop);
  const shrink = moistureShrinkPct(crop, moisturePct);
  const dockage = dockagePct ?? 0;
  const totalShrink = Math.min(shrink + dockage, 99);
  return {
    grossBushels: round2(grossBushels),
    shrinkPct: round2(totalShrink),
    netBushels: round2(grossBushels * (1 - totalShrink / 100)),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtLbs(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export function fmtBu(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
