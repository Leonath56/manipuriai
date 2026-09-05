/**
 * Keyboard shortcuts.
 *
 * One list, shared by the handler that implements them and the help sheet that
 * documents them, so the two can't drift — an undocumented shortcut is a shortcut
 * nobody uses, and a documented one that doesn't work is worse.
 *
 * Deliberately small. Every entry here is a thing people do dozens of times a
 * session; anything rarer is better left to the visible control.
 */

/** ⌘ on Apple keyboards, Ctrl everywhere else. Safe during SSR. */
export function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export function modLabel(): string {
  return isApple() ? "⌘" : "Ctrl";
}

/** True when the platform's "command" modifier is held. */
export function hasMod(e: KeyboardEvent): boolean {
  return isApple() ? e.metaKey : e.ctrlKey;
}

export type ShortcutDoc = {
  /** Rendered keys, mod already resolved for the platform. */
  keys: string[];
  label: string;
};

export function shortcutDocs(): ShortcutDoc[] {
  const mod = modLabel();
  return [
    { keys: [mod, "K"], label: "Search your conversations" },
    { keys: [mod, "Shift", "O"], label: "Start a new chat" },
    { keys: [mod, "B"], label: "Show or hide the sidebar" },
    { keys: ["Enter"], label: "Send the message" },
    { keys: ["Shift", "Enter"], label: "New line instead of sending" },
    { keys: ["Esc"], label: "Stop the reply that's generating" },
    { keys: [mod, "/"], label: "Show this list" },
  ];
}
