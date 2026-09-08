import { useEffect, useRef, useState } from "react";
import { LANDING_EXAMPLES, type LandingExampleId } from "./landing-examples";
import "./landing-overload.css";

/** Authored answer illustrations, never represented as captured provider output. */
export function LandingOverload({ exampleId, onExampleChange }: { exampleId: LandingExampleId; onExampleChange: (id: LandingExampleId) => void }) {
	const [visible, setVisible] = useState(false);
	const [entered, setEntered] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); setEntered(true); return; }
		const observer = new IntersectionObserver(entries => {
			const onScreen = entries.some(entry => entry.isIntersecting);
			setVisible(onScreen);
			if (onScreen) setEntered(true);
		}, { threshold: 0.1 });
		observer.observe(host.current);
		return () => observer.disconnect();
	}, []);
	return <div ref={host} className="landing-overload" data-visible={visible} data-entered={entered}>
		<p className="landing-overload__disclosure">Illustrated examples · authored text, not provider transcripts</p>
		<div className="landing-overload__stack">
			{LANDING_EXAMPLES.map((answer, index) => <article key={answer.id} className="landing-overload__window" data-window={index} data-active={exampleId === answer.id} data-provider={answer.provider} aria-label={`${answer.provider}: ${answer.label}, illustrated answer`} onClick={() => onExampleChange(answer.id)} onFocusCapture={() => onExampleChange(answer.id)}>
				<header><button type="button" onClick={() => onExampleChange(answer.id)} aria-pressed={exampleId === answer.id} aria-label={`Bring ${answer.provider} ${answer.label} example forward`}><span className="landing-overload__dots" aria-hidden="true"><i /><i /><i /></span><span>{answer.provider}</span><span className="landing-overload__window-mark" aria-hidden="true">↗</span></button></header>
				<div className="landing-overload__body"><p className="landing-overload__query">{answer.query}</p><div className="landing-overload__answer">{answer.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div></div>
			</article>)}
		</div>
		<div className="landing-overload__switcher" aria-label="Inspect an example">{LANDING_EXAMPLES.map((answer) => <button type="button" key={answer.id} onClick={() => onExampleChange(answer.id)} aria-pressed={exampleId === answer.id}>{answer.provider} · {answer.label}</button>)}</div>
	</div>;
}
