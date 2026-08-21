"use client";

import { useCallback, useSyncExternalStore } from "react";

export type WallpaperId = "roxy" | "sylphiette" | "eris";

export interface WallpaperPreset {
  id: WallpaperId;
  image: string;
  companionImage: string;
  nameKey: string;
  descriptionKey: string;
  paletteKey: string;
  swatches: readonly [string, string, string];
}

export const WALLPAPER_PRESETS: readonly WallpaperPreset[] = [
  {
    id: "roxy",
    image: "/backgrounds/roxy-workbench.png",
    companionImage: "/ui/pets/roxy-companion.png",
    nameKey: "appearance.roxy",
    descriptionKey: "appearance.roxyDescription",
    paletteKey: "appearance.roxyPalette",
    swatches: ["#111b37", "#84baf4", "#917fd2"],
  },
  {
    id: "sylphiette",
    image: "/backgrounds/sylphiette-workbench.png",
    companionImage: "/ui/pets/sylphiette-companion.png",
    nameKey: "appearance.sylphiette",
    descriptionKey: "appearance.sylphietteDescription",
    paletteKey: "appearance.sylphiettePalette",
    swatches: ["#102b29", "#78a99b", "#d8c58f"],
  },
  {
    id: "eris",
    image: "/backgrounds/eris-workbench.png",
    companionImage: "/ui/pets/eris-companion.png",
    nameKey: "appearance.eris",
    descriptionKey: "appearance.erisDescription",
    paletteKey: "appearance.erisPalette",
    swatches: ["#321715", "#ef7657", "#e7aa52"],
  },
] as const;

const STORAGE_KEY = "nova-wallpaper";
const DEFAULT_WALLPAPER: WallpaperId = "roxy";
const listeners = new Set<() => void>();
let currentWallpaper: WallpaperId | null = null;

function isWallpaperId(value: string | null): value is WallpaperId {
  return WALLPAPER_PRESETS.some((preset) => preset.id === value);
}

function readStoredWallpaper(): WallpaperId {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isWallpaperId(value)) return value;
  } catch {
    // Ignore storage errors in private or constrained browser contexts.
  }
  return DEFAULT_WALLPAPER;
}

function applyWallpaper(id: WallpaperId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.wallpaper = id;
  void window.ranoaDesktop?.pet.setTheme(id).catch(() => {
    // The web build intentionally runs without the optional desktop bridge.
  });
}

function ensureWallpaper(): WallpaperId {
  if (typeof window === "undefined") return DEFAULT_WALLPAPER;
  if (currentWallpaper) return currentWallpaper;
  currentWallpaper = readStoredWallpaper();
  applyWallpaper(currentWallpaper);
  return currentWallpaper;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureWallpaper();
  return () => listeners.delete(listener);
}

function getSnapshot(): WallpaperId {
  return ensureWallpaper();
}

function getServerSnapshot(): WallpaperId {
  return DEFAULT_WALLPAPER;
}

function persistWallpaper(id: WallpaperId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage errors in private or constrained browser contexts.
  }
}

export function useWallpaperTheme() {
  const wallpaper = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setWallpaper = useCallback((id: WallpaperId, origin?: { x: number; y: number }) => {
    if (!isWallpaperId(id) || id === ensureWallpaper()) return;

    const apply = () => {
      currentWallpaper = id;
      persistWallpaper(id);
      applyWallpaper(id);
      emit();
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition !== "function" || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(apply);
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 620,
          easing: "cubic-bezier(0.22, 0.72, 0.18, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    }).catch(() => {});
  }, []);

  return {
    wallpaper,
    preset: WALLPAPER_PRESETS.find((preset) => preset.id === wallpaper) ?? WALLPAPER_PRESETS[0],
    setWallpaper,
  };
}
