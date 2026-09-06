import { evaluateSimulationExpression, type SimulationExpressionNode, type UiSimulationParameter } from "@keating/learner-contracts";

export interface SimulationSample {
	x: number;
	y: number | undefined;
}

/** Bounded, local observations of the authored expression, never generated data. */
export function sampleSimulation(
	parameter: UiSimulationParameter,
	expression: SimulationExpressionNode | undefined,
	values: Readonly<Record<string, number>>,
): SimulationSample[] {
	const maxIntervals = 80;
	const span = parameter.max - parameter.min;
	const steps = parameter.step === undefined ? undefined : Math.floor(span / parameter.step + 1e-9);
	const intervals = steps === undefined ? maxIntervals : Math.min(maxIntervals, steps);
	const settings = new Set<number>();
	for (let index = 0; index <= intervals; index += 1) {
		const fraction = intervals === 0 ? 0 : index / intervals;
		let value = parameter.min * (1 - fraction) + parameter.max * fraction;
		if (parameter.step !== undefined && steps !== undefined && Number.isFinite(steps)) {
			value = parameter.min + Math.round(steps * fraction) * parameter.step;
		}
		if (Number.isFinite(value)) settings.add(Math.max(parameter.min, Math.min(parameter.max, value)));
	}
	const current = values[parameter.id];
	if (current !== undefined && Number.isFinite(current) && current >= parameter.min && current <= parameter.max) {
		// Decimal steps may produce 5.1000000000000005 while the slider yields 5.1.
		// Preserve the exact current point and remove only machine-rounding copies.
		for (const setting of settings) {
			if (Math.abs(setting - current) <= Number.EPSILON * Math.max(1, Math.abs(setting), Math.abs(current)) * 8) settings.delete(setting);
		}
		settings.add(current);
	}
	return [...settings].sort((left, right) => left - right).map((x) => ({
		x,
		y: expression ? evaluateSimulationExpression(expression, { ...values, [parameter.id]: x }) : undefined,
	}));
}

export function formatSimulationNumber(value: number | undefined, precision = 2): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	if (Math.abs(value) >= 1e9 || (value !== 0 && Math.abs(value) < 10 ** -Math.max(precision, 4))) return value.toExponential(2);
	return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function parameterPrecision(parameter: UiSimulationParameter): number {
	if (parameter.step === undefined) return 2;
	const [significand = "", exponent = "0"] = String(parameter.step).toLowerCase().split("e");
	return Math.min(6, Math.max(0, (significand.split(".")[1]?.length ?? 0) - Number(exponent)));
}
