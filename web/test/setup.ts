const testGlobal = globalThis as any;

if (!testGlobal.DOMMatrix) {
	testGlobal.DOMMatrix = class DOMMatrix {
		a = 1;
		b = 0;
		c = 0;
		d = 1;
		e = 0;
		f = 0;
		is2D = true;
		isIdentity = true;

		constructor(_init?: string | number[]) {}

		multiplySelf() {
			return this;
		}

		preMultiplySelf() {
			return this;
		}

		translateSelf() {
			return this;
		}

		scaleSelf() {
			return this;
		}

		rotateSelf() {
			return this;
		}

		invertSelf() {
			return this;
		}

		transformPoint(point?: { x?: number; y?: number; z?: number; w?: number }) {
			return {
				x: point?.x ?? 0,
				y: point?.y ?? 0,
				z: point?.z ?? 0,
				w: point?.w ?? 1,
			};
		}
	};
}

if (!testGlobal.ImageData) {
	testGlobal.ImageData = class ImageData {
		constructor(
			public data: Uint8ClampedArray,
			public width: number,
			public height: number,
		) {}
	};
}

if (!testGlobal.Path2D) {
	testGlobal.Path2D = class Path2D {
		constructor(_path?: string | Path2D) {}
		addPath() {}
		closePath() {}
		moveTo() {}
		lineTo() {}
		bezierCurveTo() {}
		quadraticCurveTo() {}
		rect() {}
		roundRect() {}
		arc() {}
		arcTo() {}
		ellipse() {}
	};
}
