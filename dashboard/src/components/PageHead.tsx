/**
 * Page action row with an optional art vignette.
 *
 * ── Why this no longer renders the title ────────────────────────────────────
 * The shell's topbar already prints the route's title and subtitle, resolved
 * from the same catalogue keys these pages were passing in. Both rendered, so
 * every page carrying a `PageHead` stated its name twice in a row — "Model"
 * above "Model" — and on `/models` a third time, because its first card
 * repeated the title as well.
 *
 * The topbar wins because it is the one that stays correct for the two
 * parameterized routes, where the title depends on data the page has not
 * loaded yet (`/providers/:providerId` names the provider). A page keeps
 * ownership of what is genuinely page-local: its actions, its eyebrow, and the
 * vignette that gives the screen its own character.
 *
 * `title` and `description` are still accepted so the 13 existing call sites
 * keep typechecking, but they are no longer rendered. Removing the props
 * outright would have meant editing every page in the same change as a visual
 * fix; they are documented here and deleted in a follow-up.
 *
 * The illustration is decorative: it is `aria-hidden`, `pointer-events: none`
 * and sits beside the content rather than behind it, so it never occupies an
 * interactive target and never reduces text contrast.
 */
import type { ReactNode } from "react";
import { PageArt } from "./rikka/art-surfaces";
import type { RikkaArtName } from "./rikka/rikka-art-manifest";

export interface PageHeadProps {
  /** @deprecated The shell topbar renders the route title. Kept for callers. */
  readonly title?: string;
  /** @deprecated The shell topbar renders the route subtitle. Kept for callers. */
  readonly description?: string;
  /** Optional leading element, rendered above the title (eyebrow, badge row). */
  readonly eyebrow?: ReactNode;
  /** Page vignette; omit for a text-only header. */
  readonly art?: RikkaArtName;
  /** Trailing controls, right-aligned on wide viewports. */
  readonly actions?: ReactNode;
  readonly level?: 1 | 2;
}

export function PageHead({
  eyebrow,
  art,
  actions,
}: PageHeadProps): ReactNode {
  // Nothing to render when a page supplies neither an action nor a vignette;
  // an empty flex row would add a gap for no content.
  if (eyebrow === undefined && actions === undefined && art === undefined) return null;

  return (
    <div className="page-head">
      {eyebrow !== undefined ? <div className="page-head-text">{eyebrow}</div> : null}
      {actions ? <div className="page-head-actions">{actions}</div> : null}
      {art ? <PageArt name={art} /> : null}
    </div>
  );
}
