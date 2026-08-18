import { describe, expect, it } from "vitest";
import { farmInitials, lotCodeBase, nextLotCode } from "./lotCode";

const NOW = new Date("2026-08-13T12:00:00");

describe("farmInitials", () => {
  it("takes the first letter of each word", () => {
    expect(farmInitials("Kurt Miller")).toBe("KM");
    expect(farmInitials("Triple J Ag")).toBe("TJA");
    expect(farmInitials("Marlene Klassen")).toBe("MK");
  });
  it("splits on punctuation and drops parentheticals", () => {
    expect(farmInitials("S&C Farms (Sam Cole)")).toBe("SCF");
  });
  it("falls back for empty names", () => {
    expect(farmInitials("")).toBe("FARM");
  });
});

describe("nextLotCode", () => {
  it("starts at 01 for a new farmer-year", () => {
    expect(nextLotCode([], "Kurt Miller", NOW)).toBe("706C-KM-2601");
  });
  it("increments past the highest existing sequence", () => {
    const codes = ["706C-KM-2601", "706C-KM-2602"];
    expect(nextLotCode(codes, "Kurt Miller", NOW)).toBe("706C-KM-2603");
  });
  it("ignores other farmers, other years, and old-format codes", () => {
    const codes = ["706C-MK-2605", "706C-KM-2509", "KMF-26-C1", "706C-KM-26A"];
    expect(nextLotCode(codes, "Kurt Miller", NOW)).toBe("706C-KM-2601");
  });
  it("keeps two-digit padding past 09", () => {
    const codes = ["706C-KM-2609"];
    expect(nextLotCode(codes, "Kurt Miller", NOW)).toBe("706C-KM-2610");
  });
  it("uses the current year", () => {
    expect(lotCodeBase("Kurt Miller", new Date("2027-01-05"))).toBe("706C-KM-27");
  });
});
