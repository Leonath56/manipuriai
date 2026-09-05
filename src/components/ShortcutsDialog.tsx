import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shortcutDocs } from "@/lib/shortcuts";

/**
 * The shortcut list, reachable with ⌘/ — the convention people already try.
 *
 * Rendered from the same array the handler is built against, so it can't
 * advertise a key that does nothing.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Faster ways through Manipuri AI.</DialogDescription>
        </DialogHeader>
        <dl className="mt-1 divide-y divide-border">
          {shortcutDocs().map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-sm text-muted-foreground">{s.label}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-6 rounded border border-border bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
