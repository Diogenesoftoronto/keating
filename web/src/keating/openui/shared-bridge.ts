/**
 * Browser compatibility seam. The compiler is dependency-free and shared by
 * every learner surface; the React OpenUI parser remains renderer-only.
 */
export {
	SHARED_OPENUI_COMPONENT_MAPPERS,
	compileOpenUISourceToSharedDocument,
	tryCompileOpenUISourceToSharedDocument,
	type CompileSharedOpenUIOptions,
	type OpenUISourceCompileResult,
	type OpenUISourceFailureKind,
} from "@keating/learner-contracts";
