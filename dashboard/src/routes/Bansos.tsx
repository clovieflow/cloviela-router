/**
 * Bansos route.
 *
 * Two screens behind one path: the program list, and — once a program is
 * selected — that program's participants, models, usage and audit. Keeping
 * them in one route component means the operator's selection is a URL segment
 * rather than local state, so a reload or a shared link lands in the same
 * place.
 */
import { type ReactNode, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHead } from "../components/PageHead";
import { BansosProgramsPanel } from "../components/bansos/BansosProgramsPanel";
import { BansosProgramDetail } from "../components/bansos/BansosProgramDetail";
import { BansosProgramDialog } from "../components/bansos/BansosProgramDialog";
import { useT } from "../shared/locale-context";

export default function Bansos(): ReactNode {
  const t = useT();
  const navigate = useNavigate();
  const { programId } = useParams<{ programId?: string }>();
  const [creating, setCreating] = useState(false);

  return (
    <div className="dashboard-page">
      <PageHead title={t("bansos.title")} description={t("bansos.subtitle")} art="welcome" />
      {programId === undefined ? (
        <BansosProgramsPanel onCreate={() => setCreating(true)} />
      ) : (
        <BansosProgramDetail programId={programId} />
      )}
      {creating ? (
        <BansosProgramDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/bansos/${encodeURIComponent(id)}`);
          }}
        />
      ) : null}
    </div>
  );
}
