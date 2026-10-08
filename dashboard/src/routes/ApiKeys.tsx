/**
 * API Keys route.
 *
 * The panel itself is the canonical owner of key CRUD, one-time secret
 * display, share links, rotation and revocation — it has been reachable from
 * Overview but had no navigation entry of its own, which made "where do I
 * create a key" a search problem. This route gives the existing, tested panel
 * a real address instead of reimplementing any of it.
 */
import { type ReactNode } from "react";
import { ApiKeysPanel } from "../components/ApiKeysPanel";
import { PageHead } from "../components/PageHead";
import { useT } from "../shared/locale-context";

export default function ApiKeys(): ReactNode {
  const t = useT();
  return (
    <div className="dashboard-page">
      <PageHead
        title={t("nav.apiKeys")}
        description={t("models.aliasSectionHint")}
        art="api-keys"
      />
      <ApiKeysPanel />
    </div>
  );
}
