import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { fmtBu, fmtLbs } from "@contracts/grain";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DirectionBadge({ direction }: { direction: "INBOUND" | "OUTBOUND" }) {
  return (
    <Badge
      variant="outline"
      className={
        direction === "INBOUND"
          ? "border-go/50 font-mono text-[10px] text-go"
          : "border-primary/50 font-mono text-[10px] text-primary"
      }
    >
      {direction === "INBOUND" ? "IN" : "OUT"}
    </Badge>
  );
}

function LoadStatusBadge({ status }: { status: "OPEN" | "COMPLETED" }) {
  return status === "OPEN" ? (
    <Badge variant="outline" className="border-live/50 font-mono text-[10px] text-live">
      ON SCALE
    </Badge>
  ) : (
    <Badge variant="outline" className="border-go/50 font-mono text-[10px] text-go">
      COMPLETED
    </Badge>
  );
}

function SummaryCard(props: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "go" | "amber";
}) {
  const toneClass =
    props.tone === "go"
      ? "text-go"
      : props.tone === "amber"
        ? "text-primary"
        : "text-foreground";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="gt-eyebrow">{props.label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`font-mono text-2xl font-semibold ${toneClass}`}>
          {props.value}
        </div>
        {props.sub ? (
          <div className="mt-1 font-mono text-xs text-muted-foreground">{props.sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const utils = trpc.useUtils();
  const [date, setDate] = useState(todayInput);
  const [closeOpen, setCloseOpen] = useState(false);

  const report = trpc.sheets.dailyReport.useQuery({ date });
  const openSheets = trpc.sheets.open.useQuery();

  const closeDay = trpc.sheets.closeDay.useMutation({
    onSuccess: async (r) => {
      toast.success(`${r.closed} sheet${r.closed === 1 ? "" : "s"} closed`);
      if (r.office) {
        if (r.office.ok) {
          toast.success(`Office push OK — ${r.office.pushed} report(s) pushed`);
        } else {
          toast.error(`Office push failed: ${r.office.error ?? "unknown error"}`);
        }
      }
      setCloseOpen(false);
      await Promise.all([
        utils.sheets.dailyReport.invalidate(),
        utils.sheets.open.invalidate(),
        utils.sheets.list.invalidate(),
      ]);
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- office sync ----
  const settings = trpc.sync.getSettings.useQuery();
  const syncStatus = trpc.sync.status.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const [officeUrl, setOfficeUrl] = useState("");
  const [officeKey, setOfficeKey] = useState("");
  useEffect(() => {
    if (settings.data) {
      setOfficeUrl(settings.data.officeUrl);
      setOfficeKey(settings.data.officeKey);
    }
  }, [settings.data]);

  const saveSettings = trpc.sync.setSettings.useMutation({
    onSuccess: async () => {
      toast.success("Office sync settings saved");
      await utils.sync.getSettings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const syncNow = trpc.sync.syncNow.useMutation({
    onSuccess: async (r) => {
      if (r.pull.ok) {
        const p = r.pull.pulled;
        toast.success(
          `Pull OK — ${p ? `${p.farmers} farmers, ${p.landlords} landlords, ${p.lots} lots` : "nothing new"}`,
        );
      } else {
        toast.error(`Pull failed: ${r.pull.error ?? "unknown error"}`);
      }
      if (r.push.ok) {
        toast.success(`Push OK — ${r.push.pushed} package(s) sent`);
      } else {
        toast.error(`Push failed: ${r.push.error ?? "unknown error"}`);
      }
      await utils.sync.status.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const data = report.data;
  const openCount = openSheets.data?.length ?? 0;

  return (
    <div className="space-y-6 p-6">
      {/* header + date picker */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Daily Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Day totals, load ledger, bin levels, and end-of-day close.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-date" className="gt-eyebrow">
            Report date
          </Label>
          <Input
            id="report-date"
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
            className="w-44 font-mono"
          />
        </div>
      </div>

      {/* summary cards */}
      {report.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {["a", "b", "c", "d"].map((k) => (
            <Card key={k}>
              <CardHeader className="pb-2">
                <Skeleton className="h-3 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
                <Skeleton className="mt-2 h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Sheets opened" value={String(data.sheetCount)} />
          <SummaryCard
            label="Loads weighed"
            value={String(data.loadCount)}
            sub={`${data.completedCount} completed`}
          />
          <SummaryCard
            label="Inbound"
            value={`${fmtLbs(data.inboundLbs)} lbs`}
            sub={`${fmtBu(data.inboundBu)} bu`}
            tone="go"
          />
          <SummaryCard
            label="Outbound"
            value={`${fmtLbs(data.outboundLbs)} lbs`}
            sub={`${fmtBu(data.outboundBu)} bu`}
            tone="amber"
          />
        </div>
      ) : null}

      {/* by crop / by farmer */}
      {data && data.loadCount > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By crop</CardTitle>
              <CardDescription>Net totals for completed loads.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Crop</TableHead>
                    <TableHead className="text-right">Loads</TableHead>
                    <TableHead className="text-right">Net lbs</TableHead>
                    <TableHead className="text-right">Net bu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byCrop.map((r) => (
                    <TableRow key={r.crop}>
                      <TableCell className="font-medium">{r.crop}</TableCell>
                      <TableCell className="text-right font-mono">{r.count}</TableCell>
                      <TableCell className="text-right font-mono">{fmtLbs(r.lbs)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtBu(r.bu)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By farmer</CardTitle>
              <CardDescription>Net totals for completed loads.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Farmer</TableHead>
                    <TableHead className="text-right">Loads</TableHead>
                    <TableHead className="text-right">Net lbs</TableHead>
                    <TableHead className="text-right">Net bu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byFarmer.map((r) => (
                    <TableRow key={r.farmer}>
                      <TableCell className="font-medium">{r.farmer}</TableCell>
                      <TableCell className="text-right font-mono">{r.count}</TableCell>
                      <TableCell className="text-right font-mono">{fmtLbs(r.lbs)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtBu(r.bu)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* loads ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Loads ledger</CardTitle>
          <CardDescription>Every load weighed on {date}.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.isLoading ? (
            <div className="space-y-2">
              {["a", "b", "c", "d", "e"].map((k) => (
                <Skeleton key={k} className="h-8 w-full" />
              ))}
            </div>
          ) : !data || data.loads.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              No loads recorded for this date.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Farmer</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Crop</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead>Truck</TableHead>
                    <TableHead>Bin</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Tare</TableHead>
                    <TableHead className="text-right">Net lbs</TableHead>
                    <TableHead className="text-right">Net bu</TableHead>
                    <TableHead className="text-right">Moist %</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.loads.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.ticketNo}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {fmtTime(l.createdAt)}
                      </TableCell>
                      <TableCell>{l.farmerName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.lotCode ?? "—"}
                      </TableCell>
                      <TableCell>{l.crop}</TableCell>
                      <TableCell>
                        <DirectionBadge direction={l.direction} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.truckId ?? "—"}
                      </TableCell>
                      <TableCell>{l.binName ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtLbs(l.grossLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtLbs(l.tareLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtLbs(l.netLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtBu(l.netBushels)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {l.moisturePct != null ? l.moisturePct.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell>
                        <LoadStatusBadge status={l.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* bin levels snapshot */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bin levels</CardTitle>
          <CardDescription>Inventory snapshot at report time.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.isLoading ? (
            <div className="space-y-2">
              {["a", "b", "c"].map((k) => (
                <Skeleton key={k} className="h-8 w-full" />
              ))}
            </div>
          ) : !data || data.bins.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              No bins configured.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead className="text-right">Current lbs</TableHead>
                  <TableHead className="text-right">Capacity lbs</TableHead>
                  <TableHead className="w-40">Fill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bins.map((b) => {
                  const pct =
                    b.capacityLbs > 0
                      ? Math.min(100, (b.currentLbs / b.capacityLbs) * 100)
                      : 0;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {b.siteName ?? "—"}
                      </TableCell>
                      <TableCell>{b.crop}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtLbs(b.currentLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtLbs(b.capacityLbs)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted">
                            <div
                              className="h-1.5 rounded-full bg-go"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* close day */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm text-destructive">Close day</CardTitle>
          <CardDescription>
            Closes all open sheets and locks the day. If an office portal is
            configured, the end-of-day report is pushed automatically. This
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{openCount}</span> sheet
            {openCount === 1 ? "" : "s"} currently open.
          </div>
          <Button
            variant="destructive"
            onClick={() => setCloseOpen(true)}
            disabled={openSheets.isLoading}
          >
            Close day
          </Button>
        </CardContent>
      </Card>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close the day?</DialogTitle>
            <DialogDescription>
              This closes{" "}
              <span className="font-mono font-semibold text-foreground">
                {openCount}
              </span>{" "}
              currently OPEN sheet{openCount === 1 ? "" : "s"} with reason EOD and
              locks them against further weighing. The day&apos;s report is pushed
              to the office portal if one is configured.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseOpen(false)}
              disabled={closeDay.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => closeDay.mutate()}
              disabled={closeDay.isPending}
            >
              {closeDay.isPending ? "Closing…" : "Close day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* office sync */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Office sync</CardTitle>
          <CardDescription>
            Main-office portal connection. People and lots pull down; daily
            reports push up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="office-url" className="gt-eyebrow">
                Office URL
              </Label>
              {settings.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Input
                  id="office-url"
                  placeholder="https://office.example.com"
                  value={officeUrl}
                  onChange={(e) => setOfficeUrl(e.target.value)}
                  className="font-mono text-xs"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="office-key" className="gt-eyebrow">
                Office key
              </Label>
              {settings.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Input
                  id="office-key"
                  type="password"
                  placeholder="shared key"
                  value={officeKey}
                  onChange={(e) => setOfficeKey(e.target.value)}
                  className="font-mono text-xs"
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => saveSettings.mutate({ officeUrl, officeKey })}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? "Saving…" : "Save settings"}
            </Button>
            <Button
              onClick={() => syncNow.mutate({ date })}
              disabled={syncNow.isPending}
            >
              {syncNow.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </div>

          <Separator />

          <div>
            <div className="gt-eyebrow mb-2">Sync log</div>
            {syncStatus.isLoading ? (
              <div className="space-y-2">
                {["a", "b", "c"].map((k) => (
                  <Skeleton key={k} className="h-7 w-full" />
                ))}
              </div>
            ) : !syncStatus.data || syncStatus.data.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                No sync activity yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncStatus.data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.direction === "PUSH"
                              ? "border-primary/50 font-mono text-[10px] text-primary"
                              : "border-live/50 font-mono text-[10px] text-live"
                          }
                        >
                          {row.direction}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.status === "OK"
                              ? "border-go/50 font-mono text-[10px] text-go"
                              : "border-crit/60 font-mono text-[10px] text-crit"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                        {row.detail ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {fmtDateTime(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
