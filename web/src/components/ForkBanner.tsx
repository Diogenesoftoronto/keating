import { GitBranch } from "lucide-react";

export interface ForkBannerProps {
	/** Title of the session this one was forked from. */
	parentTitle: string;
	/** Jump back to the original (parent) session. */
	onOpenOriginal: () => void;
}

/**
 * Slim banner shown under the chat header when the active session is a fork,
 * making the branch relationship obvious and offering a jump back to the
 * original session.
 */
export function ForkBanner({ parentTitle, onOpenOriginal }: ForkBannerProps) {
	return (
		<div className="shrink-0 border-b border-border bg-primary/5 px-3 py-2">
			<div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
					<GitBranch size={13} className="shrink-0 text-primary" />
					<span className="truncate">
						Forked from{" "}
						<span className="font-medium text-foreground">
							“{parentTitle}”
						</span>
					</span>
				</div>
				<button
					type="button"
					className="inline-flex h-6 shrink-0 items-center rounded border border-border px-2 text-[11px] font-medium hover:bg-accent hover:text-accent-foreground"
					onClick={onOpenOriginal}
				>
					Open original
				</button>
			</div>
		</div>
	);
}
