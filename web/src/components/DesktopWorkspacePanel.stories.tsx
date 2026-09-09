import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DesktopWorkspacePanel } from "./DesktopWorkspacePanel";
import "./sandbox-view.css";

function fixture(fail = false) {
  const files = new Map([["/workspace/hello.py", "print('Hello from your computer')\n"], ["/workspace/README.md", "# My learning workspace\n"]]);
  let running = false;
  return async (operation: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (fail) throw new Error("The desktop workspace server is unavailable. Reopen the desktop app to reconnect.");
    switch (operation) {
      case "fs.list": return [...files].map(([path, content]) => ({ name: path.split("/").pop(), path, size: content.length, isDir: false }));
      case "fs.read": return { content: files.get(String(payload.path)), encoding: "utf8" };
      case "fs.write": files.set(String(payload.path), String(payload.content)); return { ok: true };
      case "process.list": return [];
      case "process.start": running = true; return { processId: "story-process" };
      case "process.poll": return { processId: "story-process", running, stdout: "Hello from your computer\n", stderr: "", exitCode: running ? null : 0 };
      case "process.write": return { ok: true };
      case "process.stop": running = false; return { processId: "story-process", running: false, stdout: "Hello from your computer\n", stderr: "", exitCode: 0 };
      default: throw new Error(`Unsupported story operation: ${operation}`);
    }
  };
}

const meta = {
  title: "Workspace/Desktop",
  component: DesktopWorkspacePanel,
  args: { workspacePath: "/workspace", execute: fixture() },
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <dialog open className="sandbox-runtime"><div className="runtime-panel"><header className="runtime-header"><div className="runtime-heading"><div><h2>Desktop workspace</h2><p>Native files and processes</p></div></div></header><Story /></div></dialog>],
} satisfies Meta<typeof DesktopWorkspacePanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Files: Story = {};
export const EditAndSave: Story = {
  args: { execute: fixture() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /hello.py/ }));
    const editor = await canvas.findByRole("textbox", { name: "Edit hello.py" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "print(42)");
    await userEvent.click(canvas.getByRole("button", { name: /README.md/ }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Save or discard your edits");
    await expect(editor).toHaveValue("print(42)");
    await userEvent.click(canvas.getByRole("button", { name: "Save file" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Saved on this computer");
    await userEvent.click(canvas.getByRole("button", { name: /README.md/ }));
    await expect(await canvas.findByRole("textbox", { name: "Edit README.md" })).toHaveValue("# My learning workspace\n");
  },
};
export const RunAndStop: Story = {
  args: { execute: fixture() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Commands" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Command" }), "python3 hello.py");
    await userEvent.click(canvas.getByRole("button", { name: "Run command" }));
    await expect(await canvas.findByRole("button", { name: "Stop command" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Stop command" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Exited 0");
    await expect(canvas.getByLabelText("Standard output")).toHaveTextContent("Hello from your computer");
  },
};
export const Unavailable: Story = { args: { execute: fixture(true) } };
export const Mobile: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };
