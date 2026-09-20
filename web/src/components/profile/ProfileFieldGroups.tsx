import type { ReactNode } from "react";
import {
	type DeclaredLearnerProfile,
	type PursuitStatus,
	currentPursuit,
	retirePursuit,
	setAsidePursuit,
	setCurrentPursuit,
	startPursuit,
} from "@keating/learner-contracts";
import { Select } from "../Select";
import { Toggle } from "../Toggle";
import { css } from "../../../styled-system/css";
import { fieldInput, outlineButton, textarea } from "../../../styled-system/recipes";

export interface ProfileGroupProps {
	profile: DeclaredLearnerProfile;
	onChange: (patch: Partial<DeclaredLearnerProfile>) => void;
	/** Prefix so the same group can render twice on one page without duplicate ids. */
	idPrefix?: string;
}

const groupClass = css({ display: "flex", flexDirection: "column", gap: "1rem" });
const rowClass = css({ display: "grid", gap: "1rem", gridTemplateColumns: "1fr", sm: { gridTemplateColumns: "1fr 1fr" } });
const fieldClass = css({ display: "flex", flexDirection: "column", gap: "0.375rem", minWidth: 0 });
const labelClass = css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--foreground)" });
const hintClass = css({ fontSize: "11px", lineHeight: "1.125rem", color: "var(--muted-foreground)" });
const toggleRowClass = css({
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	gap: "0.75rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	padding: "0.625rem 0.75rem",
});
const toggleTextClass = css({ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 });
const toggleTitleClass = css({ fontSize: "0.8125rem", fontWeight: 500, color: "var(--foreground)" });
const noticeClass = css({
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--muted)",
	padding: "0.625rem 0.75rem",
	fontSize: "0.75rem",
	lineHeight: "1.125rem",
	color: "var(--muted-foreground)",
});
const pursuitListClass = css({ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" });
const pursuitRowClass = css({
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	flexWrap: "wrap",
	gap: "0.75rem",
	paddingBlock: "0.75rem",
	borderBottom: "1px solid var(--border)",
});
const pursuitCopyClass = css({ display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: 0, flex: "1 1 14rem" });
const pursuitTitleClass = css({ fontSize: "0.8125rem", fontWeight: 600, color: "var(--foreground)", overflowWrap: "anywhere" });
const pursuitStatusClass = css({ fontSize: "11px", color: "var(--muted-foreground)" });
const pursuitActionsClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem" });

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div className={fieldClass}>
			<label htmlFor={id} className={labelClass}>{label}</label>
			{children}
			{hint && <p className={hintClass}>{hint}</p>}
		</div>
	);
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (next: boolean) => void }) {
	return (
		<div className={toggleRowClass}>
			<span className={toggleTextClass}>
				<span className={toggleTitleClass}>{title}</span>
				<span className={hintClass}>{description}</span>
			</span>
			<Toggle checked={checked} onChange={onChange} aria-label={title} />
		</div>
	);
}

