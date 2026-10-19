/**
 * Small pieces shared by the sandbox panels: runtime class-name map, spinner,
 * and formatting helpers. Pure helpers live in ./sandbox-helpers.
 */
import RefreshCw from "reicon-react/icons/Refresh";
import { KeatingIcon } from "../KeatingIcon";

export const styles = {
  panel: "runtime-panel",
  header: "runtime-header",
  minW0: "runtime-min-w0",
  flexCenter: "runtime-flex-center",
  body: "runtime-body",
  grid2: "runtime-grid2",
  grid3: "runtime-grid3",
  card: "runtime-card",
  textXsMuted: "runtime-text-xs-muted",
  text10Muted: "runtime-text10-muted",
  semiboldXs: "runtime-semibold-xs",
  mono: "runtime-mono",
  monoXs: "runtime-mono-xs",
  primaryButtonSm: "runtime-primary-button-sm",
  primaryButton: "runtime-primary-button",
  outlineButtonSmBg: "runtime-outline-button-sm-bg",
  outlineButton: "runtime-outline-button",
  inputBase: "runtime-input-base",
  inputMono: "runtime-input-mono",
  hidden: "runtime-hidden",
};

export function RuntimeSpinner({ size = 16 }: { size?: number }) {
  return <KeatingIcon icon={RefreshCw} size={size} className="runtime-spinner" />;
}
