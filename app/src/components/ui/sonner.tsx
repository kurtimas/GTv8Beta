import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, toast, type ToasterProps } from "sonner";

/**
 * Grain Tracker theme is the `day` class on <html> (console-dark by default),
 * toggled by Layout — not next-themes. Watch the class so toasts follow it.
 */
function useConsoleTheme(): ToasterProps["theme"] {
  const read = (): ToasterProps["theme"] =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("day")
      ? "light"
      : "dark";

  const [theme, setTheme] = useState<ToasterProps["theme"]>(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function Toaster(props: ToasterProps) {
  const theme = useConsoleTheme();

  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
