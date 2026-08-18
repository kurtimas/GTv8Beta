# Grain Tracker v2 — Scale Dashboard: Complete Rebuild Specification

**Purpose of this document:** a from-scratch blueprint for the Scale Dashboard (the main screen scale operators use all day). It covers the layout top to bottom, every panel and control, the visual design language, the data behind each element, and every behavior (keyboard shortcuts, sounds, warnings, auto-actions). Follow it in order and you can rebuild the screen exactly.

Source of truth: `src/pages/Dashboard.tsx` plus its components (`ScalePanel`, `OpsOverview`, dialogs), hooks (`useScale`, `useNow`), and libs (`scale.ts`, `sound.ts`, `printTicket.ts`).

---

## 1. What the screen is for

One operator, one scale, many trucks. The operator:

1. Opens a **weight sheet** for a farmer's lot (or picks an existing open sheet).
2. Drives a truck on the scale → presses **WEIGH IN**.
3. Truck dumps/loads → drives back on → presses **WEIGH OUT**.
4. The system computes net lbs and bushels, credits the bin, and optionally prints a ticket.

Everything on the screen is optimized for: big touch targets, glanceable status, minimal typing, and recovery from mistakes (guards + warnings, not hard stops).

---

## 2. Tech stack

- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, shadcn/ui primitives (Button, Input, Select, Slider, Skeleton), lucide-react icons, sonner toasts.
- **Data:** tRPC client (`trpc.*.useQuery/useMutation`) with `trpc.useUtils()` for cache invalidation. Backend is Hono + tRPC + Drizzle ORM (MySQL in production, embedded SQLite offline fallback).
- **Scale hardware:** Web Serial API (Chrome/Edge over HTTPS only) plus a built-in simulator and a manual-entry fallback.

---

## 3. Design language (the "instrument panel" look)

The whole app looks like industrial control equipment: dark theme by default, phosphor-green/cyan accents, monospace numbers everywhere.

### 3.1 Design tokens (CSS custom properties in `index.css`)

| Token | Dark value | Use |
|---|---|---|
| `--go` | `158 64% 52%` (phosphor green) | capture/positive/stable states |
| `--live` | `187 92% 55%` (cyan) | live telemetry, "reading…" |
| `--crit` | `0 91% 68%` (signal red) | overdue / critical |
| `--readout` | `222 60% 3%` (near-black) | inset readout background |
| amber (hardcoded) | `hsl(38 92% 60%)` | warning fill level (70–90%) |

Light theme ("day" mode) remaps all four tokens to brighter/darker variants — always reference the tokens, never hardcode green/red.

### 3.2 Reusable classes

- **`.gt-panel`** — the standard card: rounded-sm, border, card background. Every section of the dashboard is a `gt-panel`.
- **`.gt-eyebrow`** — tiny uppercase monospace label (`text-[10-11px]`, letter-spaced, muted). Used as the header of every panel.
- **`.gt-led`** — a small glowing dot. Modifiers: `gt-led-on` (green glow), `gt-led-live` (cyan glow), `gt-led-warn` (amber), `gt-led-crit` (red). Used like a physical indicator lamp.
- **`.gt-scan`** — inset "terminal screen" effect for the weight readout: dark ground + a scanline overlay (`::after` pseudo-element with repeating horizontal lines, suppressed in day mode).
- **`tabular-nums` + `font-mono`** on every number so digits never shift layout.
- **`TestBadge`** — a small "TEST" chip placed next to any feature that is still a trial (repeat-last, keyboard shortcuts, sound, auto-print, tare memory, est-net). Keep these visible.

### 3.3 Fill-level color logic (shared helpers in `components/manage/fillTone.ts`)

- `fillPct(currentLbs, capacityLbs)` → 0–100, clamped, rounded; 0 if capacity ≤ 0.
- `fillTone(pct)` → `"go"` (<70), `"warn"` (70–90), `"crit"` (>90).
- `fillColor(tone)` → inline CSS color (green / amber `hsl(38 92% 60%)` / red token).
- `fillTextClass(tone)` / `fillLedClass(tone)` → matching Tailwind class / LED modifier.

---

## 4. Data the page loads