/** Comma-separated entry keeps list fields to one accessible control each. */
function listValue(entries: string[]): string {
	return entries.join(", ");
}
function parseList(raw: string): string[] {
	return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function IdentityFields({ profile, onChange, idPrefix = "profile" }: ProfileGroupProps) {
	return (
		<div className={groupClass}>
			<div className={rowClass}>
				<Field id={`${idPrefix}-name`} label="What should Keating call you?" hint="Optional. Used when addressing you, nothing else.">
					<input
						id={`${idPrefix}-name`}
						className={fieldInput()}
						type="text"
						autoComplete="given-name"
						maxLength={80}
						value={profile.preferredName}
						onChange={(event) => onChange({ preferredName: event.target.value })}
						placeholder="Sam"
					/>
				</Field>
				<Field id={`${idPrefix}-pronouns`} label="Pronouns" hint="Optional. Free text — write whatever is right for you.">
					<input
						id={`${idPrefix}-pronouns`}
						className={fieldInput()}
						type="text"
						maxLength={40}
						value={profile.pronouns}
						onChange={(event) => onChange({ pronouns: event.target.value })}
						placeholder="they/them"
					/>
				</Field>
			</div>
			<Field
				id={`${idPrefix}-age`}
				label="Age range"
				hint="A range, never a birth date. It helps pick examples and vocabulary — it never changes how much Keating expects of you."
			>
				<Select id={`${idPrefix}-age`} aria-label="Age range" value={profile.ageBand} onValueChange={(value) => onChange({ ageBand: value as DeclaredLearnerProfile["ageBand"] })}>
					<option value="">Not answered</option>
					<option value="under-13">Under 13</option>
					<option value="13-17">13–17</option>
					<option value="18-24">18–24</option>
					<option value="25-34">25–34</option>
					<option value="35-49">35–49</option>
					<option value="50-64">50–64</option>
					<option value="65-plus">65 or older</option>
					<option value="prefer-not-to-say">Prefer not to say</option>
				</Select>
			</Field>
			{profile.ageBand === "under-13" && (
				<p className={noticeClass} role="note">
					Keating is built for independent study. If you are under 13, please set it up with a parent, guardian or teacher. Optional analytics stay switched off for this profile.
				</p>
			)}
		</div>
	);
}

export function LanguageFields({ profile, onChange, idPrefix = "profile" }: ProfileGroupProps) {
	return (
		<div className={groupClass}>
			<div className={rowClass}>
				<Field id={`${idPrefix}-locale`} label="Interface language" hint="Changes the app's own wording. Keating currently ships English and French (Canada).">
					<Select id={`${idPrefix}-locale`} aria-label="Interface language" value={profile.interfaceLocale} onValueChange={(value) => onChange({ interfaceLocale: value as DeclaredLearnerProfile["interfaceLocale"] })}>
						<option value="system">Match my browser</option>
						<option value="en-CA">English</option>
						<option value="fr-CA">Français</option>
					</Select>
				</Field>
				<Field id={`${idPrefix}-explain-language`} label="Explain things in" hint="Any language. Keating will teach in it even when the interface stays in English.">
					<input
						id={`${idPrefix}-explain-language`}
						className={fieldInput()}
						type="text"
						maxLength={60}
						value={profile.explainInLanguage}
						onChange={(event) => onChange({ explainInLanguage: event.target.value })}
						placeholder="English"
					/>
				</Field>
			</div>
			<div className={rowClass}>
				<Field id={`${idPrefix}-fluency`} label="Your fluency in that language" hint="Sets vocabulary and sentence length — not difficulty.">
					<Select id={`${idPrefix}-fluency`} aria-label="Fluency in the language of instruction" value={profile.instructionLanguageFluency} onValueChange={(value) => onChange({ instructionLanguageFluency: value as DeclaredLearnerProfile["instructionLanguageFluency"] })}>
						<option value="">Not answered</option>
						<option value="beginner">Beginner</option>
						<option value="intermediate">Intermediate</option>
						<option value="fluent">Fluent</option>
						<option value="native">Native speaker</option>
					</Select>
				</Field>
				<Field id={`${idPrefix}-other-languages`} label="Other languages you speak" hint="Comma separated. Lets Keating borrow a word when it explains something better.">
					<input
						id={`${idPrefix}-other-languages`}
						className={fieldInput()}
						type="text"
						value={listValue(profile.otherLanguages)}
						onChange={(event) => onChange({ otherLanguages: parseList(event.target.value) })}
						placeholder="French, Tagalog"
					/>
				</Field>
			</div>
		</div>
	);
}

export function ContextFields({ profile, onChange, idPrefix = "profile" }: ProfileGroupProps) {
	return (
		<div className={groupClass}>
			<Field id={`${idPrefix}-stage`} label="Where are you studying right now?">
				<Select id={`${idPrefix}-stage`} aria-label="Education stage" value={profile.educationStage} onValueChange={(value) => onChange({ educationStage: value as DeclaredLearnerProfile["educationStage"] })}>
					<option value="">Not answered</option>
					<option value="primary">Primary school</option>
					<option value="secondary">Secondary school</option>
					<option value="undergraduate">Undergraduate</option>
					<option value="graduate">Graduate</option>
					<option value="self-taught">Teaching myself</option>
					<option value="professional">Learning for work</option>
					<option value="returning">Coming back to study</option>
					<option value="prefer-not-to-say">Prefer not to say</option>
				</Select>
			</Field>
			<Field id={`${idPrefix}-prior`} label="What do you already know about the subject?" hint="A sentence is plenty. Keating starts from here instead of from zero.">
				<textarea
					id={`${idPrefix}-prior`}
					className={textarea()}
					rows={3}
					maxLength={600}
					value={profile.priorKnowledge}
					onChange={(event) => onChange({ priorKnowledge: event.target.value })}
					placeholder="I write a bit of Python but I have never studied algorithms."
				/>
			</Field>
			<Field id={`${idPrefix}-interests`} label="Things you are into" hint="Comma separated. These become the analogies and examples Keating reaches for.">
				<input
					id={`${idPrefix}-interests`}
					className={fieldInput()}
					type="text"
					value={listValue(profile.interests)}
					onChange={(event) => onChange({ interests: parseList(event.target.value) })}
					placeholder="cooking, basketball, synthesizers"
				/>
			</Field>
		</div>
	);
}

const PURSUIT_STATUS_LABELS: Record<PursuitStatus, string> = {
	current: "Current pursuit",
	dormant: "Set aside",
	achieved: "Achieved",
	abandoned: "Dropped",
};

export function GoalFields({
	profile,
	onChange,
	idPrefix = "profile",
	showPursuits = false,
}: ProfileGroupProps & { showPursuits?: boolean }) {
	const active = currentPursuit(profile.pursuits);
	const orderedPursuits = [...profile.pursuits].sort((left, right) => {
		if (left.status === "current" && right.status !== "current") return -1;
		if (right.status === "current" && left.status !== "current") return 1;
		return right.updatedAt - left.updatedAt;
	});
	const typedIsCurrent = Boolean(
		active && active.title.trim().toLocaleLowerCase() === profile.goalText.trim().toLocaleLowerCase(),
	);
	const startTypedPursuit = () => {
		if (!profile.goalText.trim()) return;
		onChange({
			pursuits: startPursuit(profile.pursuits, {
				title: profile.goalText,
				motivation: profile.motivation,
			}),
		});
	};
	return (
		<div className={groupClass}>
			<Field id={`${idPrefix}-goal`} label="What would you like to understand?" hint="A starting point, not a contract. Keating follows what you actually ask about, and you can change or drop this at any time.">
				<textarea
					id={`${idPrefix}-goal`}
					className={textarea()}
					rows={3}
					maxLength={1000}
					value={profile.goalText}
					onChange={(event) => onChange({ goalText: event.target.value })}
					placeholder="I want to understand recursion well enough to explain it to someone else."
				/>
			</Field>
			{showPursuits && (
				<>
					<div className={pursuitActionsClass}>
						<button
							type="button"
							className={outlineButton()}
							disabled={!profile.goalText.trim() || typedIsCurrent}
							onClick={startTypedPursuit}
						>
							{typedIsCurrent
								? "Current pursuit"
								: "Make this current"}
						</button>
						<span className={hintClass}>
							Only one pursuit is current. Starting another sets the previous one aside.
						</span>
					</div>
					{orderedPursuits.length > 0 && (
						<div className={pursuitListClass} aria-label="Your pursuits">
							{orderedPursuits.map((pursuit) => (
								<div className={pursuitRowClass} key={pursuit.id}>
									<div className={pursuitCopyClass}>
										<span className={pursuitTitleClass}>{pursuit.title}</span>
										<span className={pursuitStatusClass}>{PURSUIT_STATUS_LABELS[pursuit.status]}</span>
									</div>
									<div className={pursuitActionsClass}>
										{pursuit.status !== "current" && (
											<button
												type="button"
												className={outlineButton()}
												onClick={() => onChange({ pursuits: setCurrentPursuit(profile.pursuits, pursuit.id) })}
											>
												Make current
											</button>
										)}
										{pursuit.status === "current" && (
											<>
												<button
													type="button"
													className={outlineButton()}
													onClick={() => onChange({ pursuits: setAsidePursuit(profile.pursuits, pursuit.id) })}
												>
													Set aside
												</button>
												<button
													type="button"
													className={outlineButton()}
													onClick={() => onChange({ pursuits: retirePursuit(profile.pursuits, pursuit.id, "achieved") })}
												>
													Mark achieved
												</button>
											</>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</>
			)}
			<div className={rowClass}>
				<Field id={`${idPrefix}-motivation`} label="Why now?">
					<Select id={`${idPrefix}-motivation`} aria-label="Motivation" value={profile.motivation} onValueChange={(value) => onChange({ motivation: value as DeclaredLearnerProfile["motivation"] })}>
						<option value="">Not answered</option>
						<option value="curiosity">Plain curiosity</option>
						<option value="school">For a course</option>
						<option value="career">For work</option>
						<option value="exam">For an exam</option>
						<option value="hobby">For a hobby</option>
						<option value="teaching-others">To teach someone else</option>
					</Select>
				</Field>
				<Field id={`${idPrefix}-deadline`} label="Any date you are working towards?" hint="Optional.">
					<input
						id={`${idPrefix}-deadline`}
						className={fieldInput()}
						type="date"
						value={profile.deadline}
						onChange={(event) => onChange({ deadline: event.target.value })}
					/>
				</Field>
			</div>
			<div className={rowClass}>
				<Field id={`${idPrefix}-weekly`} label="Minutes a week you can give this" hint="Shapes how much Keating plans, not how fast it expects you to go.">
					<input
						id={`${idPrefix}-weekly`}
						className={fieldInput()}
						type="number"
						min={1}
						max={10080}
						value={profile.weeklyMinutes ?? ""}
						onChange={(event) => onChange({ weeklyMinutes: event.target.value ? Number(event.target.value) : null })}
						placeholder="90"
					/>
				</Field>
				<Field id={`${idPrefix}-session`} label="Comfortable session length (minutes)">
					<input
						id={`${idPrefix}-session`}
						className={fieldInput()}
						type="number"
						min={1}
						max={480}
						value={profile.preferredSessionMinutes ?? ""}
						onChange={(event) => onChange({ preferredSessionMinutes: event.target.value ? Number(event.target.value) : null })}
						placeholder="25"
					/>
				</Field>
			</div>
		</div>
	);
}

export function PedagogyFields({ profile, onChange, idPrefix = "profile" }: ProfileGroupProps) {
	return (
		<div className={groupClass}>
			<div className={rowClass}>
				<Field id={`${idPrefix}-socratic`} label="How much should Keating ask before it tells?" hint="Keating teaches by questioning. This sets how insistent that is.">
					<Select id={`${idPrefix}-socratic`} aria-label="Socratic intensity" value={profile.socraticIntensity} onValueChange={(value) => onChange({ socraticIntensity: value as DeclaredLearnerProfile["socraticIntensity"] })}>
						<option value="">Not answered</option>
						<option value="light">Mostly explain, ask sometimes</option>
						<option value="balanced">A balance of both</option>
						<option value="deep">Keep asking until it clicks</option>
					</Select>
				</Field>
				<Field id={`${idPrefix}-hints`} label="When you are stuck">
					<Select id={`${idPrefix}-hints`} aria-label="Hint level" value={profile.hintLevel} onValueChange={(value) => onChange({ hintLevel: value as DeclaredLearnerProfile["hintLevel"] })}>
						<option value="">Not answered</option>
						<option value="minimal">Let me struggle a while</option>
						<option value="moderate">Nudge me</option>
						<option value="generous">Give me a clear hint</option>
					</Select>
				</Field>
			</div>
			<div className={rowClass}>
				<Field id={`${idPrefix}-tone`} label="Tone">
					<Select id={`${idPrefix}-tone`} aria-label="Tone" value={profile.tone} onValueChange={(value) => onChange({ tone: value as DeclaredLearnerProfile["tone"] })}>
						<option value="">Not answered</option>
						<option value="warm">Warm and encouraging</option>
						<option value="neutral">Neutral</option>
						<option value="direct">Direct, no padding</option>
						<option value="playful">Playful</option>
					</Select>
				</Field>
				<Field id={`${idPrefix}-depth`} label="Depth">
					<Select id={`${idPrefix}-depth`} aria-label="Explanation depth" value={profile.depth} onValueChange={(value) => onChange({ depth: value as DeclaredLearnerProfile["depth"] })}>
						<option value="">Not answered</option>
						<option value="overview">Give me the shape of it</option>
						<option value="standard">Standard</option>
						<option value="rigorous">Rigorous, with the details</option>
					</Select>
				</Field>
			</div>
			<div className={rowClass}>
				<Field id={`${idPrefix}-sequencing`} label="Start with">
					<Select id={`${idPrefix}-sequencing`} aria-label="Sequencing" value={profile.examplesFirst === null ? "" : profile.examplesFirst ? "examples" : "rule"} onValueChange={(value) => onChange({ examplesFirst: value === "" ? null : value === "examples" })}>
						<option value="">Not answered</option>
						<option value="examples">A concrete example</option>
						<option value="rule">The general rule</option>
					</Select>
				</Field>
				<Field id={`${idPrefix}-analogies`} label="Draw analogies from" hint="Comma separated. Fields you know well enough to reason by comparison.">
					<input
						id={`${idPrefix}-analogies`}
						className={fieldInput()}
						type="text"
						value={listValue(profile.analogyDomains)}
						onChange={(event) => onChange({ analogyDomains: parseList(event.target.value) })}
						placeholder="cooking, music, carpentry"
					/>
				</Field>
			</div>
		</div>
	);
}

export function AccessibilityFields({ profile, onChange, idPrefix = "profile" }: ProfileGroupProps) {
	return (
		<div className={groupClass}>
			<p className={hintClass}>Keating treats these as requirements, not suggestions.</p>
			<ToggleRow title="Plain language" description="Short sentences, no jargon unless it is the thing being taught." checked={profile.plainLanguage} onChange={(plainLanguage) => onChange({ plainLanguage })} />
			<ToggleRow title="I use a screen reader" description="Keating describes diagrams and visuals in text rather than relying on them." checked={profile.screenReader} onChange={(screenReader) => onChange({ screenReader })} />
			<ToggleRow title="Prefer captions and transcripts" description="Applies to spoken lessons and voice mode." checked={profile.captionsPreferred} onChange={(captionsPreferred) => onChange({ captionsPreferred })} />
			<ToggleRow title="Dyslexia-friendly typography" description="Wider spacing and a more distinguishable typeface." checked={profile.dyslexiaFriendlyFont} onChange={(dyslexiaFriendlyFont) => onChange({ dyslexiaFriendlyFont })} />
			<ToggleRow title="Reduce motion" description="Removes animated transitions across the interface." checked={profile.reduceMotion} onChange={(reduceMotion) => onChange({ reduceMotion })} />
			<ToggleRow title="Higher contrast" description="Strengthens text and border contrast." checked={profile.highContrast} onChange={(highContrast) => onChange({ highContrast })} />
			<Field id={`${idPrefix}-text-scale`} label="Text size">
				<Select id={`${idPrefix}-text-scale`} aria-label="Text size" value={profile.textScale} onValueChange={(value) => onChange({ textScale: value as DeclaredLearnerProfile["textScale"] })}>
					<option value="">Not answered</option>
					<option value="default">Default</option>
					<option value="large">Large</option>
					<option value="larger">Larger</option>
				</Select>
			</Field>
		</div>
	);
}
