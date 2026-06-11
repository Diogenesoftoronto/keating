import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownBlock } from "./MarkdownBlock";

const meta = {
	title: "Data/MarkdownBlock",
	component: MarkdownBlock,
	args: {
		content: "## Hello world\n\nThis is a simple paragraph with **bold** and *italic* text.",
	},
} satisfies Meta<typeof MarkdownBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Basic: Story = {};

export const WithJavascript: Story = {
	args: {
		content: `
## JavaScript Example
\`\`\`javascript
const fib = (n) => {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
};

console.log("fib(10) =", fib(10));
\`\`\`
`,
	},
};

export const WithTypescript: Story = {
	args: {
		content: `
## TypeScript Example
\`\`\`typescript
type Point = { x: number; y: number };

const dist = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

console.log(dist({ x: 0, y: 0 }, { x: 3, y: 4 }));
\`\`\`
`,
	},
};

export const WithPython: Story = {
	args: {
		content: `
## Python Example
\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

for i in range(6):
    print(f"{i}! = {factorial(i)}")
\`\`\`

Click **Run** to execute via Pyodide (WASM Python loaded on demand).
`,
	},
};

export const WithRust: Story = {
	args: {
		content: `
## Rust Example (non-executable)
\`\`\`rust
fn main() {
    let msg = "Hello from Rust!";
    println!("{}", msg);
}
\`\`\`
`,
	},
};

export const WithGo: Story = {
	args: {
		content: `
## Go Example (non-executable)
\`\`\`go
package main

import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}
\`\`\`
`,
	},
};

export const LessonPlan: Story = {
	args: {
		content: `# Lesson Plan: Derivative

- Domain: math
- Policy: keating-default
- Summary: The derivative measures how a quantity changes at an instant.

## Orientation
Assess prerequisites and frame the core question.

- State the big question: The derivative measures how a quantity changes at an instant.
- Recall functions and connect it to Derivative.
- Recall limits and connect it to Derivative.
- Recall slope and connect it to Derivative.

## Intuition
Teach the concept concretely before pushing notation or abstract framing.

- Intuition: Start with average change over an interval, then shrink the interval toward a point.
- Intuition: Connect slope-of-a-graph intuition to motion: velocity is the derivative of position.

## Code Example
\`\`\`javascript
function derivative(f, h = 1e-5) {
  return (x) => (f(x + h) - f(x - h)) / (2 * h);
}

const f = (x) => x * x;
const df = derivative(f);

console.log("f'(3) ≈", df(3));
console.log("Expected: 6");
\`\`\`
`,
	},
};

export const WithCodeBlock: Story = {
	args: {
		content: `Here is a recursive factorial in Python:

\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(f"5! = {factorial(5)}")
\`\`\`

And call it like \`factorial(5)\`. You can also use JavaScript:

\`\`\`javascript
const factorial = (n) => n <= 1 ? 1 : n * factorial(n - 1);
console.log("5! =", factorial(5));
\`\`\`

Or TypeScript with types:

\`\`\`typescript
const factorial = (n: number): number => n <= 1 ? 1 : n * factorial(n - 1);
console.log("5! =", factorial(5));
\`\`\`
`,
	},
};

export const WithTable: Story = {
	args: {
		content: `| Metric | Value | Target |
| --- | ---: | ---: |
| Mastery | 0.72 | 0.70 |
| Retention | 0.65 | 0.60 |
| Engagement | 0.81 | 0.75 |
| Transfer | 0.58 | 0.55 |`,
	},
};

export const WithMath: Story = {
	args: {
		content: `The quadratic formula is:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

And the derivative of $f(x) = x^2$ is $f'(x) = 2x$.`,
	},
};

export const WithBlockquote: Story = {
	args: {
		content: `> "That the powerful play goes on, and you may contribute a verse."
>
> — Whitman`,
	},
};

export const LongContent: Story = {
	args: {
		content: Array.from(
			{ length: 10 },
			(_, i) =>
				`## Section ${i + 1}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\n- Bullet one\n- Bullet two\n- Bullet three\n`,
		).join("\n"),
	},
};
