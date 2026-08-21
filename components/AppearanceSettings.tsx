"use client";

import type { CSSProperties } from "react";
import { WALLPAPER_PRESETS, useWallpaperTheme } from "@/hooks/useWallpaperTheme";
import { useDesktopPet } from "@/hooks/useDesktopPet";
import { useI18n } from "@/hooks/useI18n";

export function AppearanceSettings() {
  const { t } = useI18n();
  const { wallpaper, setWallpaper } = useWallpaperTheme();
  const { enabled, desktopAvailable, setEnabled } = useDesktopPet();
  const selectedPreset = WALLPAPER_PRESETS.find((preset) => preset.id === wallpaper) ?? WALLPAPER_PRESETS[0];

  return (
    <div className="appearance-settings">
      <section className="appearance-intro">
        <div className="appearance-intro-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
          </svg>
        </div>
        <div>
          <span className="appearance-kicker">AMBIENT COLOR ENGINE</span>
          <h3>{t("appearance.smartColor")}</h3>
          <p>{t("appearance.smartColorDescription")}</p>
        </div>
        <span className="appearance-auto-badge"><i />{t("appearance.enabled")}</span>
      </section>

      {desktopAvailable && (
        <section className={`appearance-companion-card${enabled ? " is-enabled" : ""}`}>
          <span
            className="appearance-companion-portrait"
            style={{ backgroundImage: `url(${selectedPreset.companionImage})` }}
            aria-hidden="true"
          >
            <i />
          </span>
          <span className="appearance-companion-copy">
            <span className="appearance-kicker">DESKTOP FAMILIAR</span>
            <strong>{t("appearance.companion")}</strong>
            <small>{t("appearance.companionDescription")}</small>
          </span>
          <button
            type="button"
            className="appearance-companion-switch"
            role="switch"
            aria-checked={enabled}
            aria-label={t("appearance.companion")}
            onClick={() => setEnabled(!enabled)}
          >
            <span>{enabled ? t("appearance.companionOn") : t("appearance.companionOff")}</span>
            <i aria-hidden="true"><b /></i>
          </button>
        </section>
      )}

      <div className="appearance-section-heading">
        <div>
          <h3>{t("appearance.wallpaper")}</h3>
          <p>{t("appearance.wallpaperDescription")}</p>
        </div>
        <span>{WALLPAPER_PRESETS.length} PRESETS</span>
      </div>

      <div className="appearance-wallpaper-grid">
        {WALLPAPER_PRESETS.map((preset, index) => {
          const selected = wallpaper === preset.id;
          return (
            <button
              type="button"
              key={preset.id}
              className={`appearance-wallpaper-card${selected ? " is-selected" : ""}`}
              style={{ "--appearance-index": index } as CSSProperties}
              onClick={(event) => {
                setWallpaper(preset.id, { x: event.clientX, y: event.clientY });
              }}
              aria-pressed={selected}
            >
              <span className="appearance-wallpaper-preview" style={{ backgroundImage: `url(${preset.image})` }}>
                <span className="appearance-wallpaper-vignette" />
                {selected && (
                  <span className="appearance-wallpaper-check" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
                  </span>
                )}
              </span>
              <span className="appearance-wallpaper-meta">
                <span>
                  <strong>{t(preset.nameKey)}</strong>
                  <small>{t(preset.descriptionKey)}</small>
                </span>
                <span className="appearance-swatches" aria-label={t(preset.paletteKey)}>
                  {preset.swatches.map((color) => <i key={color} style={{ background: color }} />)}
                </span>
              </span>
              <span className="appearance-palette-name">{t(preset.paletteKey)}</span>
            </button>
          );
        })}
      </div>

      <section className="appearance-mode-note">
        <span aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" /></svg>
        </span>
        <div><strong>{t("appearance.darkFirst")}</strong><small>{t("appearance.darkFirstDescription")}</small></div>
      </section>
    </div>
  );
}
