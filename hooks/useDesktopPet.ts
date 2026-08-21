"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "ranoa-desktop-pet-enabled";
const listeners = new Set<() => void>();
let currentEnabled: boolean | null = null;

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function applyVisibility(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const pet = window.ranoaDesktop?.pet;
  if (!pet) return;
  void (enabled ? pet.show() : pet.hide()).catch(() => {
    // Desktop companion availability must never interrupt the web interface.
  });
}

function ensurePreference(): boolean {
  if (typeof window === "undefined") return true;
  if (currentEnabled !== null) return currentEnabled;
  currentEnabled = readStoredPreference();
  applyVisibility(currentEnabled);
  return currentEnabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensurePreference();
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return ensurePreference();
}

function getServerSnapshot(): boolean {
  return true;
}

export function useDesktopPet() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [desktopAvailable, setDesktopAvailable] = useState(false);

  useEffect(() => {
    const available = Boolean(window.ranoaDesktop?.pet);
    setDesktopAvailable(available);
    if (available) applyVisibility(enabled);
  }, [enabled]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    currentEnabled = nextEnabled;
    try {
      localStorage.setItem(STORAGE_KEY, String(nextEnabled));
    } catch {
      // Continue with the in-memory setting when storage is unavailable.
    }
    applyVisibility(nextEnabled);
    listeners.forEach((listener) => listener());
  }, []);

  return { enabled, desktopAvailable, setEnabled };
}