| Query | Poll | Used for |
|---|---|---|
| `trpc.sheets.open` | every 15 s | the list of OPEN weight sheets (right column + selected sheet) |
| `trpc.core.bins.list` | every 15 s | bin % strip, bin suggest, bin dropdown, overview utilization |
| `trpc.sheets.truckTares` | on mount | truck-ID autocomplete + usual-tare memory |
| `trpc.sheets.list {limit: 1}` | on mount | "Repeat last load" |
| `trpc.sheets.dailyReport` | every 15 s | quick stats + Operations overview |

After every weigh/create action, **invalidate all six** queries (`sheets.open`, `sheets.list`, `core.bins.list`, `sheets.dailyReport`, `sheets.truckTares`, `sheets.recentActivity`) so the whole page refreshes at once.

Mutations used: `sheets.create`, `sheets.weighFirst`, `sheets.weighSecond` (plus `sheets.get` fetch for auto-print).

Local state: `selectedId`, `newOpen` (dialog), `detailId` (dialog), `manualWeight`, `truckInput`, `binInput` ("auto" or a bin id), `printCtx`, `soundOn` (persisted to localStorage `gt-sound`, default ON), `autoPrint` (localStorage `gt-autoprint`, default OFF). A `useNow(30000)` hook re-renders every 30 s so ages stay fresh.

---

## 5. Page anatomy (top to bottom)

The page root is `space-y-4` (vertical stack with even gaps). Sections in order:

### 5.1 Header (PageHeader component)

- **Eyebrow row:** a cyan live LED + `Scale operations · {Weekday, Month D}` (e.g. "Scale operations · Tuesday, August 18").
- **Title:** `Scale Dashboard`, extra-bold, 2xl→3xl.
- **Actions (right side):**
  - **"Repeat last load"** — large outline button, Copy icon, TEST badge. Behavior in §7.5.
  - **"New sheet"** — large primary button, Plus icon, with a small `<kbd>N</kbd>` hint chip (hidden on small screens). Opens the New Sheet dialog.

### 5.2 Error banner

If the open-sheets query fails: red left-border alert strip — CircleAlert icon, monospace uppercase label "Cannot reach server — the database may still be initializing", the error message (truncated), and an outline **Retry** button.

### 5.3 Bin levels strip (at-a-glance)

Replaced an old scrolling ticker. Only rendered when at least one bin exists. A horizontal `gt-panel` in two parts:

- **Left block** (bordered right, tinted secondary background): a tone-colored LED (green/amber/red), eyebrow "Bins filled", and the **overall fill %** — big (`text-2xl font-black`) monospace number colored by tone.
- **Right grid** (`grid-cols-2 → sm:3 → xl:6`): one cell per bin — bin name (truncated) left, tone-colored % right, and below it a thin (`h-1.5`) rounded progress bar on a secondary track, filled width = pct%, fill color by tone, 500 ms width transition. Hover tooltip: `{name} · {crop} · {pct}% full`.

Overall % = total current lbs ÷ total capacity lbs across all bins.

### 5.4 Quick stats (3 StatCards, `grid-cols-3`)

Each StatCard: `gt-panel p-4`, eyebrow label, big (`text-3xl`) monospace value, optional muted sub-line.

1. **Open weight sheets** — count, primary (blue) tone.
2. **Loads completed today** — count, green tone.
3. **Net lbs in today** — formatted lbs (inbound completed loads only), default tone.

### 5.5 Main two-column work area (`grid lg:grid-cols-5`)

#### LEFT column (`lg:col-span-3`, vertical stack)

**(a) ScalePanel — the scale terminal.** A `gt-panel`:

