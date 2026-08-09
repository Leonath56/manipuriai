import { Loader2 } from "lucide-react";

export const ThinkingLoader = () => {
  return (
    <div className="flex items-center gap-3 py-2 text-neutral-500 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-neutral-600" />
      <span className="animate-pulse">Analyzing Meiteilon Context...</span>
    </div>
  );
};
