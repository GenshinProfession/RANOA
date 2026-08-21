type RanoaPetState = "idle" | "working" | "thinking" | "tool" | "done" | "error";
type RanoaPetTheme = "roxy" | "sylphiette" | "eris";
type RanoaDesktopMenuSection = "file" | "edit" | "view" | "window";

interface RanoaPetMessage {
  sessionId: string | null;
  text: string;
}

type RanoaPetActivity = RanoaPetMessage;

interface RanoaDesktopBridge {
  platform: NodeJS.Platform;
  getPathForFile(file: File): string;
  menu: {
    open(section: RanoaDesktopMenuSection, anchor: { x: number; y: number }): Promise<boolean>;
  };
  window: {
    minimize(): Promise<boolean>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<boolean>;
  };
  pet: {
    show(): Promise<void>;
    hide(): Promise<void>;
    setBubbleOpen(open: boolean): Promise<boolean>;
    startDrag(point: { x: number; y: number }): Promise<boolean>;
    moveDrag(): void;
    endDrag(): void;
    setState(state: RanoaPetState): Promise<boolean>;
    setActivity(activity: RanoaPetActivity): Promise<boolean>;
    setTheme(theme: RanoaPetTheme): Promise<boolean>;
    present(message: RanoaPetMessage): Promise<boolean>;
    reply(message: RanoaPetMessage): Promise<boolean>;
    onState(listener: (state: RanoaPetState) => void): () => void;
    onTheme(listener: (theme: RanoaPetTheme) => void): () => void;
    onMessage(listener: (message: RanoaPetMessage) => void): () => void;
    onActivity(listener: (activity: RanoaPetActivity) => void): () => void;
    onReply(listener: (message: RanoaPetMessage) => void): () => void;
  };
}

interface Window {
  ranoaDesktop?: RanoaDesktopBridge;
}
