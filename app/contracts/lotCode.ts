// ---------------------------------------------------------------------------
// Lot code generator — operator convention:
//   706C-<FARMINITIALS>-<YY><NN>     e.g. 706C-KM-2601, next 706C-KM-2602
// 706C  = elevator prefix (constant below if it ever changes)
// YY    = current 2-digit year; NN = next sequence for that farmer's
//         initials this year (scans existing codes, takes max + 1)
// ---------------------------------------------------------------------------

export const LOT_CODE_PREFIX = "706C";

/** "Kurt Miller" → "KM" · "S&C Farms (Sam Cole)" → "SF" · "Triple J Ag" → "TJA" */
export function farmInitials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, " ") // drop parenthetical nicknames
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
  const initials = words.map((w) => w[0]!.toUpperCase()).join("");
  return initials || "FARM";
}

function yearCode(now: Date): string {
  return String(now.getFullYear() % 100).padStart(2, "0");
}

/** Base for this farmer this year, e.g. "706C-KM-26" (sequence appended). */
export function lotCodeBase(farmerName: string, now = new Date()): string {
  return `${LOT_CODE_PREFIX}-${farmInitials(farmerName)}-${yearCode(now)}`;
}

/** Next available code, e.g. "706C-KM-2603" when …01 and …02 exist. */
export function nextLotCode(
  existingCodes: string[],
  farmerName: string,
  now = new Date(),
): string {
  const base = lotCodeBase(farmerName, now);
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(base)) continue;
    const tail = code.slice(base.length);
    if (!/^\d{2,}$/.test(tail)) continue;
    max = Math.max(max, parseInt(tail, 10));
  }
  return `${base}${String(max + 1).padStart(2, "0")}`;
}
