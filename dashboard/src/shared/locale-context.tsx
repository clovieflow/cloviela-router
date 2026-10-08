/**
 * React binding for the message catalogue in `shared/i18n.ts`.
 *
 * A context (rather than a module-level mutable locale) because the choice is
 * operator state: switching language must re-render exactly the mounted tree,
 * and a test that renders one screen must be able to pin a locale without
 * touching `localStorage`.
 *
 * `useT` returns the translator bound to the active locale, so a component
 * writes `t("nav.overview")` and never reaches for the locale itself.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  LOCALE_LABELS,
  readConsoleLocale,
  translate,
  writeConsoleLocale,
  type ConsoleLocale,
  type MessageKey,
} from "./i18n";

export type TranslateFn = (
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

interface LocaleContextValue {
  readonly locale: ConsoleLocale;
  readonly t: TranslateFn;
  readonly setLocale: (next: ConsoleLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({
  children,
  initialLocale,
}: {
  readonly children: ReactNode;
  /** Test seam: pins the initial locale instead of reading storage. */
  readonly initialLocale?: ConsoleLocale;
}): ReactNode {
  const [locale, setLocaleState] = useState<ConsoleLocale>(
    () => initialLocale ?? readConsoleLocale(),
  );

  const setLocale = useCallback((next: ConsoleLocale) => {
    setLocaleState(next);
    writeConsoleLocale(next);
  }, []);

  // Keep `<html lang>` honest: screen readers pick a voice from it, and a
  // document that claims English while rendering Indonesian mispronounces
  // every label.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
  }, [locale]);

  // Another tab may have changed the preference; mirror it so both tabs agree.
  useEffect(() => {
    const resync = () => setLocaleState(readConsoleLocale());
    window.addEventListener("storage", resync);
    return () => window.removeEventListener("storage", resync);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      setLocale,
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === undefined) {
    throw new Error("useLocale must be used inside a LocaleProvider");
  }
  return value;
}

/** Translator for the active locale. */
export function useT(): TranslateFn {
  return useLocale().t;
}

/** The active locale tag, for `Intl` formatters that must follow the choice. */
export function useLocaleTag(): ConsoleLocale {
  return useLocale().locale;
}

export { LOCALE_LABELS };
export type { ConsoleLocale };
