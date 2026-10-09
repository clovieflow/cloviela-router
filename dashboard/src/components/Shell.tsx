import {
  Activity,
  Bell,
  BookOpen,
  Clock,
  Cpu,
  FlaskConical,
  Globe,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Rocket,
  Route,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldAlert,
  ScrollText,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { usePresence } from "../hooks/use-presence";
import { useModalFocus } from "../hooks/use-modal-focus";
import { resolveConsoleTheme, subscribeToOSTheme, readConsoleTheme } from "../shared/theme";
import { useT } from "../shared/locale-context";
import { ThemeChooser } from "./ThemeChooser";
import { AmbientArt, AvatarArt } from "./rikka/art-surfaces";
import { RikkaArt } from "./rikka/RikkaArt";
import type { MessageKey } from "../shared/i18n";
import { consoleRequest } from "../data/api";
import { queryClient } from "../data/query-client";
import { prefetchRouteIntent } from "../data/route-prefetch";
import { usePullToRefresh } from "../hooks/use-pull-to-refresh";
import { useSystemHealth } from "../hooks/system";
import { useProviders } from "../hooks/providers";
import { DASHBOARD_RELEASE_LABEL } from "../shared/version";
import type { SessionUser } from "../data/contracts";
import { formatUptime } from "../shared/format";

interface NavItemDef {
  /** Message key, not a literal: the shell renders in the operator's locale. */
  readonly labelKey: MessageKey;
  readonly path: string;
  readonly icon: LucideIcon;
  readonly badge?: string;
}

interface NavGroupDef {
  readonly labelKey: MessageKey;
  readonly items: readonly NavItemDef[];
}

/**
 * Console navigation.
 *
 * ── Why the grouping changed ────────────────────────────────────────────────
 * The previous list mixed a *catalog* (Providers), a *task* (Model Lab) and an
 * *implementation detail* (Combos & Routes) in one "Main" column, and buried
 * the operational screens an operator actually needs during an incident
 * (Health, Logs) behind a "System" heading that read as settings-adjacent.
 *
 * The order below follows the operator's actual journey: set up → observe →
 * configure → investigate. Every entry points at a real, working route; the
 * legacy pages keep their own paths and are all still reachable.
 */
export const navigationGroups: readonly NavGroupDef[] = [
  {
    labelKey: "nav.group.main",
    items: [
      { labelKey: "nav.overview", path: "/", icon: LayoutDashboard },
      { labelKey: "nav.onboarding", path: "/onboarding", icon: Rocket },
      { labelKey: "nav.health", path: "/health", icon: Activity },
      { labelKey: "nav.usage", path: "/usage", icon: Timer },
      { labelKey: "nav.logs", path: "/console-log", icon: ScrollText },
    ],
  },
  {
    labelKey: "nav.group.control",
    items: [
      { labelKey: "nav.providers", path: "/providers", icon: Server },
      { labelKey: "nav.models", path: "/models", icon: Cpu },
      { labelKey: "nav.routing", path: "/combos", icon: Network },
      { labelKey: "nav.simulator", path: "/simulator", icon: Route },
      { labelKey: "nav.quota", path: "/quota", icon: ShieldAlert },
    ],
  },
  {
    labelKey: "nav.group.system",
    items: [
      { labelKey: "nav.apiKeys", path: "/api-keys", icon: KeyRound },
      { labelKey: "nav.networks", path: "/proxy", icon: Globe },
      { labelKey: "nav.studio", path: "/model-lab", icon: FlaskConical },
      { labelKey: "nav.help", path: "/help", icon: BookOpen },
      { labelKey: "nav.settings", path: "/settings", icon: SettingsIcon },
      { labelKey: "nav.about", path: "/about", icon: Info },
    ],
  },
];


/**
 * Topbar title/subtitle per route.
 *
 * Titles are message keys so the shell renders in the operator's locale. The
 * legacy pages keep their own upstream titles: renaming them here would make
 * the header disagree with the page body, which is worse than an English
 * heading above an English page.
 */
const titlesMap: Record<string, { title: MessageKey; sub: MessageKey }> = {
  "/": { title: "overview.title", sub: "overview.subtitle" },
  "/onboarding": { title: "onboarding.title", sub: "onboarding.subtitle" },
  "/health": { title: "health.title", sub: "health.subtitle" },
  "/usage": { title: "nav.usage", sub: "health.subtitle" },
  "/providers": { title: "nav.providers", sub: "models.subtitle" },
  "/models": { title: "models.title", sub: "models.subtitle" },
  "/combos": { title: "routing.title", sub: "routing.subtitle" },
  "/simulator": { title: "simulator.title", sub: "simulator.subtitle" },
  "/quota": { title: "nav.quota", sub: "health.storage" },
  "/proxy": { title: "nav.networks", sub: "health.connectivity" },
  "/api-keys": { title: "nav.apiKeys", sub: "models.aliasSectionHint" },
  "/console-log": { title: "nav.logs", sub: "health.gateway" },
  "/model-lab": { title: "nav.studio", sub: "help.clients" },
  "/cli-tools": { title: "nav.more", sub: "help.quickstartHint" },
  "/help": { title: "help.title", sub: "help.subtitle" },
  "/about": { title: "about.title", sub: "about.subtitle" },
  "/settings": { title: "nav.settings", sub: "about.localization" },
};

const CONSOLE_FALLBACK: { title: MessageKey; sub: MessageKey } = {
  title: "nav.overview",
  sub: "overview.subtitle",
};

/**
 * Resolves the topbar title/subtitle for a pathname.
 *
 * The two parameterized routes (`/providers/:providerId`, `/cli-tools/:toolId`)
 * carry their subject in the path, so a flat `titlesMap` lookup would drop them
 * onto the generic console fallback. They are matched by pattern instead.
 */
function resolveRouteMeta(
  pathname: string,
  providers: readonly { readonly providerId: string; readonly displayName: string; readonly label?: string }[],
  t: (key: MessageKey) => string,
): { title: string; sub: string } {
  const providerMatch = /^\/providers\/([^/]+)\/?$/.exec(pathname);
  if (providerMatch?.[1]) {
    const provider = providers.find((candidate) => candidate.providerId === providerMatch[1]);
    return {
      // A provider's own display name is data, not chrome: it is rendered as-is
      // in every locale, exactly as the catalog reports it.
      title: provider?.label || provider?.displayName || providerMatch[1],
      sub: t("nav.providers"),
    };
  }
  const toolMatch = /^\/cli-tools\/([^/]+)\/?$/.exec(pathname);
  if (toolMatch?.[1]) {
    return {
      title: toolMatch[1],
      sub: t("help.quickstartHint"),
    };
  }
  const meta = titlesMap[pathname] ?? CONSOLE_FALLBACK;
  return { title: t(meta.title), sub: t(meta.sub) };
}

function useSafeSystemHealth() {
  try {
    return useSystemHealth();
  } catch {
    return { data: undefined, isError: false, isFetching: false, isPending: false };
  }
}

function NotificationsPopover({ isHealthy }: { isHealthy: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        className="topbar-icon-button"
        aria-label={t("nav.commandPalette")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} />
      </button>
      {open
        ? createPortal(
            <div
              ref={contentRef}
              role="dialog"
              aria-label={t("nav.commandPalette")}
              className="popout-enter glass"
              style={{
                position: "fixed",
                zIndex: 60,
                top: "64px",
                right: "16px",
                width: "min(340px, calc(100vw - 32px))",
                borderRadius: "20px",
                padding: "16px",
                boxShadow: "var(--shadow-popout)",
                border: "1px solid var(--inner-border)",
                background: "var(--popover-bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontWeight: 700,
                    fontSize: "14px",
                  }}
                >
                  <span
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "999px",
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Bell size={13} />
                  </span>
                  <span>{t("nav.commandPalette")}</span>
                </div>
                <button
                  type="button"
                  aria-label={t("action.close")}
                  onClick={() => setOpen(false)}
                  style={{ fontSize: "12px", color: "var(--text-tertiary)", background: "transparent", border: "none", cursor: "pointer", padding: "4px" }}
                >
                  <X size={14} />
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "14px",
                    border: "1px solid var(--inner-border)",
                    background: "var(--surface-2)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "12.5px" }}>
                      {isHealthy ? t("health.status.healthy") : t("health.status.degraded")}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                      {isHealthy ? t("health.readinessReady") : t("state.offline")}
                    </p>
                  </div>
                </div>
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "14px",
                    border: "1px solid var(--accent-soft)",
                    background: "var(--accent-soft)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                  }}
                >
                  <Rocket
                    size={16}
                    style={{ color: "var(--accent)", marginTop: "2px", flexShrink: 0 }}
                  />
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "12.5px", color: "var(--accent)" }}>
                      {DASHBOARD_RELEASE_LABEL}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                      {t("overview.subtitle")}
                    </p>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function CommandPalette({ open, close }: { readonly open: boolean; readonly close: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => navigationGroups.flatMap((group) => group.items), []);
  const filtered = items.filter((item) => t(item.labelKey).toLowerCase().includes(query.toLowerCase()));

  const { mounted, closing } = usePresence(open);
  // Shared modal focus contract: initial focus, Tab containment, opener
  // restore, and Escape handling.
  useModalFocus({ open, mounted, panelRef, onClose: close });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlighted option scrolled into view during keyboard travel.
  useEffect(() => {
    if (!mounted) return;
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, mounted]);

  if (!mounted) return null;

  const clampedIndex =
    filtered.length === 0 ? 0 : Math.min(Math.max(activeIndex, 0), filtered.length - 1);

  const activate = (index: number) => {
    const item = filtered[index];
    if (!item) return;
    navigate(item.path);
    close();
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(filtered.length === 0 ? 0 : (clampedIndex + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        filtered.length === 0 ? 0 : (clampedIndex - 1 + filtered.length) % filtered.length,
      );
    } else if (event.key === "Enter") {
      activate(clampedIndex);
    }
  };
  return createPortal(
    <div
      className={`dialog-overlay${closing ? " closing" : ""}`}
      role="presentation"
      onMouseDown={close}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`dialog-panel card-solid${closing ? " closing" : ""}`}
        style={{
          width: "min(540px, calc(100vw - 32px))",
          borderRadius: "20px",
          overflow: "hidden",
          boxShadow: "var(--shadow-popout)",
          background: "var(--surface-1)",
          border: "1px solid var(--inner-border)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            borderBottom: "1px solid var(--inner-border)",
          }}
        >
          <Search size={16} style={{ color: "var(--text-tertiary)" }} />
          <h2
            id="palette-title"
            style={{
              position: "absolute",
              width: "1px",
              height: "1px",
              padding: 0,
              margin: "-1px",
              overflow: "hidden",
              clip: "rect(0, 0, 0, 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            Command palette
          </h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t("nav.searchPages")}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-listbox"
            aria-activedescendant={
              filtered.length === 0 ? undefined : `command-palette-option-${clampedIndex}`
            }
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "14px",
              color: "var(--text-primary)",
            }}
          />
          <kbd
            style={{
              fontSize: "10px",
              padding: "2px 6px",
              borderRadius: "6px",
              background: "var(--hover)",
              border: "1px solid var(--inner-border)",
              color: "var(--text-tertiary)",
            }}
          >
            ESC
          </kbd>
        </div>
        <div
          ref={listRef}
          id="command-palette-listbox"
          role="listbox"
          aria-label="Pages"
          style={{ maxHeight: "320px", overflowY: "auto", padding: "8px" }}
        >
          {filtered.map((item, index) => (
            <button
              key={item.path}
              id={`command-palette-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === clampedIndex}
              tabIndex={-1}
              onClick={() => activate(index)}
              onMouseEnter={() => setActiveIndex(index)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary)",
                textAlign: "left",
                transition: "background-color var(--dur-micro) var(--ease-spring)",
                backgroundColor: index === clampedIndex ? "var(--hover)" : "transparent",
              }}
            >
              <item.icon size={16} style={{ color: "var(--text-secondary)" }} />
              <span style={{ flex: 1 }}>{t(item.labelKey)}</span>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>↵</span>
            </button>
          ))}
          {filtered.length === 0 ? (
            <p
              style={{
                padding: "16px",
                textAlign: "center",
                fontSize: "12.5px",
                color: "var(--text-tertiary)",
              }}
            >
              {t("nav.noMatches")}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SidebarNavGroup({
  group,
  pathname,
  onIntent,
}: {
  readonly group: NavGroupDef;
  readonly pathname: string;
  readonly onIntent: (path: string) => void;
}): ReactNode {
  const t = useT();
  return (
    <div className="nav-group-section">
      <p className="nav-group-title">{t(group.labelKey)}</p>
      <SidebarNavList items={group.items} pathname={pathname} onIntent={onIntent} />
    </div>
  );
}

function SidebarNavList({
  items,
  pathname,
  onIntent,
}: {
  readonly items: readonly NavItemDef[];
  readonly pathname: string;
  readonly onIntent: (path: string) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0, opacity: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!active) {
      setIndicator((s) => ({ ...s, opacity: 0 }));
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    setIndicator({
      top: activeRect.top - containerRect.top,
      height: activeRect.height,
      opacity: 1,
    });
  }, [pathname, items]);

  return (
    <div ref={containerRef} className="nav-items-container">
      <div
        className="sidebar-active-indicator"
        style={{
          transform: `translateY(${indicator.top}px)`,
          height: `${indicator.height}px`,
          opacity: indicator.opacity,
        }}
        aria-hidden="true"
      />
      {items.map((item) => {
        const isActive =
          item.path === "/"
            ? pathname === "/"
            : pathname === item.path || pathname.startsWith(`${item.path}/`);
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            data-active={isActive ? "true" : undefined}
            className={`nav-link-item ${isActive ? "active" : ""}`}
            onMouseEnter={() => onIntent(item.path)}
            onFocus={() => onIntent(item.path)}
          >
            <item.icon size={17} className="nav-link-icon" />
            <span>{t(item.labelKey)}</span>
            {item.badge ? <span className="nav-link-badge">{item.badge}</span> : null}
          </NavLink>
        );
      })}
    </div>
  );
}

function FooterClock() {
  const t = useT();
  const healthQuery = useSafeSystemHealth();
  const [now, setNow] = useState(() => new Date());
  const location = useLocation();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isHealthy = healthQuery.data?.status === "healthy";
  const isError = healthQuery.isError;
  const uptimeSeconds = healthQuery.data?.uptime_seconds;
  // Immersive pages (Model Lab) hide the ops status pill — a chatbot
  // surface should not narrate gateway health at the user.
  const hideStatus = location.pathname === "/model-lab";

  const fmt = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false });
  const fmtLocal = (d: Date) => d.toLocaleTimeString("en-GB", { hour12: false });

  return (
    <footer className="glass app-footer">
      {/* Row 1 Left (atas1): Status — hidden on immersive pages */}
      {!hideStatus ? (
        <div className="footer-status-pill">
          <span>
            {isError
              ? t("state.offline")
              : isHealthy
                ? t("health.status.healthy")
                : t("state.loading")}
          </span>
        </div>
      ) : null}

      {/* Row 1 Right (kanan3): UTC Time */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}
        title="UTC time"
      >
        <Globe size={13} style={{ color: "var(--text-tertiary)" }} />
        <span>{fmt(now)} UTC</span>
      </div>

      {/* Row 2 Left (atas2): System local time */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }} title="Server system time">
        <Clock size={13} style={{ color: "var(--text-tertiary)" }} />
        <span>{fmtLocal(now)} system</span>
      </div>

      {/* Row 2 Right (kanan4): Uptime */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}
        title="Gateway Uptime"
      >
        <Timer size={13} style={{ color: "var(--text-tertiary)" }} />
        <span>uptime {formatUptime(uptimeSeconds)}</span>
      </div>
    </footer>
  );
}

export function DashboardShell({
  user,
  children,
}: {
  readonly user: SessionUser;
  readonly children: ReactNode;
}): ReactNode {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const healthQuery = useSafeSystemHealth();
  const providersQuery = useProviders();
  const drawerPresence = usePresence(drawerOpen);
  const pull = usePullToRefresh(() => queryClient.invalidateQueries());

  const isHealthy = healthQuery.data?.status === "healthy";
  const prefetchIntent = (path: string): void => {
    void prefetchRouteIntent(queryClient, path);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // Escape closes the navigation drawer. The scrim handles a tap, but a
      // keyboard or a hardware Escape key had no way out: the drawer stayed
      // open and `body` stayed scroll-locked, which left the page unusable
      // until a link was followed.
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // The app scrolls inside `.app-main-column`, not the document, so React
  // Router's window-based restoration never applies and the previous page's
  // offset carried into the next one — landing on a provider detail already
  // scrolled past its header, for example.
  //
  // Reuses the pull hook's ref rather than re-querying the column, so the
  // selector stays in one place. That ref is assigned in the hook's own effect;
  // on the very first commit this layout effect runs before it, but a fresh
  // load already starts at the top, and `DashboardShell` stays mounted across
  // route changes, so every navigation this must correct has it set.
  // Layout timing (not `useEffect`) because a post-paint reset would show the
  // stale offset for one frame.
  useLayoutEffect(() => {
    const scroller = pull.scrollerRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [location.pathname, pull.scrollerRef]);
  const logout = async () => {
    setLoggingOut(true);
    try {
      await consoleRequest<void>("/auth/logout", { method: "POST" });
    } finally {
      // Drop every cached tenant view before leaving so the next login
      // never renders the previous tenant's data.
      queryClient.clear();
      navigate("/login", { replace: true });
    }
  };

  const meta = resolveRouteMeta(location.pathname, providersQuery.data ?? [], t);
  // The ambient scene follows the *applied* palette, so a `system` operator
  // sees the night scene at night. `data-theme` is the resolved value written
  // by `theme.ts`, which makes it the one attribute both this read and the
  // stylesheet agree on.
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
    () => resolveConsoleTheme(readConsoleTheme()),
  );
  useEffect(() => {
    const sync = () => setResolvedTheme(resolveConsoleTheme(readConsoleTheme()));
    const unsubscribe = subscribeToOSTheme(sync);
    window.addEventListener("storage", sync);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", sync);
    };
  }, []);
  return (
    <>
      <div className="app-bg-image" aria-hidden="true" />
      <div className="app-bg" aria-hidden="true" />
      <AmbientArt theme={resolvedTheme} />
      <div className="app-shell-root">
        {drawerPresence.mounted && (
          <button
            type="button"
            aria-label={t("nav.close")}
            className={`mobile-scrim${drawerPresence.closing ? " closing" : ""}`}
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/* Sidebar Rail */}
        <aside
          className={`glass app-sidebar ${drawerOpen ? "is-open" : ""}`}
          aria-label={t("nav.open")}
        >
          <div className="brand-header">
            <div className="brand-icon" aria-hidden="true" style={{ overflow: "hidden", padding: 0 }}>
              <RikkaArt name="app-icon" width="100%" height="100%" radius="0" priority />
            </div>
            <div className="brand-meta">
              <div className="brand-name">
                <span>Cloviela Router</span>
              </div>
              <div className="brand-version-badge">
                <span>{DASHBOARD_RELEASE_LABEL}</span>
              </div>
            </div>
          </div>

          <nav style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {navigationGroups.map((group) => (
              <SidebarNavGroup
                key={group.labelKey}
                group={group}
                pathname={location.pathname}
                onIntent={prefetchIntent}
              />
            ))}
          </nav>

          {/* User Card */}
          <div className="sidebar-user-card">
            <div className="user-card-content">
              <AvatarArt
                name="avatar"
                size={30}
                fallbackText={(user.displayName ?? user.email).slice(0, 2).toUpperCase()}
              />
              <div className="user-info">
                <p className="user-name">{user.displayName || "Admin"}</p>
                <p className="user-role">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={loggingOut}
                aria-label={t("nav.signOut")}
                title={t("nav.signOut")}
                className="topbar-icon-button user-logout-button"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Column */}
        <div className="app-main-column" ref={pull.scrollerRef as React.RefObject<HTMLDivElement>}>
          <div
            aria-hidden={pull.pullPx === 0 && !pull.refreshing}
            style={{
              height: `${pull.refreshing ? 44 : pull.pullPx}px`,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              color: "var(--text-tertiary)",
              transition: pull.pullPx === 0 && !pull.refreshing ? "height 180ms ease" : undefined,
            }}
          >
            {pull.refreshing ? t("action.refreshing") : pull.pullPx > 0 ? t("action.refresh") : ""}
          </div>
          {/* Topbar Header */}
          <header className="glass app-topbar">
            <button
              type="button"
              aria-label={t("nav.open")}
              className="topbar-menu-btn"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={18} />
            </button>
            <div className="topbar-meta">
              <h1 className="topbar-title">{meta.title}</h1>
              <p className="topbar-subtitle">{meta.sub}</p>
            </div>

            <div className="topbar-actions">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="topbar-button"
                aria-label={t("nav.commandPalette")}
              >
                <Search size={14} />
                <span>{t("nav.commandPalette")}</span>
                <kbd
                  style={{
                    fontSize: "10px",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    background: "var(--surface-1)",
                    border: "1px solid var(--inner-border)",
                  }}
                >
                  ⌘K
                </kbd>
              </button>
              <ThemeChooser />
              <NotificationsPopover isHealthy={Boolean(isHealthy)} />
            </div>
          </header>

          {/* Content Outlet */}
          <main
            className="route-enter"
            style={{
              flex: "1 0 auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {children}
          </main>

          {/* Footer Taskbar Clock — hidden on immersive pages */}
          {location.pathname !== "/model-lab" ? (
            <div
              style={{ marginTop: "auto", paddingTop: "12px", paddingBottom: "8px", width: "100%" }}
            >
              <FooterClock />
            </div>
          ) : null}
        </div>
      </div>
      <CommandPalette open={paletteOpen} close={() => setPaletteOpen(false)} />
    </>
  );
}
