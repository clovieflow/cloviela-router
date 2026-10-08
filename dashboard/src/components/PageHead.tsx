/**
 * Page header with a compact art vignette.
 *
 * One owner for the title/description/illustration row so a new page cannot
 * invent a fifth header shape, and so the responsive behaviour (the vignette
 * shrinks at 720px and disappears at 420px, where the vertical budget belongs
 * to content) is defined once.
 *
 * The illustration is decorative: it is `aria-hidden`, `pointer-events: none`
 * and sits beside the text rather than behind it, so it never occupies an
 * interactive target and never reduces text contrast.
 */
import type { ReactNode } from "react";
import { PageArt } from "./rikka/art-surfaces";
import type { RikkaArtName } from "./rikka/rikka-art-manifest";

export interface PageHeadProps {
  readonly title: string;
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
  title,
  description,
  eyebrow,
  art,
  actions,
  level = 1,
}: PageHeadProps): ReactNode {
  const Title = level === 1 ? "h1" : "h2";
  return (
    <div className="page-head">
      <div className="page-head-text">
        {eyebrow}
        <Title className="page-head-title">{title}</Title>
        {description ? <p className="page-head-desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
      {art ? <PageArt name={art} /> : null}
    </div>
  );
}
