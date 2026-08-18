import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useScale, type UseScale } from "@/hooks/useScale";
import { toast } from "@/components/ui/sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { CROPS, fmtBu, fmtLbs } from "@contracts/grain";
import type { SheetRow } from "@contracts/types";

const SIM_MIN_LBS = 1_000;
const SIM_MAX_LBS = 120_000;
const SIM_STEP_LBS = 500;

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-US", { hour12: false });
}

/* ------------------------------------------------------------------ */
/* Scale readout panel                                                 */
/* ------------------------------------------------------------------ */

interface ScalePanelProps {
  scale: UseScale;
  /** Effective weight shown on the readout (live reading wins over manual). */
  weightLbs: number | null;
  onManualLbs: (lbs: number | null) => void;
}

function ScalePanel({ scale, weightLbs, onManualLbs }: ScalePanelProps) {
  const [simBase, setSimBase] = useState(45_000);
  const [manualText, setManualText] = useState("");

  const applyManual = () => {
    const n = Number.parseInt(manualText.replace(/,/g, ""), 10);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a weight in whole pounds (e.g. 45230).");
      return;
    }
    onManualLbs(n);
    setManualText("");
    toast.success(`Manual weight set — ${fmtLbs(n)} lb`);
  };

  const hasReading = weightLbs != null;
  const readoutColor = !hasReading
    ? "text-muted-foreground"
    : scale.stable
      ? "text-go"
      : "text-live";

  const source = scale.connected
    ? "USB scale"
    : scale.simulator.active
      ? "Simulator"
      : hasReading
        ? "Manual entry"
        : "No source";

  return (
    <Card className="gt-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="gt-eyebrow">Scale readout</p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "gt-led",
              hasReading && (scale.stable ? "gt-led-on" : "gt-led-live"),
            )}
          />
          <span
            className={cn(
              "font-mono text-xs font-semibold uppercase tracking-widest",
              !hasReading
                ? "text-muted-foreground"
                : scale.stable
                  ? "text-go"
                  : "text-live",
            )}
          >
            {!hasReading ? "NO SIGNAL" : scale.stable ? "STABLE" : "LIVE"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="gt-scan rounded-md border border-border bg-readout px-6 py-5">
          <div
            className={cn(
              "font-mono text-5xl font-bold tabular-nums tracking-tight md:text-6xl",
              readoutColor,
            )}
          >
            {hasReading ? fmtLbs(weightLbs) : "———"}
            <span className="ml-2 text-xl font-medium text-muted-foreground">lb</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {source}
            {scale.simulator.active ? ` · base ${fmtLbs(simBase)} lb` : ""}
          </div>
        </div>

        {!scale.supported && (
          <Alert>
            <AlertTitle>USB scale not available in this browser</AlertTitle>
            <AlertDescription>
              Web Serial requires Chrome or Edge served over HTTPS or localhost. Use the
              simulator or manual entry below until then.
            </AlertDescription>
          </Alert>
        )}
        {scale.error && (
          <Alert variant="destructive">
            <AlertTitle>Scale error</AlertTitle>
            <AlertDescription>{scale.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {scale.supported &&
            (scale.connected ? (
              <Button variant="outline" onClick={() => void scale.disconnect()}>
                Disconnect scale
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={scale.connecting}
                onClick={() => void scale.connect()}
              >
                {scale.connecting ? "Connecting…" : "Connect USB scale"}
              </Button>
            ))}
          <Button
            variant={scale.simulator.active ? "secondary" : "outline"}
            onClick={() =>
              scale.simulator.active ? scale.simulator.stop() : scale.simulator.start()
            }
          >
            <span className="gt-node" data-on={scale.simulator.active} />
            Simulator
          </Button>
          <Badge variant="outline" className="font-mono">
            {scale.connected ? "SCALE LINKED" : scale.connecting ? "LINKING…" : "SCALE OFFLINE"}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sim-base">Simulator base</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {fmtLbs(simBase)} lb
              </span>
            </div>
            <Slider
              id="sim-base"
              min={SIM_MIN_LBS}
              max={SIM_MAX_LBS}
              step={SIM_STEP_LBS}
              value={[simBase]}
              onValueChange={(v) => {
                const n = v[0] ?? simBase;
                setSimBase(n);
                scale.simulator.setBaseLbs(n);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-weight">Manual entry (lb)</Label>
            <div className="flex gap-2">
              <Input
                id="manual-weight"
                inputMode="numeric"
                placeholder="e.g. 45230"
                className="font-mono"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyManual();
                }}
              />
              <Button variant="secondary" onClick={applyManual}>
                Set
              </Button>
              {source === "Manual entry" && (
                <Button variant="ghost" onClick={() => onManualLbs(null)}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Open sheet queue card                                               */
/* ------------------------------------------------------------------ */

interface SheetCardProps {
  sheet: SheetRow;
  weightLbs: number | null;
  onChanged: () => void;
}

function SheetCard({ sheet, weightLbs, onChanged }: SheetCardProps) {
  const [truckId, setTruckId] = useState(sheet.lastTruckId ?? "");
  const [driverName, setDriverName] = useState("");

  const weighFirst = trpc.sheets.weighFirst.useMutation({
    onSuccess: (data, vars) => {
      toast.success(`Load #${data.loadNo} weighed in — ${fmtLbs(vars.weightLbs)} lb`);
      onChanged();
    },
    onError: (err) => toast.error(err.message),
  });
  const weighSecond = trpc.sheets.weighSecond.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Load complete — net ${fmtLbs(data.netLbs)} lb · ${fmtBu(data.netBushels)} bu`,
        {
          description: data.sheetFull
            ? `Sheet is FULL (${sheet.maxLoads}/${sheet.maxLoads} loads)`
            : undefined,
        },
      );
      onChanged();
    },
    onError: (err) => toast.error(err.message),
  });

  const outbound = sheet.direction === "OUTBOUND";
  const active = sheet.activeLoad;
  const firstLbs = active ? (outbound ? active.tareLbs : active.grossLbs) : null;
  const busy = weighFirst.isPending || weighSecond.isPending;
  const canWeigh = weightLbs != null && !busy;

  return (
    <Card className="gt-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-primary">{sheet.ticketNo}</span>
          <Badge
            variant="outline"
            className={cn(
              "font-mono",
              outbound ? "border-primary/60 text-primary" : "border-live/60 text-live",
            )}
          >
            {sheet.direction}
          </Badge>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {sheet.completedLoads}/{sheet.maxLoads} loads
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">{sheet.farmerName ?? "—"}</span>
          {sheet.lotCode && (
            <span className="font-mono text-xs text-muted-foreground">{sheet.lotCode}</span>
          )}
          <Badge variant="secondary" className="font-mono text-[10px] uppercase">
            {sheet.crop}
          </Badge>
        </div>

        <Separator />

        {active == null ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`truck-${sheet.id}`}>Truck ID</Label>
                <Input
                  id={`truck-${sheet.id}`}
                  className="h-8 font-mono"
                  placeholder="e.g. TRK-14"
                  value={truckId}
                  onChange={(e) => setTruckId(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`driver-${sheet.id}`}>Driver</Label>
                <Input
                  id={`driver-${sheet.id}`}
                  className="h-8"
                  placeholder="Driver name"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                />
              </div>
            </div>
            <Button
              className="h-14 w-full bg-go text-lg font-bold text-background hover:bg-go/90"
              disabled={!canWeigh}
              onClick={() => {
                if (weightLbs == null) return;
                weighFirst.mutate({
                  id: sheet.id,
                  weightLbs,
                  truckId: truckId.trim() || undefined,
                  driverName: driverName.trim() || undefined,
                });
              }}
            >
              {outbound ? "WEIGH IN (EMPTY)" : "WEIGH IN"}
              {weightLbs != null ? ` — ${fmtLbs(weightLbs)} lb` : ""}
            </Button>
          </>
        ) : (
          <>
            <div className="gt-scan flex items-center justify-between rounded-md border border-border bg-readout px-4 py-3">
              <span className="gt-eyebrow">
                {outbound ? "Tare captured" : "Gross captured"}
                {active.truckId ? ` · ${active.truckId}` : ""}
              </span>
              <span className="font-mono text-xl font-semibold tabular-nums text-live">
                {fmtLbs(firstLbs)} lb
              </span>
            </div>
            <Button
              className="h-14 w-full text-lg font-bold"
              disabled={!canWeigh}
              onClick={() => {
                if (weightLbs == null) return;
                weighSecond.mutate({ id: sheet.id, weightLbs });
              }}
            >
              WEIGH OUT{weightLbs != null ? ` — ${fmtLbs(weightLbs)} lb` : ""}
            </Button>
          </>
        )}
        {weightLbs == null && (
          <p className="font-mono text-[11px] text-muted-foreground">
            No weight on the scale — connect, start the simulator, or use manual entry.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* New weight sheet dialog                                             */
/* ------------------------------------------------------------------ */

function NewSheetDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [direction, setDirection] = useState<"INBOUND" | "OUTBOUND">("INBOUND");
  const [lotId, setLotId] = useState("");
  const [farmerId, setFarmerId] = useState("");
  const [crop, setCrop] = useState("");
  const [notes, setNotes] = useState("");

  const sites = trpc.core.sites.list.useQuery(undefined, { enabled: open });
  const lots = trpc.people.lots.list.useQuery(undefined, { enabled: open });
  const farmers = trpc.people.farmers.list.useQuery(undefined, {
    enabled: open && direction === "OUTBOUND",
  });
  const openLots = (lots.data ?? []).filter((l) => l.status === "OPEN");

  const create = trpc.sheets.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Weight sheet ${data.ticketNo} opened`);
      onCreated();
      setOpen(false);
      setLotId("");
      setFarmerId("");
      setCrop("");
      setNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const canSubmit =
    siteId !== "" &&
    (direction === "INBOUND" ? lotId !== "" : farmerId !== "" && crop !== "") &&
    !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate({
      siteId: Number(siteId),
      direction,
      lotId: direction === "INBOUND" ? Number(lotId) : undefined,
      farmerId: direction === "OUTBOUND" ? Number(farmerId) : undefined,
      crop: direction === "OUTBOUND" ? crop : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ New sheet</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New weight sheet</DialogTitle>
          <DialogDescription>
            Open a ticket for the truck on the scale. Inbound sheets tie to an open lot;
            outbound sheets name the farmer and crop directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Select site…" />
              </SelectTrigger>
              <SelectContent>
                {(sites.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.location ? ` — ${s.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Direction</Label>
            <Tabs
              value={direction}
              onValueChange={(v) => setDirection(v as "INBOUND" | "OUTBOUND")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="INBOUND">INBOUND</TabsTrigger>
                <TabsTrigger value="OUTBOUND">OUTBOUND</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {direction === "INBOUND" ? (
            <div className="space-y-1">
              <Label>Open lot</Label>
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select open lot…" />
                </SelectTrigger>
                <SelectContent>
                  {openLots.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.code} — {l.farmerName ?? "?"} — {l.crop}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lots.data && openLots.length === 0 && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  No open lots — create one under Farmers &amp; Lots first.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Farmer</Label>
                <Select value={farmerId} onValueChange={setFarmerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select farmer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(farmers.data ?? []).map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Crop</Label>
                <Select value={crop} onValueChange={setCrop}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select crop…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CROPS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="sheet-notes">Notes (optional)</Label>
            <Textarea
              id="sheet-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit}>
            {create.isPending ? "Opening…" : "Open sheet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity feed                                                */
/* ------------------------------------------------------------------ */

function ActivityFeed() {
  const activity = trpc.sheets.recentActivity.useQuery({}, { refetchInterval: 10_000 });

  return (
    <Card className="gt-panel h-fit">
      <CardHeader className="pb-2">
        <p className="gt-eyebrow">Recent activity</p>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : !activity.data || activity.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {activity.data.map((ev) => (
              <li key={ev.id} className="font-mono text-xs leading-relaxed">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-primary">{ev.ticketNo}</span>
                  <span className="text-muted-foreground">{fmtTime(ev.createdAt)}</span>
                </div>
                <div className="text-foreground">
                  {ev.action}
                  {ev.detail ? (
                    <span className="text-muted-foreground"> — {ev.detail}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard page                                                      */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const utils = trpc.useUtils();
  const scale = useScale();
  const [manualLbs, setManualLbs] = useState<number | null>(null);

  const openSheets = trpc.sheets.open.useQuery(undefined, { refetchInterval: 5_000 });

  const invalidateSheets = () => {
    void utils.sheets.open.invalidate();
    void utils.sheets.list.invalidate();
  };

  // Live scale/simulator readings win over the manual override.
  const effectiveLbs = scale.weightLbs ?? manualLbs;

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ScalePanel scale={scale} weightLbs={effectiveLbs} onManualLbs={setManualLbs} />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="gt-eyebrow">Open sheets</p>
              {openSheets.data && (
                <Badge variant="secondary" className="font-mono">
                  {openSheets.data.length}
                </Badge>
              )}
            </div>
            <NewSheetDialog onCreated={invalidateSheets} />
          </div>

          {openSheets.isPending ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : !openSheets.data || openSheets.data.length === 0 ? (
            <Card className="gt-panel">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No open weight sheets — start one when a truck arrives.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {openSheets.data.map((sheet) => (
                <SheetCard
                  key={sheet.id}
                  sheet={sheet}
                  weightLbs={effectiveLbs}
                  onChanged={invalidateSheets}
                />
              ))}
            </div>
          )}
        </div>

        <ActivityFeed />
      </div>
    </div>
  );
}
