import { useMemo, useState } from "react";
import { Gauge, Pencil, Plus, Trash2, Warehouse } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  CROPS,
  bushelWeight,
  fmtLbs,
  type Crop,
} from "@contracts/grain";
import type { BinRow } from "@contracts/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBuInput(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function fmtBuLive(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Fill bar color thresholds: green <70%, amber 70-90%, red >90%. */
function fillBarClass(pct: number): string {
  if (pct > 90) return "bg-crit";
  if (pct >= 70) return "bg-primary";
  return "bg-go";
}

function fillTextClass(pct: number): string {
  if (pct > 90) return "text-crit";
  if (pct >= 70) return "text-primary";
  return "text-go";
}

/**
 * Bushel <-> lbs capacity converter. Operator can type bushels (converted
 * live using the crop's standard bushel weight) or lbs directly; both fields
 * stay in sync. `capacityLbs` is the parsed positive integer lbs, or null.
 */
function useCapacityConverter(crop: string, initialLbs?: number) {
  const weight = bushelWeight(crop);
  const [bu, setBu] = useState(() =>
    initialLbs != null ? fmtBuInput(initialLbs / weight) : "",
  );
  const [lbs, setLbs] = useState(() =>
    initialLbs != null ? String(initialLbs) : "",
  );

  // When the crop changes, the lb/bu factor changes — re-derive lbs from bu.
  const [prevWeight, setPrevWeight] = useState(weight);
  if (prevWeight !== weight) {
    setPrevWeight(weight);
    const n = Number(bu);
    if (bu.trim() !== "" && Number.isFinite(n)) {
      setLbs(n > 0 ? String(Math.round(n * weight)) : "");
    }
  }

  const onBuChange = (v: string) => {
    setBu(v);
    const n = Number(v);
    setLbs(v.trim() !== "" && Number.isFinite(n) && n > 0 ? String(Math.round(n * weight)) : "");
  };

  const onLbsChange = (v: string) => {
    setLbs(v);
    const n = Number(v);
    setBu(v.trim() !== "" && Number.isFinite(n) && n > 0 ? fmtBuInput(n / weight) : "");
  };

  const lbsNum = Number(lbs);
  const capacityLbs =
    lbs.trim() !== "" && Number.isFinite(lbsNum) && lbsNum > 0
      ? Math.round(lbsNum)
      : null;

  return { bu, lbs, weight, capacityLbs, onBuChange, onLbsChange };
}

