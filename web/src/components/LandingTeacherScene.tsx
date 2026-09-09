import { useEffect, useState } from "react";
import { ShaderField } from "./ShaderField";
import { KeatingBot } from "./KeatingBot";
import "./landing-teacher-scene.css";
import "./lotus-motion.css";

/** A quiet, decorative companion to the continuity story; no simulated product state. */
export function LandingTeacherScene() {
	const [reduceMotion, setReduceMotion] = useState(false);
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
		<div className="landing-teacher-scene__lotus"><KeatingBot variant="body" state="understanding" size={270} label="" /></div>
	</div>;
}
