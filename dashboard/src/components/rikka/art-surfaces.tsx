/**
 * Rikka art surfaces — one component per *placement*, not one hero repeated.
 *
 * The design brief asks for deliberate art direction rather than the same
 * banner on every screen, so each surface has its own job:
 *
 * | Component        | Asset(s)                | Placement                                      |
 * |------------------|-------------------------|------------------------------------------------|
 * | `AmbientArt`     | night / day             | Full-bleed behind the shell, 4–7% opacity      |
 * | `PageArt`        | one 300×300 vignette    | Compact corner illustration in a page header   |
 * | `ArtBanner`      | welcome / dashboard-hero| Wide welcome strip, once per journey           |
 * | `AuthArt`        | login                   | Portrait column beside the sign-in card        |
 * | `AvatarArt`      | avatar                  | 28px identity chip in the shell and share page |
 *
 * Every one of them is decorative, non-interactive, and delegates sizing and
 * failure handling to `RikkaArt`, so the "no placeholder, report the gap"
 * rule is enforced in exactly one place.
 */
import { useState, type ReactNode } from "react";
import { RikkaArt } from "./RikkaArt";
import type { RikkaArtName } from "./rikka-art-manifest";

/**
 * Full-bleed character art behind the console.
 *
 * The generated night/day scenes keep their subject on the right third and
 * leave the left quiet, so this anchors the image to the right edge and fades
 * it out toward the content column. Opacity stays low (4–7%): the art must
 * never compete with a data table for attention, and at this level it survives
 * both palettes without washing out text contrast.
 *
 * `pointer-events: none` and `aria-hidden` are inherited from `RikkaArt`; the
 * layer is also `position: fixed` behind the shell's own stacking context.
 */
export function AmbientArt({ theme }: { readonly theme: "light" | "dark" }): ReactNode {
  return (
    <div className="rikka-ambient" aria-hidden="true">
      <RikkaArt
        name={theme === "dark" ? "night" : "day"}
        width="100%"
        height="100%"
        fit="cover"
        position="right center"
        radius="0"
      />
    </div>
  );
}

/**
 * Compact page vignette.
 *
 * Sized in pixels rather than as a hero: at 88px it reads as a considered
 * detail next to the heading instead of pushing the actual controls below the
 * fold on a 320px viewport (where it collapses to 56px, then hides).
 */
export function PageArt({
  name,
  size = 88,
  className = "",
}: {
  readonly name: RikkaArtName;
  readonly size?: number;
  readonly className?: string;
}): ReactNode {
  return (
    <RikkaArt
      name={name}
      width={size}
      height={size}
      radius="14px"
      className={`rikka-page-art ${className}`.trim()}
    />
  );
}

/**
 * Wide welcome strip.
 *
 * Used exactly twice in the product — the onboarding journey and the Overview
 * welcome — because a banner on every page is noise. Hidden below 720px, where
 * the vertical budget belongs to the checklist itself.
 */
export function ArtBanner({
  name,
  caption,
  className = "",
}: {
  readonly name: RikkaArtName;
  /** Visible caption; also the accessible description of the scene. */
  readonly caption?: string;
  readonly className?: string;
}): ReactNode {
  return (
    <figure className={`rikka-banner ${className}`.trim()}>
      <RikkaArt name={name} width="100%" fit="cover" position="center 30%" radius="16px" priority />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/**
 * Sign-in portrait.
 *
 * A separate column beside the form rather than a background: the art must
 * never sit under the password field, and below 900px the column is dropped so
 * the form keeps the full width on a phone.
 */
export function AuthArt({ alt, className = "" }: { readonly alt: string; readonly className?: string }): ReactNode {
  const [available, setAvailable] = useState(true);
  if (!available) return null;
  return (
    <RikkaArt
      name="login"
      width="100%"
      height="100%"
      fit="cover"
      radius="20px"
      decorative={false}
      alt={alt}
      className={`rikka-auth-art ${className}`.trim()}
      onUnavailable={() => setAvailable(false)}
    />
  );
}

/**
 * Identity chip.
 *
 * Falls back to the operator's initials when the avatar asset is absent, which
 * keeps the user card legible without pretending a picture loaded.
 */
export function AvatarArt({
  name,
  fallbackText,
  size = 30,
}: {
  readonly name: RikkaArtName;
  readonly fallbackText: string;
  readonly size?: number;
}): ReactNode {
  const [available, setAvailable] = useState(true);
  if (!available) {
    return (
      <span className="rikka-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">
        {fallbackText}
      </span>
    );
  }
  return (
    <RikkaArt
      name={name}
      width={size}
      height={size}
      radius="999px"
      className="rikka-avatar"
      onUnavailable={() => setAvailable(false)}
    />
  );
}
