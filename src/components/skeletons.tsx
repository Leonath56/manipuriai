/*
 * Shared skeleton ("pre-interface") building blocks.
 *
 * Everything here is presentational: no data fetching, no state. Each piece
 * mirrors the real UI it stands in for, so swapping skeleton → content never
 * shifts the layout. Colours come from the `shimmer` utility in styles.css,
 * which is theme-aware and already respects prefers-reduced-motion.
 */
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("shimmer rounded-md", className)} {...rest} />;
}

export function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn("h-8 w-8 shrink-0 rounded-full", className)} />;
}

export function SkeletonButton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-9 w-24 rounded-lg", className)} />;
}

/**
 * A block of text lines with naturally uneven widths — identical widths read as
 * a loading grid rather than as sentences.
 */
export function SkeletonText({
  lines = 3,
  widths,
  className,
  lineClassName,
}: {
  lines?: number;
  widths?: string[];
  className?: string;
  lineClassName?: string;
}) {
  const fallback = ["100%", "92%", "78%", "85%", "64%"];
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5 rounded", lineClassName)}
          style={{ width: widths?.[i] ?? fallback[i % fallback.length] }}
        />
      ))}
    </div>
  );
}

/** One conversation turn. Users are right-aligned bubbles, replies are left with an avatar. */
export function ChatMessageSkeleton({
  role,
  lines = 3,
  width = "66%",
}: {
  role: "user" | "assistant";
  lines?: number;
  width?: string;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <Skeleton className="h-11 rounded-2xl rounded-br-md" style={{ width, maxWidth: "85%" }} />
      </div>
    );
  }
  return (
    <div className="flex gap-3 md:gap-4">
      <SkeletonAvatar />
      <div className="min-w-0 flex-1 pt-1">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}

/** The reply skeleton shown in the exact spot the answer will stream into. */
export function ChatResponseSkeleton() {
  return (
    <div role="status" aria-label="Preparing reply" className="w-full py-1">
      <SkeletonText lines={3} widths={["96%", "88%", "62%"]} />
    </div>
  );
}

/** A single sidebar chat row: icon slot + title line. */
export function ConversationSkeleton({ width = "70%" }: { width?: string }) {
  return (
    <li className="flex items-center gap-2 px-2 py-2">
      <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
      <Skeleton className="h-3 rounded" style={{ width }} />
    </li>
  );
}

export function SidebarSkeleton({ rows = 5 }: { rows?: number }) {
  const widths = ["72%", "58%", "84%", "46%", "66%", "78%"];
  return (
    <ul className="space-y-1 px-1" role="status" aria-label="Loading conversations">
      {Array.from({ length: rows }).map((_, i) => (
        <ConversationSkeleton key={i} width={widths[i % widths.length]} />
      ))}
    </ul>
  );
}

/** Full conversation placeholder: a realistic mix of short and long turns. */
export function ChatPageSkeleton() {
  return (
    <div className="space-y-7" role="status" aria-label="Loading conversation">
      <ChatMessageSkeleton role="user" width="42%" />
      <ChatMessageSkeleton role="assistant" lines={3} />
      <ChatMessageSkeleton role="user" width="66%" />
      <ChatMessageSkeleton role="assistant" lines={5} />
      <ChatMessageSkeleton role="user" width="30%" />
      <ChatMessageSkeleton role="assistant" lines={2} />
    </div>
  );
}

/** Matches the new-chat landing screen: mark, greeting, subtitle, suggestion grid. */
export function HomePageSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="text-center">
        <Skeleton className="mx-auto h-14 w-14 rounded-full" />
        <Skeleton className="mx-auto mt-4 h-7 w-64 max-w-full rounded" />
        <Skeleton className="mx-auto mt-3 h-4 w-80 max-w-full rounded" />
      </div>
      <ul className="mt-6 grid gap-2 sm:mt-9 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={i >= 2 ? "hidden sm:list-item" : undefined}>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <Skeleton className="h-4 rounded" style={{ width: i % 2 ? "58%" : "72%" }} />
              <Skeleton className="mt-2 h-3 rounded" style={{ width: i % 2 ? "86%" : "68%" }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Keeps the language/mode pill dimensions so controls don't jump in. */
export function ModelSelectorSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Skeleton className="h-8 w-24 rounded-full" />
      <Skeleton className="h-8 w-28 rounded-full" />
    </div>
  );
}

