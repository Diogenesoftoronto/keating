declare const plugin: {
	(): { postcssPlugin: string };
	postcss: true;
	/** `pointer` -> `var(--kc-hand, pointer)`; undefined when the value is not a plain cursor keyword. */
	rewrite(value: string): string | undefined;
};
export = plugin;
