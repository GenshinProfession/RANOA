import type { ReactNode } from "react";

/**
 * The single visual surface used by both the launch state and an active chat.
 * Placement-specific layout belongs to the parent; this component never grows
 * a second card or a second theme for one of the two states.
 */
export function ChatComposerSurface({ children }: { children: ReactNode }) {
  return <div className="chat-composer-surface">{children}</div>;
}
