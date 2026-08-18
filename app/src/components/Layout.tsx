import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Warehouse,
  Users,
  BarChart3,
  Sun,
  Moon,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerOnline } from "@/providers/trpc";
import { Toaster } from "@/components/ui/sonner";

const THEME_STORAGE_KEY = "gt-theme";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sheets", label: "Weight Sheets", icon: FileSpreadsheet },
  { to: "/bins", label: "Bins", icon: Warehouse },
  { to: "/people", label: "Farmers & Lots", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
] as const;

function pageTitleFor(pathname: string): string {
  const match = NAV_ITEMS.find((item) =>
    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to),
  );
  return match?.label ?? "Not Found";
}

function useDaylightMode(): [boolean, () => void] {
  const [day, setDay] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(THEME_STORAGE_KEY) === "day";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("day", day);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, day ? "day" : "console");
    } catch {
      /* storage unavailable (private mode) — class toggle still works */
    }
  }, [day]);

  return [day, () => setDay((v) => !v)];
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString("en-GB", { hour12: false });
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const online = useServerOnline();
  const [day, toggleDay] = useDaylightMode();
  const clock = useClock();
  const pageTitle = pageTitleFor(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ---- Left rail ------------------------------------------------ */}
      <aside className="flex w-60 flex-none flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
          <span className="gt-radar flex h-8 w-8 flex-none items-center justify-center border border-sidebar-border bg-sidebar-accent">
            <span className="relative z-10 h-2 w-2 rounded-full bg-sidebar-primary" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-bold tracking-widest text-sidebar-primary">
              GRAIN TRACKER v2
            </div>
            <div className="gt-eyebrow mt-0.5">Scale House Ops</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className="h-4 w-4 flex-none" />
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className={cn("gt-led", online ? "gt-led-on" : "gt-led-crit")} />
            <span className="font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
              {online ? "Server online" : "Server offline"}
            </span>
          </div>
        </div>
      </aside>

      {/* ---- Right side ------------------------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!online && (
          <div className="flex flex-none items-center gap-2 bg-crit px-4 py-2 text-sm font-medium text-white">
            <WifiOff className="h-4 w-4 flex-none" />
            <span>
              Cannot reach the server — database may still be starting…
            </span>
          </div>
        )}

        <header className="flex flex-none items-center justify-between gap-4 border-b border-border px-6 py-3">
          <div className="min-w-0">
            <div className="gt-eyebrow">Grain Tracker v2</div>
            <h1 className="truncate text-lg font-semibold leading-tight">
              {pageTitle}
            </h1>
          </div>
          <div className="flex flex-none items-center gap-3">
            <button
              type="button"
              onClick={toggleDay}
              title={day ? "Switch to console (dark) mode" : "Switch to daylight mode"}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {day ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2 rounded-md border border-border bg-readout px-3 py-1.5">
              <span className="gt-led gt-led-live" />
              <span className="font-mono text-sm tabular-nums text-foreground">
                {clock}
              </span>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-6">{children}</div>
        </main>
      </div>

      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