- *Header bar* (bottom border): green/cyan/gray LED + eyebrow showing the connection mode ("Scale link · serial" / "· simulator" / "· offline"), plus a 4-bar signal-strength graphic (bars light up green when live; the top two bars require a stable reading). Right side: mode buttons — **"Connect USB scale"** (Cable icon, shown unless already serial), **"Simulator"** (FlaskConical icon, shown unless simulating), **"Disconnect"** (ghost, shown when connected).
- *Readout*: the inset terminal. `gt-scan` rounded box, corner brackets in all four corners (like a technical drawing frame), centered giant weight (`text-6xl md:text-7xl`, monospace, `toLocaleString`). Shows `––––––` when offline. Below: "lbs" + a status LED with "stable" or "reading…". Colors: offline = dim gray; live-unstable = cyan border/text with subtle cyan glow; stable = green border/text with green inner+outer glow (150 ms transition).
- *Serial error*: if a connection attempt failed, a red left-border monospace message under the readout (e.g. "Web Serial is not available in this browser. Use Chrome/Edge over HTTPS, or the simulator.").
- *Simulator controls* (only in simulator mode): a bordered sub-panel with eyebrow "Simulated truck weight", current value, a Slider (0–90,000 lbs, step 500), and quick-set buttons: **Empty truck 29,500**, **Loaded truck 81,250**, **Zero 0**. The simulated weight = base ± random noise (±30 lbs) every 400 ms.

**(b) Manual weight entry** — only shown when disconnected. Slim `gt-panel`: eyebrow "Manual weight entry" + a number Input (monospace, max-width 44, placeholder "lbs"). The manual value becomes the capture weight.

**(c) The BIG capture buttons** — directly under the scale block (this placement was a specific request: buttons close to the scale). Two giant buttons side by side (`grid-cols-2 gap-4`), each `h-32 md:h-40`, monospace, uppercase, extra-bold, tracking wide, with a big icon above the label:

- **WEIGH IN** (ArrowDownToLine). Active style: green border + green fill + dark-green text + green glow; press animation `active:translate-y-0.5`. Enabled only when a sheet is selected AND no load is on the scale AND nothing is saving. When active and a weight is present, the live weight ("81,250 lbs") is shown as a smaller line inside the button.
- **WEIGH OUT** (ArrowUpFromLine). Same but in primary blue; enabled only when a load IS on the scale.
- Inactive style for both: muted secondary background, dimmed text, `cursor-not-allowed`.
- **Label adaptation:** inbound sheets read "WEIGH IN" / "WEIGH OUT"; outbound (shipping) sheets read "WEIGH IN (EMPTY)" / "WEIGH OUT (LOADED)" because outbound loads weigh empty first.

**(d) Operator toggles strip** — a `gt-panel` flex row:

- Keyboard hint: Keyboard icon + `Space = capture · N = new sheet` + TEST badge.
- **NodeToggle "Sound cues"** + TEST badge (default ON, persisted).
- **NodeToggle "Auto-print ticket"** + TEST badge (default OFF, persisted).
- NodeToggle is a custom "radar node" switch: a glowing ring with center dot (`gt-node` with `data-on` attribute), not a standard switch.

**(e) Selected-sheet context panel** — a box with a 2px left border: solid primary + faint primary tint when a sheet is selected; dashed gray border when none.

*Empty state:* centered monospace uppercase text — "Select a weight sheet — or press N to start one from a lot".

*With a sheet selected:*

- **Header row:** ticket number (large monospace bold) + StatusBadge (OPEN/etc.); underneath: `Farmer name · Lot {lotCode} · {crop}` and, if a landlord exists, `· {landlord} {splitPct}%`. Right side (monospace, right-aligned): `LOADS n/10` and `NET x lbs`.
- **LoadSlots bar:** 10 segments (one per load slot on the sheet). Filled = solid green; the load currently on the scale = pulsing primary; empty = muted. A `n/10` counter at the right end. (This component is reused in the right column.)
- **Previous loads list** (if any): bordered monospace rows, one per load — load number, truck icon + truck ID, `gross − tare`, bold green net lbs, bin name (or "no bin"). A load still on the scale shows a pulsing "on scale · {weight} lbs". Completed loads with no moisture grade yet get a small "needs grade" chip.
- **Next-load inputs (only when no load is on the scale):** two columns —
  - *Truck ID:* Input, monospace, placeholder "e.g. KM-04 Peterbilt", with a `<datalist id="known-trucks">` autocomplete fed from tare memory.
  - *Bin:* a Select. First option "Auto → {suggested bin name}"; then every bin at the selected sheet's site as `{name} · {crop} ({pct}%)`.
