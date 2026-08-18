import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="font-mono text-8xl font-bold tracking-tighter text-primary">
        404
      </div>
      <div className="space-y-1">
        <p className="text-lg font-medium">This scale ticket doesn&apos;t exist.</p>
        <p className="text-sm text-muted-foreground">
          The page you asked for isn&apos;t on today&apos;s sheet.
        </p>
      </div>
      <Button asChild>
        <Link to="/">Back to the scale</Link>
      </Button>
    </div>
  );
}
