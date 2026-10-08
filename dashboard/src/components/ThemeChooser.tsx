/**
 * Theme chooser: Night, Day, and Follow System as three named, previewed
 * options.
 *
 * ── Why not the old sun/moon toggle ────────────────────────────────────────
 * A two-state toggle can express "light" and "dark" but not "follow the OS",
 * which is a real preference the palette system supports. It also gives no
 * preview: the operator had to apply a theme to see whether they wanted it.
 * These options show a thumbnail of each palette and mark the active choice
 * with `aria-pressed`, so the state is announced rather than implied by an
 * icon swap.
 *
 * The thumbnails are the generator's own `theme-night-thumbnail` and
 * `theme-day-thumbnail` crops; the "follow system" option reuses the two side
 * by side, which is what following the system actually looks like.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  applyConsoleTheme,
  readConsoleTheme,
  subscribeToOSTheme,
  writeConsoleTheme,
  type ConsoleThemeChoice,
} from "../shared/theme";
import { useLocale, useT } from "../shared/locale-context";
import { LOCALE_LABELS, LOCALES, type MessageKey } from "../shared/i18n";
import { toast } from "../shared/toast";
import { RikkaArt } from "./rikka/RikkaArt";
import { useModalFocus } from "../hooks/use-modal-focus";

interface ThemeOption {
  readonly choice: ConsoleThemeChoice;
  readonly labelKey: MessageKey;
  readonly icon: typeof Moon;
  readonly hintKey?: MessageKey;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { choice: "system", labelKey: "theme.system", icon: Monitor, hintKey: "theme.systemHint" },
  { choice: "dark", labelKey: "theme.night", icon: Moon },
  { choice: "light", labelKey: "theme.day", icon: Sun },
];

export function ThemeChooser(): ReactNode {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ConsoleThemeChoice>(() => readConsoleTheme());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus({ open, mounted: open, panelRef, onClose: () => setOpen(false) });

  // The applied attribute is the resolved palette; the stored choice is what
  // this popover marks. Re-applying on mount keeps the two in step after a
  // hot reload or a storage edit from devtools.
  useEffect(() => {
    applyConsoleTheme(choice);
  }, [choice]);

  // A `system` operator must see the palette change when the OS flips, and
  // every other tab must see a choice made here.
  useEffect(() => {
    if (choice !== "system") return;
    return subscribeToOSTheme(() => applyConsoleTheme("system"));
  }, [choice]);

  useEffect(() => {
    const resync = () => setChoice(readConsoleTheme());
    window.addEventListener("storage", resync);
    return () => window.removeEventListener("storage", resync);
  }, []);

  const select = useCallback(
    (next: ConsoleThemeChoice) => {
      setChoice(next);
      writeConsoleTheme(next);
      const option = THEME_OPTIONS.find((candidate) => candidate.choice === next);
      if (option) toast.success(t("theme.applied", { name: t(option.labelKey) }));
      setOpen(false);
    },
    [t],
  );

  const current = THEME_OPTIONS.find((option) => option.choice === choice) ?? THEME_OPTIONS[0];
  const CurrentIcon = current?.icon ?? Moon;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        className="topbar-icon-button"
        aria-label={t("theme.choose")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title={t("theme.choose")}
      >
        <CurrentIcon size={17} />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="false"
              aria-label={t("theme.choose")}
              className="theme-popover popout-enter"
              tabIndex={-1}
            >
              <p className="theme-popover-title">{t("theme.label")}</p>
              <div className="theme-options">
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = option.choice === choice;
                  return (
                    <button
                      key={option.choice}
                      type="button"
                      className="theme-option"
                      aria-pressed={selected}
                      onClick={() => select(option.choice)}
                    >
                      <span className="theme-option-swatch" aria-hidden="true">
                        {option.choice === "system" ? (
                          <span style={{ display: "flex", height: "100%" }}>
                            <RikkaArt
                              name="theme-night-thumbnail"
                              width="50%"
                              height="100%"
                              radius="0"
                            />
                            <RikkaArt
                              name="theme-day-thumbnail"
                              width="50%"
                              height="100%"
                              radius="0"
                            />
                          </span>
                        ) : (
                          <RikkaArt
                            name={
                              option.choice === "dark"
                                ? "theme-night-thumbnail"
                                : "theme-day-thumbnail"
                            }
                            width="100%"
                            height="100%"
                            radius="0"
                          />
                        )}
                      </span>
                      <span className="theme-option-text">
                        <span className="theme-option-name">
                          <Icon size={12} aria-hidden="true" style={{ marginRight: 5 }} />
                          {t(option.labelKey)}
                        </span>
                        {option.hintKey ? (
                          <span className="theme-option-hint">{t(option.hintKey)}</span>
                        ) : null}
                      </span>
                      {selected ? (
                        <Check size={14} aria-hidden="true" style={{ marginLeft: "auto" }} />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="language-options" role="group" aria-label={t("language.choose")}>
                {LOCALES.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="language-option"
                    aria-pressed={locale === tag}
                    onClick={() => {
                      setLocale(tag);
                      toast.success(t("language.applied", { name: LOCALE_LABELS[tag] }));
                    }}
                  >
                    {LOCALE_LABELS[tag]}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