- **Tare memory / estimate line** (small monospace): if the truck is known, `USUAL TARE {truckId}: {avg} lbs ({n} loads)` + TEST badge. While weighing out, `EST NET {lbs} lbs → {suggested bin}` + TEST badge.

#### RIGHT column (`lg:col-span-2`)

**Open weight sheets panel:** `gt-panel` with header (eyebrow "Open weight sheets" + count) and a scrollable (`max-h-[560px]`) divided list.

- *Empty state:* "No open sheets — press N when a farmer pulls in".
- *Each row* is a clickable block with a **3px age border on the left**: red if open ≥ 60 min, primary blue if ≥ 30 min, transparent otherwise. The selected row gets a faint primary background + inset ring; others highlight on hover.
  - Main click area (selects the sheet): farmer name (bold, truncated) + ticket number; second line: lot-code chip (bordered monospace), crop, and Clock icon + open time + age ("just now", "42m", "2h 5m").
  - Right side: StatusBadge, a "needs grade" chip if any completed load lacks moisture, and a small **DETAILS** text-button that opens the Sheet Detail dialog.
  - LoadSlots bar for the sheet.
  - Bottom status line (monospace, muted): if a truck is on the scale → primary-colored `{truckId} on scale · {lbs} lbs — awaiting weigh-out`; otherwise `net {lbs} lbs · {bu} bu · ready for next truck` (the last clause only when under 10 loads).

### 5.6 Operations overview (collapsible, below the work area)

A full-width collapsible section (open/closed state persisted in localStorage `gt-ops-overview`, default open). The toggle bar is a `gt-panel` button: cyan LED + "Operations overview · today" + chevron.

When open it shows (with skeleton loading and a retryable error banner):

1. **KPI strip** (5 StatCards, `grid-cols-2 md:3 xl:5`): Inbound today (lbs, sub "x bu received", green), Outbound today (lbs, sub "x bu shipped"), Loads weighed out (count, sub "n sheets opened today", green), On the scale (count awaiting weigh-out, primary when > 0), Bin utilization (% with sub "x lbs in n bins", primary when > 90%).
2. If no loads yet: an empty state — "No loads yet today / Once the first truck weighs in, this overview starts tracking throughput."
3. **Hourly throughput chart** (3/5 width) + **Crop mix donut** (2/5 width).
4. **Bin utilization board** (3/5 width) + **Activity feed** (2/5 width).

### 5.7 Dialogs and print layer (invisible until triggered)

- **NewSheetDialog** — create a weight sheet (site, farmer/lot or quick-lot with auto lot code `706C-{INITIALS}-{YY}{NN}`, crop, direction, landlord split). On success the new sheet is auto-selected.
- **SheetDetailDialog** — full sheet view: every load, per-load void, grading (moisture/test weight), **Close sheet** (with confirm dialog; blocked while a truck is on the scale), and ticket reprint.
- **TicketPrint** — a print-only component; when set, it renders the scale ticket offscreen and `printTicket()` triggers the browser print after a 150 ms delay.

---

## 6. The weigh workflow state machine

The page derives a `stage` from the selected sheet:

| Stage | Condition | Meaning |
|---|---|---|
| `none` | no sheet selected | both buttons disabled |
| `first` | sheet selected, no active load | WEIGH IN enabled (green) |
| `second` | sheet selected, a load is on the scale (`activeLoad` ≠ null) | WEIGH OUT enabled (blue) |

**Capture weight** = scale reading when connected, else the manual-entry number.

**On WEIGH IN (`sheets.weighFirst`):** requires a truck ID; sends sheet id + rounded weight + truckId + binId (the chosen bin, or the auto-suggested bin when "Auto").

**On WEIGH OUT (`sheets.weighSecond`):** sends sheet id + rounded weight + binId. On success: toast "Load complete — net X lbs (Y bu)", capture beep; if the sheet just hit 10/10, a 10-second warning "Sheet full…" and the selection auto-advances to the next open sheet; if auto-print is on, fetch the sheet and print the last completed load's ticket.

**Direction matters:** INBOUND = weigh loaded first, empty second (net = gross − tare). OUTBOUND = weigh empty first, loaded second (net = gross − tare reversed). The server computes; the UI just labels the buttons and estimates accordingly.

---

