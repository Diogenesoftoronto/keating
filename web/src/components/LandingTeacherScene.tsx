import { useEffect, useState } from "react";
import { ShaderField } from "./ShaderField";
import "./landing-teacher-scene.css";

/** A quiet, decorative companion to the continuity story; no simulated product state. */
export function LandingTeacherScene() {
	const [reduceMotion, setReduceMotion] = useState(false);
	const [fallback, setFallback] = useState(false);
	const [unavailable, setUnavailable] = useState(false);
	useEffect(() => {
		const root = document.documentElement;
		const sync = () => setReduceMotion(root.dataset.motion === "reduce");
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
		return () => observer.disconnect();
	}, []);
	return <div className="landing-teacher-scene" aria-hidden="true">
		<div className="landing-teacher-scene__field">
			{!reduceMotion && <ShaderField colorVar="--accent-green" density={92} intensity={0.85} opacity={0.4} radial />}
		</div>
		<span className="landing-teacher-scene__ground" />
		{!unavailable && <img className="landing-teacher-scene__bot" src={fallback ? "/brand/mascot-full.png" : "/brand/mascot-lotus.png"} alt="" draggable={false} loading="lazy" decoding="async" onError={() => { if (fallback) setUnavailable(true); else setFallback(true); }} />}
	</div>;
}
