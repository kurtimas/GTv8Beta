// End-to-end smoke test against the running production server.
// Exercises every tRPC procedure the basic version's GUI uses, including the
// full weigh flow, grading/shrink math, bin inventory movement, corrections,
// the lot-split join fix, reports, close-day, and void reversal.
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

const client = createTRPCClient({
  links: [
    httpBatchLink({ url: "http://localhost:3000/api/trpc", transformer: superjson }),
  ],
});

let failures = 0;
function check(name, cond, extra = "") {
  const ok = Boolean(cond);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

const round2 = (n) => Math.round(n * 100) / 100;

// 1. connectivity -------------------------------------------------------
const ping = await client.ping.query();
check("ping", ping.ok === true);

// 2. reference data ------------------------------------------------------
const sites = await client.core.sites.list.query();
check("sites.list", sites.length >= 1, `${sites.length} site(s)`);
const farmers = await client.people.farmers.list.query();
check("farmers.list", farmers.length >= 1, `${farmers.length} farmer(s)`);
const landlords = await client.people.landlords.list.query();
check("landlords.list", Array.isArray(landlords), `${landlords.length} landlord(s)`);
const lots = await client.people.lots.list.query();
check("lots.list", lots.length >= 1, `${lots.length} lot(s)`);
const binsBefore = await client.core.bins.list.query();
check("bins.list", binsBefore.length >= 1, `${binsBefore.length} bin(s)`);
const truckTares = await client.sheets.truckTares.query();
check("truckTares", Array.isArray(truckTares), `${truckTares.length} known truck(s)`);

// pick a crop-share lot (landlord attached) to prove the split join works,
// else fall back to any lot, else no lot
const splitLot = lots.find((l) => l.landlordId && l.landlordSplitPct > 0) ?? null;
const lot = splitLot ?? lots[0] ?? null;
const farmer = farmers.find((f) => f.id === (lot?.farmerId ?? farmers[0].id));

// 3. open sheet ----------------------------------------------------------
const created = await client.sheets.create.mutate({
  siteId: sites[0].id,
  farmerId: farmer.id,
  lotId: lot?.id ?? null,
  truckId: "SMOKE-01",
  driverName: "Smoke Test",
  crop: lot?.crop ?? "Corn",
  direction: "INBOUND",
  notes: "automated smoke test",
});
check("sheets.create", created.id > 0 && /^T-\d{5}$/.test(created.ticketNo), created.ticketNo);

const openQueue = await client.sheets.open.query();
check("sheets.open lists new sheet", openQueue.some((s) => s.id === created.id));

// 4. weigh flow: 81,250 gross − 29,500 tare = 51,750 net ------------------
await client.sheets.weighFirst.mutate({ id: created.id, weightLbs: 81250 });
const weighed = await client.sheets.weighSecond.mutate({ id: created.id, weightLbs: 29500 });
check("weighSecond net lbs", weighed.netLbs === 51750, `net=${weighed.netLbs}`);

// 5. bin auto-assignment + inventory movement -----------------------------
let got = await client.sheets.get.query({ id: created.id });
const binId = got.sheet.binId;
const crop = got.sheet.crop;
const expectedBin = binsBefore
  .filter((b) => b.siteId === sites[0].id && b.crop === crop)
  .sort((a, b) => a.currentLbs - b.currentLbs)[0];
if (expectedBin) {
  check("bin auto-assigned to least-filled crop bin", binId === expectedBin.id, `bin #${binId}`);
  const binsAfter = await client.core.bins.list.query();
  const before = binsBefore.find((b) => b.id === binId).currentLbs;
  const after = binsAfter.find((b) => b.id === binId).currentLbs;
  check("bin inventory increased by net lbs", after - before === 51750, `${before} → ${after}`);
} else {
  check("bin auto-assigned (no matching bin at site — skipped by design)", binId === null);
}

// 6. grading + shrink math -------------------------------------------------
const bw = { Corn: 56, Wheat: 60, Soybeans: 60, Sorghum: 56, Barley: 48, Oats: 32, Canola: 50, Sunflowers: 25 }[crop] ?? 60;
const graded = await client.sheets.updateGrades.mutate({
  id: created.id,
  moisturePct: 16.3,
  dockagePct: 2,
  testWeightLbs: 56,
});
check("grades return recalculated bushels", graded.grossBushels != null);
got = await client.sheets.get.query({ id: created.id });
check(
  "shrink % = moisture over base + dockage",
  got.sheet.shrinkPct != null && got.sheet.shrinkPct > 2,
  `shrink=${got.sheet.shrinkPct}%`,
);
check(
  "netBushels = gross × (1 − shrink)",
  round2((51750 / bw) * (1 - got.sheet.shrinkPct / 100)) === got.sheet.netBushels,
  `${got.sheet.netBushels} bu @ ${bw} lbs/bu`,
);

// 7. lot split join (regression: lotSplitPct was never selected) -----------
if (splitLot) {
  check(
    "lotSplitPct present in sheet join",
    got.sheet.lotSplitPct === splitLot.landlordSplitPct,
    `split=${got.sheet.landlordName} ${got.sheet.lotSplitPct}%`,
  );
} else {
  console.log("SKIP  lotSplitPct check — no crop-share lot in dataset");
}

// 8. weight correction with reason + bin rebalance --------------------------
const corrected = await client.sheets.updateWeights.mutate({
  id: created.id,
  grossLbs: 81250,
  tareLbs: 30000,
  changeReason: "smoke test correction",
});
check("updateWeights recomputes net", corrected.netLbs === 51750 - 500, `net=${corrected.netLbs}`);
if (binId) {
  const binsNow = await client.core.bins.list.query();
  const level = binsNow.find((b) => b.id === binId).currentLbs;
  const before = binsBefore.find((b) => b.id === binId).currentLbs;
  check("bin rebalanced after correction", level - before === 51250, `delta=${level - before}`);
}
// restore original weights before close
await client.sheets.updateWeights.mutate({
  id: created.id,
  grossLbs: 81250,
  tareLbs: 29500,
  changeReason: "smoke test restore",
});

// 9. audit trail ------------------------------------------------------------
got = await client.sheets.get.query({ id: created.id });
const actions = got.events.map((e) => e.action);
check(
  "audit trail captures full lifecycle",
  ["CREATED", "WEIGH_IN", "WEIGH_OUT", "GRADES", "WEIGHT_EDIT"].every((a) => actions.includes(a)),
  actions.join(","),
);

// 10. archive search ---------------------------------------------------------
const found = await client.sheets.list.query({ search: "SMOKE-01" });
check("archive search by truck id", found.some((s) => s.id === created.id));
const byFarmer = await client.sheets.list.query({ farmerId: farmer.id });
check("archive filter by farmer", byFarmer.some((s) => s.id === created.id));

// 11. daily report -------------------------------------------------------------
const report = await client.sheets.dailyReport.query();
check("dailyReport includes the load", report.sheets.some((s) => s.id === created.id));
check("dailyReport totals consistent", report.inboundLbs >= 51750, `in=${report.inboundLbs} lbs`);
check("dailyReport crop breakdown", report.byCrop.some((c) => c.crop === crop));
check("dailyReport bin levels", report.bins.length === binsBefore.length);

// 12. close day locks completed sheets -----------------------------------------
const closed = await client.sheets.closeDay.mutate();
check("closeDay locks completed sheets", closed.closed >= 1, `${closed.closed} closed`);
got = await client.sheets.get.query({ id: created.id });
check("sheet status CLOSED after close-day", got.sheet.status === "CLOSED");
let editBlocked = false;
try {
  await client.sheets.updateWeights.mutate({
    id: created.id, grossLbs: 80000, tareLbs: 29000, changeReason: "should fail",
  });
} catch {
  editBlocked = true;
}
check("closed sheet rejects edits", editBlocked);

// 13. void guard on closed sheets -----------------------------------------------
let voidBlocked = false;
try {
  await client.sheets.void.mutate({ id: created.id });
} catch {
  voidBlocked = true;
}
check("closed sheet cannot be voided", voidBlocked);

// 14. void a fresh open sheet reverses nothing & deletes --------------------------
const tmp = await client.sheets.create.mutate({
  siteId: sites[0].id, farmerId: farmer.id, lotId: null, crop: "Corn", direction: "INBOUND",
});
await client.sheets.void.mutate({ id: tmp.id });
const gone = await client.sheets.list.query({ search: tmp.ticketNo });
check("void deletes open sheet", !gone.some((s) => s.id === tmp.id));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
