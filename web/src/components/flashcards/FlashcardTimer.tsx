import { Countdown } from "../../design-system/charts";
import { Select } from "../Select";
import { useId } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { FLASHCARD_REVEAL_DELAYS, type FlashcardAutoReveal, type FlashcardRevealDelay } from "./useFlashcardAutoReveal";
import "./flashcard-timer.css";

export function FlashcardTimer({ timer, disabled = false }: { timer: FlashcardAutoReveal; disabled?: boolean }) {
	const descriptionId = useId();
	const counting = timer.delay > 0 && timer.remaining !== null;
	const seconds = Math.ceil(timer.remaining ?? 0);
	return <div className="flashcard-timer">
		<label className="flashcard-timer-setting" data-glyph-host>
			<KeatingGlyph name="clock" size={15} />
			<span>Reveal</span>
			<Select aria-label="Auto-reveal answer" aria-describedby={descriptionId} disabled={disabled} value={timer.delay} onValueChange={(value) => timer.setDelay(Number(value) as FlashcardRevealDelay)}>
				{FLASHCARD_REVEAL_DELAYS.map((delay) => <option key={delay} value={delay}>{delay ? `${delay}s` : "Off"}</option>)}
			</Select>
		</label>
		<span id={descriptionId} className="flashcard-timer-sr">Reveals the answer only. You choose the recall rating. Pauses when this tab is hidden.</span>
		{counting ? <div className="flashcard-timer-countdown" data-paused={timer.paused || disabled}>
			<div role="timer" className="flashcard-timer-clock" aria-live="off" aria-label={`${seconds} seconds until answer reveal${timer.paused || disabled ? ", paused" : ""}`}>
				<Countdown remaining={seconds} total={timer.delay} label="Auto-reveal countdown"/>
			</div>
			<button type="button" disabled={disabled} aria-label={timer.paused ? "Resume reveal timer" : "Pause reveal timer"} onClick={timer.togglePause}>
				{timer.paused ? <KeatingGlyph name="play" size={15} /> : <KeatingGlyph name="pause" size={15} />}
				<span>{timer.paused ? "Resume" : "Pause"}</span>
			</button>
		</div> : null}
	</div>;
}
