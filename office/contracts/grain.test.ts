import { describe, expect, it } from "vitest";
import {
  BASE_MOISTURE_PCT,
  BUSHEL_WEIGHT_LBS,
  CROPS,
  baseMoisture,
  bushelWeight,
  computeBushels,
  fmtBu,
  fmtLbs,
  moistureShrinkPct,
  round2,
} from "./grain";

describe("crop tables", () => {
  it("has a bushel weight and base moisture for every crop", () => {
    for (const c of CROPS) {
      expect(BUSHEL_WEIGHT_LBS[c], `bushel weight for ${c}`).toBeGreaterThan(0);
      expect(BASE_MOISTURE_PCT[c], `base moisture for ${c}`).toBeGreaterThan(0);
    }
  });

  it("matches the industry-standard reference weights", () => {
    expect(bushelWeight("Corn")).toBe(56);
    expect(bushelWeight("Wheat")).toBe(60);
    expect(bushelWeight("Soybeans")).toBe(60);
    expect(bushelWeight("Oats")).toBe(32);
    expect(bushelWeight("Canola")).toBe(50);
  });

  it("falls back to safe defaults for unknown crops", () => {
    expect(bushelWeight("Barley-X")).toBe(60);
    expect(baseMoisture("Barley-X")).toBe(13.0);
  });
});

describe("moistureShrinkPct", () => {
  it("is zero at or below base moisture", () => {
    expect(moistureShrinkPct("Corn", 15.0)).toBe(0);
    expect(moistureShrinkPct("Corn", 12.0)).toBe(0);
    expect(moistureShrinkPct("Corn", null)).toBe(0);
    expect(moistureShrinkPct("Corn", undefined)).toBe(0);
  });

  it("shrinks 1.3% per point above base", () => {
    // Corn base 15.0 → 17.5% moisture = 2.5 points × 1.3
    expect(moistureShrinkPct("Corn", 17.5)).toBeCloseTo(3.25, 2);
    // Wheat base 13.5 → 20% = 6.5 points × 1.3
    expect(moistureShrinkPct("Wheat", 20.0)).toBeCloseTo(8.45, 2);
  });
});

describe("computeBushels", () => {
  it("converts pounds to bushels with no grades", () => {
    const r = computeBushels("Corn", 56000);
    expect(r.grossBushels).toBe(1000);
    expect(r.shrinkPct).toBe(0);
    expect(r.netBushels).toBe(1000);
  });

  it("applies moisture shrink and dockage together", () => {
    // 56,000 lbs corn = 1,000 gross bu; moisture 16.3% → 1.3 pts × 1.3 = 1.69%
    // dockage 2% → total shrink 3.69% → net 963.1 bu
    const r = computeBushels("Corn", 56000, 16.3, 2);
    expect(r.grossBushels).toBe(1000);
    expect(r.shrinkPct).toBeCloseTo(3.69, 2);
    expect(r.netBushels).toBeCloseTo(963.1, 2);
  });

  it("never lets total shrink exceed 99%", () => {
    const r = computeBushels("Corn", 56000, 60, 50);
    expect(r.shrinkPct).toBe(99);
    expect(r.netBushels).toBeGreaterThan(0);
  });

  it("handles zero weight", () => {
    const r = computeBushels("Wheat", 0, 14, 1);
    expect(r.grossBushels).toBe(0);
    expect(r.netBushels).toBe(0);
  });
});

describe("formatting helpers", () => {
  it("round2 rounds to cents", () => {
    expect(round2(1.006)).toBe(1.01);
    expect(round2(963.096)).toBe(963.1);
    expect(round2(2.5)).toBe(2.5);
  });

  it("formats null as an em dash and numbers with separators", () => {
    expect(fmtLbs(null)).toBe("—");
    expect(fmtLbs(undefined)).toBe("—");
    expect(fmtLbs(81250)).toBe("81,250");
    expect(fmtBu(null)).toBe("—");
    expect(fmtBu(1451.79)).toBe("1,451.79");
  });
});
