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
