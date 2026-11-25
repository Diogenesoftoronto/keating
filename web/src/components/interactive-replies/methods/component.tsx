import { useMemo } from "react";
import "./component.css";
import { validateMethodsLab, type MethodsLabConfig, type ShareSummary } from "./config";
import { DagLab } from "./dag";
import { DiagnosticLab } from "./diagnostic";
import { SurvivalLab } from "./survival";
import { MetaLab } from "./meta";

/* ============================================================================
   MethodsLab: the methodology of a medical or science paper, handled directly.
   mode "dag"        draw the causal story, adjust for variables, see which paths stay open (backdoor criterion)
   mode "diagnostic" 1,000 people as an icon array: drag prevalence / sensitivity / false alarms or a cut-off
   mode "survival"   drag event and censoring marks on patient timelines; Kaplan–Meier, medians, Cox HR, ITT vs PP
   mode "meta"       drag trial results and precision on a forest plot; weights, pooled estimate, I², funnel
   All maths lives in model.ts (unit-tested). Educational model, not for clinical use.
   ========================================================================== */

export type { MethodsLabConfig, ShareSummary, DagConfig, DiagnosticConfig, SurvivalConfig, MetaConfig } from "./config";
export { validateMethodsLab } from "./config";
export { presets, scenario, variants } from "./presets";

type Props = { config: MethodsLabConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void };

export function MethodsLab({ config, onChange, onShare }: Props) {
  const problems = useMemo(() => validateMethodsLab(config), [config]);
  if (problems.length) {
    return <section className="activity methods-lab is-fallback" aria-label="Methods lab">
      <p className="ml-fallback">This methods lab could not be set up: {problems[0]}</p>
    </section>;
  }
  switch (config.mode) {
    case "dag": return <DagLab config={config} onChange={onChange} onShare={onShare} />;
    case "diagnostic": return <DiagnosticLab config={config} onChange={onChange} onShare={onShare} />;
    case "survival": return <SurvivalLab config={config} onChange={onChange} onShare={onShare} />;
    case "meta": return <MetaLab config={config} onChange={onChange} onShare={onShare} />;
  }
}