## 7. Operator-assist behaviors (all guarded, never blocking except where noted)

1. **No-weight guard:** pressing a button with zero/no weight → error toast "No weight to capture — connect the scale or enter a weight manually."
2. **Truck ID required:** WEIGH IN without a truck ID → error toast, mutation not sent.
3. **Tare memory:** server keeps each truck's average tare and load count (`sheets.truckTares`). Shown as "USUAL TARE …" and powers the autocomplete.
4. **Tare-deviation warning:** when the capture is the tare reading (weigh-out for inbound, weigh-in for outbound) and it deviates > 3% (`TARE_TOLERANCE = 0.03`) from the truck's average → warn beep + 8 s warning toast "…differs N% from this truck's usual X lbs — verify the truck is empty." Non-blocking.
5. **Duplicate-truck guard:** weighing in a truck ID that is already on the scale on another open sheet → warn beep + 8 s warning "{truck} is already weighed in on {ticket} — make sure this isn't a duplicate." Non-blocking.
6. **Bin auto-suggest:** among bins at the sheet's site holding the sheet's crop, sorted least-filled first; if an estimated net exists, the first bin with enough remaining capacity, else fall back to the least-filled. Shown as "Auto → {name}".
7. **Estimated net:** inbound = first weight − usual tare (if known); outbound = current capture − first weight. Shown as "EST NET …".
8. **Repeat last load:** looks at the most recent sheet. If still OPEN → just select it and prefill its last truck ("Selected T-00012 — truck prefilled"). If closed and it had a lot → create a NEW sheet on the same site/lot/direction, select it, prefill truck. Errors toasted otherwise.
9. **Sheet-change prefill:** whenever the selected sheet (or its load count) changes, the truck field is prefilled with the sheet's last truck ID and the bin resets to "Auto" — same rigs haul all day.
10. **Auto-advance on full sheet** and **auto-print** as described in §6.

---

## 8. Keyboard, sound, and timing

- **Keyboard (global listener):** `Space` or `Enter` = capture for the current stage (acts like pressing the enabled big button); `N` = open New Sheet. All ignored while typing in an input/textarea/select/contenteditable, while any dialog is open, while a save is in flight, or with nothing selected. `preventDefault` on handled keys.
- **Sounds (WebAudio, gated by the Sound cues toggle):** `stableBeep` (990 Hz, 70 ms) fires once each time the reading transitions to stable; `captureBeep` on successful weighs; `warnBeep` (220 Hz, 250 ms) on tare/duplicate warnings.
- **Stability:** rolling window of the last 8 readings; stable when at least 6 readings and max−min ≤ 25 lbs. Serial lines are parsed by taking the LAST number on the line (handles "NT 12500 lb", "ST,GS,+ 12500lb", "GR 81,250 LB", bare numbers; thousands separators stripped; absolute value, rounded).
- **Serial port settings:** 9600 baud, 8 data bits, 1 stop bit, no parity.
- **Polling:** open sheets, bins, and daily report refetch every 15 s; the clock re-renders every 30 s; simulator ticks every 400 ms.

---

## 9. Rebuild checklist

1. Shell: dark theme + design tokens (`--go`, `--live`, `--crit`, `--readout`), `gt-panel`, `gt-eyebrow`, `gt-led` variants, `gt-scan`.
2. `useScale` hook (simulator + Web Serial + stability window) and `ScalePanel` (readout, signal bars, mode buttons, simulator slider).
3. Shared kit: PageHeader, StatCard, ErrorBanner, EmptyState, skeletons; fillTone helpers; LoadSlots; NodeToggle; TestBadge; sound lib; printTicket.
4. Dashboard layout in the exact section order of §5 (header → error → bin strip → stats → 5-col grid → ops overview).
5. Stage machine + doWeigh with all seven guards/assists (§6–§7).
6. Keyboard + stable beep + auto-print (§8).
7. Wire the six invalidations after every mutation.
8. Dialogs: NewSheetDialog, SheetDetailDialog (with Close sheet), TicketPrint.
9. Operations overview section (collapsible; KPI strip, throughput chart, crop donut, bin board, activity feed).

---

*Grain Tracker v2 — generated from the live codebase as of 2026-08-18.*
