/**
 * Decorative Rikka artwork with real intrinsic sizing and honest failure.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * 1. **Decorative by default.** The wrapper is `aria-hidden` and the `<img>`
 *    carries an empty `alt`, so a screen reader never announces character art
 *    in the middle of an operational table. `decorative={false}` opts into a
 *    described image and then requires `alt`.
 * 2. **Never interactive.** `pointer-events: none` is set on the frame, so art
 *    can never swallow a click meant for a control beneath it. The art is
 *    positioned behind content, never over it.
 * 3. **Intrinsic size from the manifest.** `width`/`height` come from
 *    `rikka-art-manifest.ts`, which is why the box reserves its space before
 *    the bytes arrive and nothing reflows on load.
 * 4. **Lazy unless it is above the fold.** `priority` flips `loading` to eager
 *    and adds `fetchpriority="high"` for the one hero image on a page; every
 *    other illustration is `loading="lazy"` + `decoding="async"`.
 * 5. **Failure removes the decoration — it never fakes success.** A missing
 *    file unmounts the `<img>` entirely (no broken-image box), keeps the frame
 *    at its reserved aspect ratio so the layout does not move, reports once per
 *    asset to the console, and raises `onUnavailable` so a page can show a
 *    non-secret notice. There is deliberately no generated placeholder: the
 *    parent's rule is that shipped paths must exist, so a 404 is a defect to
 *    surface, not to paper over.
 *
 * Reduced motion: the optional reveal fade is CSS-driven and disabled by the
 * global `prefers-reduced-motion` rule in `console.css`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RIKKA_ART, rikkaArtUrl, type RikkaArtName } from "./rikka-art-manifest";

/** Assets already reported missing, so one 404 logs once per page load. */
const reportedMissing = new Set<RikkaArtName>();

function reportMissing(name: RikkaArtName): void {
  if (reportedMissing.has(name)) return;
  reportedMissing.add(name);
  console.warn(
    `[rikka-art] missing asset: ${name} (${RIKKA_ART[name].path}). ` +
      "The illustration was removed; nothing was substituted for it.",
  );
}

export interface RikkaArtProps {
  readonly name: RikkaArtName;
  /** Rendered width; the frame keeps the asset's aspect ratio. */
  readonly width?: number | string;
  /** Rendered height; omit to let the aspect ratio decide. */
  readonly height?: number | string;
  /** `cover` (default) fills the frame; `contain` never crops. */
  readonly fit?: "cover" | "contain";
  readonly radius?: string;
  /** CSS `object-position`, for crops that must favour one edge. */
  readonly position?: string;
  /** Above-the-fold hero: eager loading plus a high fetch priority. */
  readonly priority?: boolean;
  /**
   * `false` opts into a described image (then `alt` is required). Omitted or
   * `true` keeps the art decorative.
   */
  readonly decorative?: boolean;
  readonly alt?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Called when the asset is absent, so a page can surface a notice. */
  readonly onUnavailable?: (name: RikkaArtName) => void;
}

export function RikkaArt({
  name,
  width = "100%",
  height,
  fit = "cover",
  radius = "var(--radius-card)",
  position = "center",
  priority = false,
  decorative = true,
  alt,
  className = "",
  style,
  onUnavailable,
}: RikkaArtProps): ReactNode {
  const asset = RIKKA_ART[name];
  const [failed, setFailed] = useState(false);
  const notified = useRef(false);

  // A different asset on the same mounted frame (a theme swap) must get a
  // fresh chance to load; otherwise the previous failure would pin the frame
  // empty forever.
  useEffect(() => {
    setFailed(false);
    notified.current = false;
  }, [name]);

  const handleError = useCallback(() => {
    reportMissing(name);
    setFailed(true);
    if (!notified.current) {
      notified.current = true;
      onUnavailable?.(name);
    }
  }, [name, onUnavailable]);

  const frameStyle = useMemo<CSSProperties>(
    () => ({
      width,
      ...(height === undefined
        ? { aspectRatio: `${asset.width} / ${asset.height}` }
        : { height }),
      borderRadius: radius,
      overflow: "hidden",
      // The frame stays in the layout even when the art is gone, so removing
      // an illustration never shifts the text that was measured around it.
      pointerEvents: "none",
      ...style,
    }),
    [width, height, asset.width, asset.height, radius, style],
  );

  const src = rikkaArtUrl(name);

  return (
    <div
      className={`rikka-art ${className}`.trim()}
      style={frameStyle}
      aria-hidden={decorative ? true : undefined}
      data-rikka-art={name}
      data-rikka-art-state={failed ? "unavailable" : "ready"}
    >
      {failed ? null : (
        <img
          src={src}
          width={asset.width}
          height={asset.height}
          alt={decorative ? "" : (alt ?? "")}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          {...(priority ? { fetchpriority: "high" as const } : {})}
          onError={handleError}
          style={{
            width: "100%",
            height: "100%",
            objectFit: fit,
            objectPosition: position,
            display: "block",
          }}
        />
      )}
    </div>
  );
}

/**
 * Reports which manifest assets are absent from the current build.
 *
 * Used by About/Health to state the gap in words instead of silently rendering
 * fewer pictures. Probes with `Image()` rather than `fetch` so the check rides
 * the browser cache the real `<img>` elements use, and so it needs no CORS or
 * JSON parsing.
 */
export function useMissingArtNames(names: readonly RikkaArtName[]): readonly RikkaArtName[] {
  const [missing, setMissing] = useState<readonly RikkaArtName[]>([]);

  useEffect(() => {
    let active = true;
    const results = new Set<RikkaArtName>();
    let settled = 0;
    const done = () => {
      settled += 1;
      if (active && settled === names.length) {
        setMissing([...results]);
      }
    };
    if (names.length === 0) return () => undefined;
    for (const name of names) {
      const probe = new Image();
      probe.onload = done;
      probe.onerror = () => {
        results.add(name);
        done();
      };
      probe.src = rikkaArtUrl(name);
    }
    return () => {
      active = false;
    };
  }, [names]);

  return missing;
}