/** Labelled field rows as used across profile/settings cards. */
export function SettingsSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading settings">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
      <SkeletonButton className="mt-1" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Route-level pre-interfaces                                          */
/*                                                                     */
/* These render the instant the user clicks a link, while the          */
/* destination page's code/data is still on its way. Each one mirrors  */
/* the real page's frame so nothing jumps when content arrives.        */
/* ------------------------------------------------------------------ */

/** The sticky composer's silhouette, so the input never appears to move. */
function ComposerSkeleton() {
  return (
    <div className="border-t border-border bg-background px-4 pb-[env(safe-area-inset-bottom)] pt-3">
      <div className="mx-auto max-w-3xl">
        <Skeleton className="h-[52px] w-full rounded-2xl" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Opening an existing conversation: messages area + composer in place. */
export function ChatRouteSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <ChatPageSkeleton />
        </div>
      </div>
      <ComposerSkeleton />
    </div>
  );
}

/** The new-chat landing screen. */
export function HomeRouteSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-start px-4 py-4 pt-6 sm:justify-center sm:py-10">
          <HomePageSkeleton />
        </div>
      </div>
      <ComposerSkeleton />
    </div>
  );
}

/** Generic page frame: back link, title, then card slots. */
export function PageShellSkeleton({
  cards = 3,
  children,
}: {
  cards?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6" role="status" aria-label="Loading page">
      <Skeleton className="h-4 w-24 rounded" />
      <Skeleton className="mt-4 h-7 w-52 rounded" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full rounded" />
      {children ?? (
        <div className="mt-6 space-y-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <Skeleton className="h-4 w-32 rounded" />
              <div className="mt-3">
                <SkeletonText lines={2} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Profile / settings. */
export function ProfilePageSkeleton() {
  return (
    <PageShellSkeleton>
      <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <SkeletonAvatar className="h-12 w-12" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-3 w-56 max-w-full rounded" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SettingsSkeleton fields={4} />
        </div>
      </div>
    </PageShellSkeleton>
  );
}

/** Dashboard: three stat cards then a recent-chats list. */
export function DashboardPageSkeleton() {
  return (
    <PageShellSkeleton>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="mt-3 h-7 w-16 rounded" />
            <Skeleton className="mt-2 h-3 w-28 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-32 rounded" />
        <ul className="mt-3 space-y-1">
          <SidebarSkeleton rows={5} />
        </ul>
      </div>
    </PageShellSkeleton>
  );
}

/** Image generation: prompt box, style controls, result grid. */
export function ImagePageSkeleton() {
  return (
    <PageShellSkeleton>
      <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
            <SkeletonButton />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageShellSkeleton>
  );
}

/** Voice mode: a centred orb with controls beneath. */
export function VoicePageSkeleton() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4" role="status" aria-label="Loading voice mode">
      <Skeleton className="h-40 w-40 rounded-full" />
      <Skeleton className="h-4 w-40 rounded" />
      <div className="flex gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    </div>
  );
}

/** Admin: stat row, tab row, then a table-ish list. */
export function AdminPageSkeleton() {
  return (
    <PageShellSkeleton>
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="mt-3 h-6 w-14 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-lg" />
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonAvatar />
            <Skeleton className="h-3 flex-1 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        ))}
      </div>
    </PageShellSkeleton>
  );
}

/** Pricing: three plan cards. */
export function PlansPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10" role="status" aria-label="Loading plans">
      <Skeleton className="mx-auto h-8 w-64 max-w-full rounded" />
      <Skeleton className="mx-auto mt-3 h-4 w-96 max-w-full rounded" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="mt-3 h-8 w-28 rounded" />
            <div className="mt-4 space-y-2.5">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-3 rounded" style={{ width: `${90 - j * 9}%` }} />
              ))}
            </div>
            <SkeletonButton className="mt-5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Guest trial page: hero line plus the trial chat frame. */
export function TryPageSkeleton() {
  return (
    <div className="flex h-full flex-col" role="status" aria-label="Loading trial chat">
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <Skeleton className="mx-auto h-14 w-14 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-6 w-56 max-w-full rounded" />
          <Skeleton className="mx-auto mt-3 h-4 w-72 max-w-full rounded" />
          <div className="mt-8 space-y-6">
            <ChatMessageSkeleton role="user" width="40%" />
            <ChatMessageSkeleton role="assistant" lines={3} />
          </div>
        </div>
      </div>
      <ComposerSkeleton />
    </div>
  );
}
