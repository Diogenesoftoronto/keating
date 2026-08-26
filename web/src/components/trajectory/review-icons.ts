/**
 * Semantic icon vocabulary for the review surface.
 *
 * Every review concept resolves through this table rather than importing a
 * glyph at the call site, so the metaphor stays consistent: the session is a
 * marked-up book, the teacher works in its margin, and the AI passes are
 * drafting instruments (a nib, a rule, a compass, a telescope) rather than
 * generic "sparkles".
 *
 * Imported by direct path so the barrel file never enters the bundle —
 * `reicon-react` ships 2,674 icons and is marked `sideEffects: false`.
 */
import AlertCircle from "reicon-react/icons/AlertCircle";
import ArrowLeft from "reicon-react/icons/ArrowLeft";
import Bulb from "reicon-react/icons/Bulb";
import Chalkboard from "reicon-react/icons/Chalkboard";
import ChatRoundLine from "reicon-react/icons/ChatRoundLine";
import Check from "reicon-react/icons/Check";
import ClipboardExport from "reicon-react/icons/ClipboardExport";
import Compass from "reicon-react/icons/Compass";
import Copy from "reicon-react/icons/Copy";
import Eye from "reicon-react/icons/Eye";
import Feather from "reicon-react/icons/Feather";
import Gear from "reicon-react/icons/Gear";
import Layers from "reicon-react/icons/Layers";
import Lock from "reicon-react/icons/Lock";
import Magnifier from "reicon-react/icons/Magnifier";
import Notebook from "reicon-react/icons/Notebook";
import PenNib from "reicon-react/icons/PenNib";
import Plus from "reicon-react/icons/Plus";
import QuoteUp from "reicon-react/icons/QuoteUp";
import Refresh from "reicon-react/icons/Refresh";
import Route from "reicon-react/icons/Route";
import Ruler from "reicon-react/icons/Ruler";
import Save from "reicon-react/icons/Save";
import Scroll from "reicon-react/icons/Scroll";
import Sliders from "reicon-react/icons/Sliders";
import Star from "reicon-react/icons/Star";
import Tags from "reicon-react/icons/Tags";
import Telescope from "reicon-react/icons/Telescope";
import Trash from "reicon-react/icons/Trash";
import User from "reicon-react/icons/User";
import Verified from "reicon-react/icons/Verified";
import Xmark from "reicon-react/icons/Xmark";
import type { ReiconIcon } from "../KeatingIcon";

export const reviewIcon = {
	// --- the three columns -------------------------------------------------
	/** Turn rail: the route the lesson actually took. */
	contents: Route as ReiconIcon,
	/** Canvas: the page under review. */
	page: Scroll as ReiconIcon,
	/** Desk: the margin the teacher writes in. */
	margin: Notebook as ReiconIcon,

	// --- transcript roles ---------------------------------------------------
	teacher: Chalkboard as ReiconIcon,
	learner: User as ReiconIcon,
	tool: Gear as ReiconIcon,
	message: ChatRoundLine as ReiconIcon,

	// --- review verbs -------------------------------------------------------
	annotate: PenNib as ReiconIcon,
	quote: QuoteUp as ReiconIcon,
	rubric: Star as ReiconIcon,
	category: Tags as ReiconIcon,
	verdict: Verified as ReiconIcon,
	save: Save as ReiconIcon,
	discard: Trash as ReiconIcon,
	dismiss: Xmark as ReiconIcon,
	accept: Check as ReiconIcon,
	add: Plus as ReiconIcon,
	retry: Refresh as ReiconIcon,
	export: ClipboardExport as ReiconIcon,
	copy: Copy as ReiconIcon,
	search: Magnifier as ReiconIcon,
	inspect: Eye as ReiconIcon,
	settings: Sliders as ReiconIcon,
	back: ArrowLeft as ReiconIcon,
	locked: Lock as ReiconIcon,
	problem: AlertCircle as ReiconIcon,
	alternatives: Layers as ReiconIcon,

	// --- AI passes: each pass gets an instrument ---------------------------
	/** The pass affordance itself — Keating's pen. */
	pass: Feather as ReiconIcon,
	/** Critique sweep: reads the session and proposes notes. */
	sweep: Bulb as ReiconIcon,
	/** Rubric scoring: measuring against a fixed scale. */
	measure: Ruler as ReiconIcon,
	/** Annotation expansion: finding the way from a terse note to a full one. */
	expand: Compass as ReiconIcon,
	/** Cross-session digest: looking across many sessions at once. */
	digest: Telescope as ReiconIcon,
} as const;

export type ReviewIconName = keyof typeof reviewIcon;
