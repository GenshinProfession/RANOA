"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { AppearanceSettings } from "./AppearanceSettings";
import { SyncSettings } from "./SyncSettings";
import { useI18n } from "@/hooks/useI18n";
import { PRODUCT_NAME } from "@/lib/branding";

type SettingsSection = "general" | "appearance" | "sync" | "models" | "skills" | "plugins";

interface SettingsHubProps {
  cwd: string | null;
  sessionId: string | null;
  onClose: () => void;
  onModelsChanged: () => void;
  onPluginsReloaded: () => void;
}

const sectionIcons: Record<SettingsSection, ReactNode> = {
  general: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  appearance: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  sync: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 18.5a5.5 5.5 0 1 1 1.9-10.66A6.5 6.5 0 0 1 21 10.5a4 4 0 0 1-1 7.9H7Z" /><path d="M12 10v6M9.5 13.5h5" />
    </svg>
  ),
  models: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9L12 3Z" /><circle cx="12" cy="12" r="2.7" />
      <path d="M12 5.7v3.6M17.4 9l-3.1 1.8M17.4 15l-3.1-1.8M12 18.3v-3.6M6.6 15l3.1-1.8M6.6 9l3.1 1.8" />
    </svg>
  ),
  skills: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 8 4.3-8 4.3-8-4.3L12 3Z" /><path d="m4 12 8 4.3 8-4.3" /><path d="m4 16.7 8 4.3 8-4.3" />
    </svg>
  ),
  plugins: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 8V4M16 8V4M6 8h12v4a6 6 0 0 1-12 0V8Z" /><path d="M12 18v3" /><path d="M9 12h6" />
    </svg>
  ),
};

export function SettingsHub({ cwd, sessionId, onClose, onModelsChanged, onPluginsReloaded }: SettingsHubProps) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const sections: Array<{ id: SettingsSection; label: string; description: string; disabled: boolean }> = [
    { id: "general", label: t("settings.general"), description: t("settings.generalDescription"), disabled: false },
    { id: "appearance", label: t("settings.appearance"), description: t("settings.appearanceDescription"), disabled: false },
    { id: "sync", label: t("settings.sync"), description: t("settings.syncDescription"), disabled: false },
    { id: "models", label: t("common.models"), description: t("settings.modelsDescription"), disabled: false },
    { id: "skills", label: t("common.skills"), description: t("settings.skillsDescription"), disabled: !cwd },
    { id: "plugins", label: t("common.plugins"), description: t("settings.pluginsDescription"), disabled: !cwd },
  ];
  const active = sections.find((section) => section.id === activeSection) ?? sections[0];

  return (
    <div className="settings-hub-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-hub-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="settings-hub-shell">
        <aside className="settings-hub-nav" aria-label={t("settings.title")}>
          <div className="settings-hub-brand">
            <span className="settings-hub-brand-mark" aria-hidden="true">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
              </svg>
            </span>
            <span>
              <strong id="settings-hub-title">{t("settings.title")}</strong>
              <small>{t("settings.subtitle")}</small>
            </span>
          </div>
          <div className="settings-hub-group-label">{t("settings.capabilities")}</div>
          <nav className="settings-hub-tree">
            {sections.map((section) => (
              <button
                type="button"
                key={section.id}
                className={`settings-hub-tree-item${activeSection === section.id ? " is-active" : ""}`}
                onClick={() => setActiveSection(section.id)}
                disabled={section.disabled}
                aria-current={activeSection === section.id ? "page" : undefined}
              >
                <span className="settings-hub-tree-rail" aria-hidden="true" />
                <span className="settings-hub-tree-icon">{sectionIcons[section.id]}</span>
                <span className="settings-hub-tree-copy">
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </span>
                <svg className="settings-hub-tree-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            ))}
          </nav>
          {!cwd && <p className="settings-hub-workspace-note">{t("settings.noWorkspace")}</p>}
        </aside>

        <section className="settings-hub-main">
          <header className="settings-hub-header">
            <div>
              <span className="settings-hub-eyebrow">{PRODUCT_NAME} / {t("settings.title")}</span>
              <h2>{active.label}</h2>
              <p>{active.description}</p>
            </div>
            <button type="button" className="settings-hub-close" onClick={onClose} aria-label={t("sidebar.cancel")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <div className="settings-hub-content">
            <div key={activeSection} className="settings-hub-section-stage">
              {activeSection === "general" && (
                <div className="settings-language-panel">
                  <div className="settings-language-heading">
                    <span className="settings-language-emblem" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                      </svg>
                    </span>
                    <span>
                      <strong>{t("settings.interfaceLanguage")}</strong>
                      <small>{t("settings.interfaceLanguageDescription")}</small>
                    </span>
                  </div>
                  <div className="settings-language-grid" role="radiogroup" aria-label={t("settings.interfaceLanguage")}>
                    {supportedLocales
                      .filter((plugin) => plugin.id === "zh-CN" || plugin.id === "en")
                      .map((plugin) => {
                        const activeLocale = locale === plugin.id;
                        return (
                          <button
                            key={plugin.id}
                            type="button"
                            role="radio"
                            aria-checked={activeLocale}
                            className={`settings-language-card${activeLocale ? " is-active" : ""}`}
                            onClick={() => setLocale(plugin.id as typeof locale)}
                          >
                            <span className="settings-language-code">{plugin.id === "zh-CN" ? "中" : "EN"}</span>
                            <span className="settings-language-copy">
                              <strong>{plugin.id === "zh-CN" ? t("settings.languageChinese") : t("settings.languageEnglish")}</strong>
                              <small>{plugin.label}</small>
                            </span>
                            <span className="settings-language-check" aria-hidden="true">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
              {activeSection === "appearance" && <AppearanceSettings />}
              {activeSection === "sync" && <SyncSettings />}
              {activeSection === "models" && (
                <ModelsConfig embedded onClose={() => { onModelsChanged(); onClose(); }} />
              )}
              {activeSection === "skills" && cwd && (
                <SkillsConfig embedded cwd={cwd} onClose={onClose} />
              )}
              {activeSection === "plugins" && cwd && (
                <PluginsConfig embedded cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onPluginsReloaded} />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
