/**
 * The Ringkasan hero: a thin banner with the illustration on the right and
 * the product statement on the left.
 *
 * ── Why this is not `ArtBanner` ─────────────────────────────────────────────
 * `ArtBanner` renders illustration and caption as two stacked blocks, which is
 * right for a page vignette but wrong here: the reference design puts the copy
 * *on* the artwork, over a darkened left third, and keeps the whole strip about
 * a sixth of the viewport. Text is real DOM, never baked into the image, so it
 * stays selectable, translatable, and readable at any zoom.
 *
 * ── The contrast contract ───────────────────────────────────────────────────
 * White text over a photograph is only legible if the photograph is darkened
 * where the text sits. The scrim below is a left-to-right gradient that is
 * opaque at the text edge and transparent by the time it reaches Rikka, so the
 * illustration keeps its colours and the copy keeps its contrast. The gradient
 * is theme-independent: it darkens the image, not the page.
 *
 * At narrow widths the copy would sit over Rikka's face, so the layout flips:
 * the image becomes a short band above a normal text block rather than being
 * cropped further. Clipping a face to keep a caption in place is the failure
 * mode this avoids.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../../shared/locale-context";
import { readConsoleTheme, resolveConsoleTheme, subscribeToOSTheme } from "../../shared/theme";
import { RikkaArt } from "../../components/rikka/RikkaArt";

export function OverviewHero(): ReactNode {
  const t = useT();
  // The hero follows the console theme so the palette stays coherent: the dusk
  // scene on Noir, the daylight scene on Rikka Day. Same subscription the
  // shell uses, so a theme change updates both together.
  const [theme, setTheme] = useState<"light" | "dark">(
    () => resolveConsoleTheme(readConsoleTheme()),
  );
  useEffect(() => {
    const sync = () => setTheme(resolveConsoleTheme(readConsoleTheme()));
    const unsubscribe = subscribeToOSTheme(sync);
    window.addEventListener("storage", sync);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <section className="cl-hero" aria-labelledby="cl-hero-title">
      <div className="cl-hero__media" aria-hidden="true">
        {/*
          `night` is the wide riverside scene: subject on the right, city
          panorama through the centre, quiet sky on the left for the copy. The
          close-up `dashboard-hero` portrait is a different composition and
          clips the face at strip height; this is the asset drawn for a banner.
        */}
        <RikkaArt
          name={theme === "light" ? "day" : "night"}
          width="100%"
          height="100%"
          fit="cover"
          position="right center"
          radius="0"
          priority
        />
        <span className="cl-hero__scrim" />
      </div>

      <div className="cl-hero__copy">
        <p className="cl-hero__eyebrow">{t("overview.hero.eyebrow" as never)}</p>
        <h2 className="cl-hero__title" id="cl-hero-title">
          {t("overview.hero.title" as never)}
        </h2>
        <p className="cl-hero__lede">{t("overview.hero.lede" as never)}</p>
      </div>
    </section>
  );
}