function CapacityFields({
  converter,
}: {
  converter: ReturnType<typeof useCapacityConverter>;
}) {
  const { bu, lbs, weight, capacityLbs, onBuChange, onLbsChange } = converter;
  const buNum = Number(bu);
  const showConversion =
    bu.trim() !== "" && Number.isFinite(buNum) && buNum > 0 && capacityLbs != null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="capacity-bu">Capacity (bushels)</Label>
          <Input
            id="capacity-bu"
            inputMode="decimal"
            placeholder="25,000"
            value={bu}
            onChange={(e) => onBuChange(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="capacity-lbs">Capacity (lbs)</Label>
          <Input
            id="capacity-lbs"
            inputMode="numeric"
            placeholder="1,400,000"
            value={lbs}
            onChange={(e) => onLbsChange(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {showConversion ? (
          <>
            {fmtBuLive(buNum)} bu × {weight} lb/bu ={" "}
            <span className="text-foreground">{fmtLbs(capacityLbs)} lb</span>
          </>
        ) : (
          <>Enter bushels (converted at {weight} lb/bu) or lbs directly.</>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function AddSiteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  const createSite = trpc.core.sites.create.useMutation({
    onSuccess: async () => {
      toast.success(`Site "${name.trim()}" added`);
      setName("");
      setLocation("");
      onOpenChange(false);
      await utils.core.sites.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Site name is required");
      return;
    }
    createSite.mutate({
      name: name.trim(),
      location: location.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add site</DialogTitle>
          <DialogDescription>
            A site is one elevator location / yard that holds bins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="site-name">Name</Label>
            <Input
              id="site-name"
              placeholder="Main Yard"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-location">Location (optional)</Label>
            <Input
              id="site-location"
              placeholder="Hwy 14, east of town"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createSite.isPending}>
            {createSite.isPending ? "Adding…" : "Add site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddBinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const sitesQuery = trpc.core.sites.list.useQuery();
  const sites = sitesQuery.data ?? [];

  const [siteId, setSiteId] = useState<string>("");
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<Crop>("Corn");
  const capacity = useCapacityConverter(crop);

  const createBin = trpc.core.bins.create.useMutation({
    onSuccess: async () => {
      toast.success(`Bin "${name.trim()}" added`);
      onOpenChange(false);
      await Promise.all([
        utils.core.bins.list.invalidate(),
        utils.core.sites.list.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const siteIdNum = Number(siteId);
    if (!siteId || !Number.isFinite(siteIdNum)) {
      toast.error("Pick a site first");
      return;
    }
    if (!name.trim()) {
      toast.error("Bin name is required");
      return;
    }
    if (capacity.capacityLbs == null) {
      toast.error("Enter a valid capacity");
      return;
    }
    createBin.mutate({
      siteId: siteIdNum,
      name: name.trim(),
      crop,
      capacityLbs: capacity.capacityLbs,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add bin</DialogTitle>
          <DialogDescription>
            Capacity can be entered in bushels — it converts to lbs using the
            crop's standard bushel weight.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Select site…" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={String(site.id)}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sites.length === 0 && !sitesQuery.isPending && (
              <p className="text-xs text-muted-foreground">
                No sites yet — add a site first.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bin-name">Name</Label>
              <Input
                id="bin-name"
                placeholder="Bin 1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Crop</Label>
              <Select value={crop} onValueChange={(v) => setCrop(v as Crop)}>
                <SelectTrigger>
                  <SelectValue />
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
          <CapacityFields converter={capacity} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={createBin.isPending || sites.length === 0}
          >
            {createBin.isPending ? "Adding…" : "Add bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBinDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(bin.name);
  const [crop, setCrop] = useState<Crop>(
    (CROPS as readonly string[]).includes(bin.crop) ? (bin.crop as Crop) : "Corn",
  );
  const capacity = useCapacityConverter(crop, bin.capacityLbs);

  const updateBin = trpc.core.bins.update.useMutation({
    onSuccess: async () => {
      toast.success(`Bin "${name.trim()}" updated`);
      onClose();
      await utils.core.bins.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Bin name is required");
      return;
    }
    if (capacity.capacityLbs == null) {
      toast.error("Enter a valid capacity");
      return;
    }
    updateBin.mutate({
      id: bin.id,
      name: name.trim(),
      crop,
      capacityLbs: capacity.capacityLbs,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit bin — {bin.name}</DialogTitle>
          <DialogDescription>
            Rename, change the crop, or resize the bin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-bin-name">Name</Label>
              <Input
                id="edit-bin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Crop</Label>
              <Select value={crop} onValueChange={(v) => setCrop(v as Crop)}>
                <SelectTrigger>
                  <SelectValue />
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
          <CapacityFields converter={capacity} />
          {bin.currentLbs > 0 && capacity.capacityLbs != null && (
            <p
              className={cn(
                "font-mono text-xs",
                capacity.capacityLbs < bin.currentLbs
                  ? "text-crit"
                  : "text-muted-foreground",
              )}
            >
              Currently holding {fmtLbs(bin.currentLbs)} lb
              {capacity.capacityLbs < bin.currentLbs
                ? " — new capacity is below the current level"
                : ""}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={updateBin.isPending}>
            {updateBin.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustLevelDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(String(bin.currentLbs));

  const adjust = trpc.core.bins.adjust.useMutation({
    onSuccess: async () => {
      toast.success(`${bin.name} level set to ${fmtLbs(Number(value))} lb`);
      onClose();
      await utils.core.bins.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Enter a valid non-negative level in lbs");
      return;
    }
    adjust.mutate({ id: bin.id, currentLbs: Math.round(n) });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust level — {bin.name}</DialogTitle>
          <DialogDescription>
            Set the bin contents to a physical measurement. Normally inventory
            moves automatically with weight sheets — use this only to correct
            drift.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="adjust-lbs">Current contents (lbs)</Label>
          <Input
            id="adjust-lbs"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
            autoFocus
          />
          <p className="font-mono text-xs text-muted-foreground">
            Capacity: {fmtLbs(bin.capacityLbs)} lb
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={adjust.isPending}>
            {adjust.isPending ? "Saving…" : "Set level"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBinDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();

  const deleteBin = trpc.core.bins.delete.useMutation({
    onSuccess: async () => {
      toast.success(`Bin "${bin.name}" deleted`);
      onClose();
      await utils.core.bins.list.invalidate();
    },
    // Backend refuses when the bin is not empty or has load history.
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete bin — {bin.name}?</DialogTitle>
          <DialogDescription>
            Only empty bins with no load history can be deleted. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        {bin.currentLbs > 0 && (
          <p className="font-mono text-xs text-crit">
            This bin still holds {fmtLbs(bin.currentLbs)} lb — the server will
            refuse to delete it.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteBin.mutate({ id: bin.id })}
            disabled={deleteBin.isPending}
          >
            {deleteBin.isPending ? "Deleting…" : "Delete bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bin card
// ---------------------------------------------------------------------------

function BinCard({
  bin,
  onEdit,
  onAdjust,
  onDelete,
}: {
  bin: BinRow;
  onEdit: () => void;
  onAdjust: () => void;
  onDelete: () => void;
}) {
  const pct =
    bin.capacityLbs > 0 ? (bin.currentLbs / bin.capacityLbs) * 100 : 0;
  const clampedPct = Math.min(pct, 100);
  const bu = bin.currentLbs / bushelWeight(bin.crop);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{bin.name}</CardTitle>
          <div className="mt-1.5">
            <Badge variant="secondary">{bin.crop}</Badge>
          </div>
        </div>
        <div className="flex flex-none items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Edit bin"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Adjust level (physical measurement)"
            onClick={onAdjust}
          >
            <Gauge className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Delete bin"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("font-mono text-2xl font-bold tabular-nums", fillTextClass(pct))}>
            {pct.toFixed(1)}%
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {fmtBuLive(bu)} bu
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", fillBarClass(pct))}
            style={{ width: `${clampedPct}%` }}
          />
        </div>
        <div className="flex items-baseline justify-between gap-2 font-mono text-xs tabular-nums">
          <span className="text-foreground">{fmtLbs(bin.currentLbs)} lb</span>
          <span className="text-muted-foreground">
            / {fmtLbs(bin.capacityLbs)} lb
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Bins() {
  const sitesQuery = trpc.core.sites.list.useQuery();
  const binsQuery = trpc.core.bins.list.useQuery();

  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [binDialogOpen, setBinDialogOpen] = useState(false);
  const [editBin, setEditBin] = useState<BinRow | null>(null);
  const [adjustBin, setAdjustBin] = useState<BinRow | null>(null);
  const [deleteBin, setDeleteBin] = useState<BinRow | null>(null);

  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const bins = useMemo(() => binsQuery.data ?? [], [binsQuery.data]);
  const loading = sitesQuery.isPending || binsQuery.isPending;

  const stats = useMemo(() => {
    const capacity = bins.reduce((sum, b) => sum + b.capacityLbs, 0);
    const current = bins.reduce((sum, b) => sum + b.currentLbs, 0);
    const fillPct = capacity > 0 ? (current / capacity) * 100 : 0;
    return { capacity, current, fillPct, count: bins.length };
  }, [bins]);

  const groups = useMemo(() => {
    const bySite = new Map<number, { name: string; location: string | null; bins: BinRow[] }>();
    for (const site of sites) {
      bySite.set(site.id, { name: site.name, location: site.location, bins: [] });
    }
    const unassigned: BinRow[] = [];
    for (const bin of bins) {
      const group = bySite.get(bin.siteId);
      if (group) group.bins.push(bin);
      else unassigned.push(bin);
    }
    return { bySite: [...bySite.values()], unassigned };
  }, [sites, bins]);

  const isEmpty = !loading && sites.length === 0 && bins.length === 0;

  return (
    <div className="space-y-6">
      {/* ---- Header stats + actions ------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">Total capacity</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {fmtLbs(stats.capacity)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">lb</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">On hand</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {fmtLbs(stats.current)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">lb</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">Overall fill</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-16" />
              ) : (
                <div
                  className={cn(
                    "mt-1 font-mono text-xl font-bold tabular-nums",
                    fillTextClass(stats.fillPct),
                  )}
                >
                  {stats.fillPct.toFixed(1)}%
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">Bins</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-10" />
              ) : (
                <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {stats.count}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-none gap-2">
          <Button variant="outline" onClick={() => setSiteDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add site
          </Button>
          <Button onClick={() => setBinDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add bin
          </Button>
        </div>
      </div>

      {/* ---- Body ------------------------------------------------------- */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Warehouse className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Add your first site and bin to start tracking inventory.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSiteDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add site
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.bySite.map((group) => (
            <section key={group.name} className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-widest">
                  {group.name}
                </h2>
                {group.location && (
                  <span className="text-xs text-muted-foreground">
                    {group.location}
                  </span>
                )}
                <span className="font-mono text-xs text-muted-foreground">
                  {group.bins.length} bin{group.bins.length === 1 ? "" : "s"}
                </span>
              </div>
              {group.bins.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bins at this site yet.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.bins.map((bin) => (
                    <BinCard
                      key={bin.id}
                      bin={bin}
                      onEdit={() => setEditBin(bin)}
                      onAdjust={() => setAdjustBin(bin)}
                      onDelete={() => setDeleteBin(bin)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
          {groups.unassigned.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest">
                Unassigned
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groups.unassigned.map((bin) => (
                  <BinCard
                    key={bin.id}
                    bin={bin}
                    onEdit={() => setEditBin(bin)}
                    onAdjust={() => setAdjustBin(bin)}
                    onDelete={() => setDeleteBin(bin)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ---- Dialogs ----------------------------------------------------- */}
      <AddSiteDialog open={siteDialogOpen} onOpenChange={setSiteDialogOpen} />
      {/* key remounts the dialog so stale form state never leaks between opens */}
      {binDialogOpen && (
        <AddBinDialog key="add-bin" open onOpenChange={setBinDialogOpen} />
      )}
      {editBin && (
        <EditBinDialog key={editBin.id} bin={editBin} onClose={() => setEditBin(null)} />
      )}
      {adjustBin && (
        <AdjustLevelDialog bin={adjustBin} onClose={() => setAdjustBin(null)} />
      )}
      {deleteBin && (
        <DeleteBinDialog bin={deleteBin} onClose={() => setDeleteBin(null)} />
      )}
    </div>
  );
}
