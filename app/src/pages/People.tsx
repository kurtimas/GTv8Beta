import { useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CROPS, type Crop } from "@contracts/grain";
import type { LotRow } from "@contracts/types";
import type { Farmer } from "@db/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Light email sanity check — the backend validates authoritatively. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function TableSkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              <Skeleton className="h-4 w-full max-w-[140px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-10 text-center">
        <span className="text-sm text-muted-foreground">{message}</span>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Farmer dialog (add + edit)
// ---------------------------------------------------------------------------

function FarmerDialog({
  farmer,
  onClose,
}: {
  farmer: Farmer | null; // null = add
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(farmer?.name ?? "");
  const [phone, setPhone] = useState(farmer?.phone ?? "");
  const [email, setEmail] = useState(farmer?.email ?? "");

  const onSuccess = async (verb: string) => {
    toast.success(`Farmer "${name.trim()}" ${verb}`);
    onClose();
    await utils.people.farmers.list.invalidate();
  };
  const createFarmer = trpc.people.farmers.create.useMutation({
    onSuccess: () => onSuccess("added"),
    onError: (err) => toast.error(err.message),
  });
  const updateFarmer = trpc.people.farmers.update.useMutation({
    onSuccess: () => onSuccess("updated"),
    onError: (err) => toast.error(err.message),
  });
  const pending = createFarmer.isPending || updateFarmer.isPending;

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      toast.error("Farmer name is required");
      return;
    }
    if (trimmedEmail && !looksLikeEmail(trimmedEmail)) {
      toast.error("That doesn't look like a valid email address");
      return;
    }
    if (farmer) {
      updateFarmer.mutate({
        id: farmer.id,
        name: trimmedName,
        phone: trimmedPhone,
        email: trimmedEmail,
      });
    } else {
      createFarmer.mutate({
        name: trimmedName,
        phone: trimmedPhone || undefined,
        email: trimmedEmail || undefined,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{farmer ? `Edit farmer — ${farmer.name}` : "Add farmer"}</DialogTitle>
          <DialogDescription>
            {farmer
              ? "Update contact details for this grower."
              : "Add a grower before harvest starts — lots and weight sheets hang off farmers."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="farmer-name">Name</Label>
            <Input
              id="farmer-name"
              placeholder="Kurt Miller"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="farmer-phone">Phone (optional)</Label>
              <Input
                id="farmer-phone"
                placeholder="555-0142"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="farmer-email">Email (optional)</Label>
              <Input
                id="farmer-email"
                type="email"
                placeholder="kurt@farm.example"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : farmer ? "Save changes" : "Add farmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Landlord dialog (add)
// ---------------------------------------------------------------------------

function LandlordDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const createLandlord = trpc.people.landlords.create.useMutation({
    onSuccess: async () => {
      toast.success(`Landlord "${name.trim()}" added`);
      onClose();
      await utils.people.landlords.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Landlord name is required");
      return;
    }
    createLandlord.mutate({
      name: name.trim(),
      phone: phone.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add landlord</DialogTitle>
          <DialogDescription>
            Landlords take a crop-share percentage of a lot's loads.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="landlord-name">Name</Label>
            <Input
              id="landlord-name"
              placeholder="Sam Cole"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="landlord-phone">Phone (optional)</Label>
            <Input
              id="landlord-phone"
              placeholder="555-0119"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createLandlord.isPending}>
            {createLandlord.isPending ? "Adding…" : "Add landlord"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lot create dialog
// ---------------------------------------------------------------------------

const NO_LANDLORD = "none";

function LotDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const farmersQuery = trpc.people.farmers.list.useQuery();
  const landlordsQuery = trpc.people.landlords.list.useQuery();
  const farmers = farmersQuery.data ?? [];
  const landlords = landlordsQuery.data ?? [];

  const [farmerId, setFarmerId] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [crop, setCrop] = useState<Crop>("Corn");
  const [landlordId, setLandlordId] = useState(NO_LANDLORD);
  const [splitPct, setSplitPct] = useState("");
  const [notes, setNotes] = useState("");

  const farmerIdNum = Number(farmerId);
  const nextCode = trpc.people.lots.nextCode.useQuery(
    { farmerId: farmerIdNum },
    { enabled: farmerId !== "" && Number.isFinite(farmerIdNum) },
  );

  // Auto-suggest the lot code from the farmer; stop once the operator edits.
  // (Render-phase state adjustment instead of an effect — React docs pattern.)
  const suggestion = nextCode.data?.code ?? null;
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  if (!codeEdited && suggestion != null && suggestion !== appliedSuggestion) {
    setAppliedSuggestion(suggestion);
    setCode(suggestion);
  }

  const createLot = trpc.people.lots.create.useMutation({
    onSuccess: async () => {
      toast.success(`Lot ${code.trim()} created`);
      onClose();
      await Promise.all([
        utils.people.lots.list.invalidate(),
        utils.people.lots.nextCode.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (farmerId === "" || !Number.isFinite(farmerIdNum)) {
      toast.error("Pick a farmer first");
      return;
    }
    if (!code.trim()) {
      toast.error("Lot code is required");
      return;
    }
    let split = 0;
    if (landlordId !== NO_LANDLORD) {
      const n = Number(splitPct);
      if (splitPct.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
        toast.error("Landlord split must be a number between 0 and 100");
        return;
      }
      split = n;
    }
    createLot.mutate({
      farmerId: farmerIdNum,
      landlordId: landlordId === NO_LANDLORD ? undefined : Number(landlordId),
      code: code.trim(),
      crop,
      landlordSplitPct: split,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create lot</DialogTitle>
          <DialogDescription>
            A lot is a farmer's field/contract identity for a crop — weight
            sheets are opened against an OPEN lot.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Farmer</Label>
              <Select value={farmerId} onValueChange={setFarmerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select farmer…" />
                </SelectTrigger>
                <SelectContent>
                  {farmers.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {farmers.length === 0 && !farmersQuery.isPending && (
                <p className="text-xs text-muted-foreground">
                  No farmers yet — add one on the Farmers tab first.
                </p>
              )}
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

          <div className="space-y-1.5">
            <Label htmlFor="lot-code">Lot code</Label>
            <Input
              id="lot-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeEdited(true);
              }}
              placeholder={
                farmerId === "" ? "Pick a farmer for a suggestion…" : "706C-XX-0000"
              }
              className="font-mono"
            />
            <p className="font-mono text-xs text-muted-foreground">
              {nextCode.isFetching
                ? "Suggesting next code…"
                : "Suggested automatically from the farmer — editable."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Landlord (optional)</Label>
              <Select value={landlordId} onValueChange={setLandlordId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LANDLORD}>None</SelectItem>
                  {landlords.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {landlordId !== NO_LANDLORD && (
              <div className="space-y-1.5">
                <Label htmlFor="lot-split">Landlord split %</Label>
                <Input
                  id="lot-split"
                  inputMode="decimal"
                  placeholder="33.3"
                  value={splitPct}
                  onChange={(e) => setSplitPct(e.target.value)}
                  className="font-mono text-right"
                />
                <p className="text-xs text-muted-foreground">
                  Landlord's share of each load (0-100).
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lot-notes">Notes (optional)</Label>
            <Textarea
              id="lot-notes"
              placeholder="North 40, pivot corners…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={createLot.isPending || farmers.length === 0}
          >
            {createLot.isPending ? "Creating…" : "Create lot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lot close confirmation
// ---------------------------------------------------------------------------

function CloseLotDialog({
  lot,
  onClose,
}: {
  lot: LotRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();

  const setStatus = trpc.people.lots.setStatus.useMutation({
    onSuccess: async () => {
      toast.success(`Lot ${lot.code} closed`);
      onClose();
      await utils.people.lots.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close lot {lot.code}?</DialogTitle>
          <DialogDescription>
            CLOSED lots block new weight sheets from being opened against them.
            Existing sheets are unaffected, and the lot can be reopened later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => setStatus.mutate({ id: lot.id, status: "CLOSED" })}
            disabled={setStatus.isPending}
          >
            {setStatus.isPending ? "Closing…" : "Close lot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function FarmersTab() {
  const farmersQuery = trpc.people.farmers.list.useQuery();
  const [dialog, setDialog] = useState<{ farmer: Farmer | null } | null>(null);
  const farmers = farmersQuery.data ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="gt-eyebrow">Growers</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {farmersQuery.isPending
                ? "Loading…"
                : `${farmers.length} farmer${farmers.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Button onClick={() => setDialog({ farmer: null })}>
            <Plus className="mr-2 h-4 w-4" />
            Add farmer
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Added</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {farmersQuery.isPending ? (
              <TableSkeletonRows cols={5} />
            ) : farmers.length === 0 ? (
              <EmptyRow cols={5} message="Add farmers before harvest starts." />
            ) : (
              farmers.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {f.phone ?? "—"}
                  </TableCell>
                  <TableCell>{f.email ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtDate(f.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit farmer"
                      onClick={() => setDialog({ farmer: f })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      {dialog && (
        <FarmerDialog
          key={dialog.farmer?.id ?? "new"}
          farmer={dialog.farmer}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
}

function LandlordsTab() {
  const landlordsQuery = trpc.people.landlords.list.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const landlords = landlordsQuery.data ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="gt-eyebrow">Crop-share landlords</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {landlordsQuery.isPending
                ? "Loading…"
                : `${landlords.length} landlord${landlords.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add landlord
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {landlordsQuery.isPending ? (
              <TableSkeletonRows cols={3} />
            ) : landlords.length === 0 ? (
              <EmptyRow
                cols={3}
                message="No landlords yet — add one when a lot is crop-shared."
              />
            ) : (
              landlords.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {l.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtDate(l.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      {dialogOpen && <LandlordDialog onClose={() => setDialogOpen(false)} />}
    </Card>
  );
}

function LotsTab() {
  const utils = trpc.useUtils();
  const lotsQuery = trpc.people.lots.list.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closingLot, setClosingLot] = useState<LotRow | null>(null);
  const lots = lotsQuery.data ?? [];

  const reopen = trpc.people.lots.setStatus.useMutation({
    onSuccess: async (_data, vars) => {
      toast.success(`Lot #${vars.id} reopened`);
      await utils.people.lots.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="gt-eyebrow">Lots</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {lotsQuery.isPending
                ? "Loading…"
                : `${lots.length} lot${lots.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create lot
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Farmer</TableHead>
              <TableHead>Crop</TableHead>
              <TableHead>Landlord</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead className="w-[110px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lotsQuery.isPending ? (
              <TableSkeletonRows cols={8} />
            ) : lots.length === 0 ? (
              <EmptyRow
                cols={8}
                message="No lots yet — create one per farmer field before harvest."
              />
            ) : (
              lots.map((lot) => (
                <TableRow key={lot.id}>
                  <TableCell className="font-mono font-semibold tabular-nums">
                    {lot.code}
                  </TableCell>
                  <TableCell>{lot.farmerName ?? "—"}</TableCell>
                  <TableCell>{lot.crop}</TableCell>
                  <TableCell>
                    {lot.landlordId && lot.landlordName ? (
                      <span className="inline-flex items-center gap-2">
                        {lot.landlordName}
                        <Badge variant="outline" className="font-mono tabular-nums">
                          {lot.landlordSplitPct}% split
                        </Badge>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {lot.status === "OPEN" ? (
                      <Badge>OPEN</Badge>
                    ) : (
                      <Badge variant="secondary">CLOSED</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    {lot.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtDate(lot.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {lot.status === "OPEN" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setClosingLot(lot)}
                      >
                        Close
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          reopen.mutate({ id: lot.id, status: "OPEN" })
                        }
                        disabled={reopen.isPending}
                      >
                        Reopen
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      {dialogOpen && <LotDialog onClose={() => setDialogOpen(false)} />}
      {closingLot && (
        <CloseLotDialog lot={closingLot} onClose={() => setClosingLot(null)} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function People() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest">
            Farmers, landlords &amp; lots
          </h2>
          <p className="text-xs text-muted-foreground">
            The people side of every weight sheet — set up before harvest starts.
          </p>
        </div>
      </div>

      <Tabs defaultValue="farmers">
        <TabsList>
          <TabsTrigger value="farmers">Farmers</TabsTrigger>
          <TabsTrigger value="landlords">Landlords</TabsTrigger>
          <TabsTrigger value="lots">Lots</TabsTrigger>
        </TabsList>
        <TabsContent value="farmers" className="mt-4">
          <FarmersTab />
        </TabsContent>
        <TabsContent value="landlords" className="mt-4">
          <LandlordsTab />
        </TabsContent>
        <TabsContent value="lots" className="mt-4">
          <LotsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
