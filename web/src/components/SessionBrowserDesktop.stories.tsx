import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { SessionMetadata } from "../types/session";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import { SessionBrowserDesktop } from "./SessionBrowserDesktop";
import { buildSessionTree } from "./session-tree";
import type { ArtifactHero } from "./session-card-visuals";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function makeSession(
  id: string,
  title: string,
  preview: string,
  hoursAgo: number,
  parentSessionId?: string,
): SessionMetadata {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return {
    id,
    title,
    preview,
    parentSessionId,
    createdAt: date,
    lastModified: date,
    thinkingLevel: "off",
    messageCount: 8,
    usage,
  };
}
const sessions = [
  makeSession(
    "waves",
    "Wave mechanics",
    "What makes a wave travel, and what stays in place?",
    1,
  ),
  makeSession(
    "standing",
    "Standing waves, explained",
    "A guitar string, two fixed ends, and a pattern that stays put.",
    0.3,
    "waves",
  ),
  makeSession(
    "harmonics",
    "Wave harmonics",
    "Why a shorter string makes a higher note.",
    0.5,
    "standing",
  ),
  makeSession(
    "algebra",
    "Linear algebra, visually",
    "Matrices as movements: stretch, rotate, and find what stays the same.",
    22,
  ),
  makeSession(
    "rome",
    "Roman history: the republic",
    "How a system built to share power became an empire.",
    48,
  ),
  makeSession(
    "french",
    "French for a weekend in Montréal",
    "Ordering coffee and finding your way around the city.",
    72,
  ),
];
const heroes = new Map<string, ArtifactHero>([
  [
    "waves",
    { type: "map", types: ["map", "animation"], topic: "Wave mechanics" },
  ],
  ["algebra", { type: "plan", types: ["plan"], topic: "Linear algebra" }],
]);
const store: SessionBrowserSurfaceProps["store"] = {
  items: sessions,
  loading: false,
  error: null,
  query: "",
  setQuery: fn(),
  flatResults: null,
  roots: buildSessionTree(sessions),
  heroes,
  reload: fn(async () => {}),
  rename: fn(async () => {}),
  remove: fn(async () => {}),
};

function PanelDemo(args: SessionBrowserSurfaceProps) {
  const [items, setItems] = useState(args.store.items);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(args.collapsed ?? false);
  const [active, setActive] = useState(args.activeSessionId);
  const roots = useMemo(() => buildSessionTree(items), [items]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (
    <div style={{ display: "flex", height: "100dvh", minWidth: 0 }}>
      <SessionBrowserDesktop
        {...args}
        activeSessionId={active}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onNewSession={() => {
          args.onNewSession?.();
          const session = makeSession(
            `new-${items.length}`,
            "New session",
            "",
            0,
          );
          setItems((current) => [session, ...current]);
          setActive(session.id);
        }}
        onLoad={async (id) => {
          await args.onLoad(id);
          setActive(id);
        }}
        onFork={async (id) => {
          await args.onFork(id);
          const parent = items.find((item) => item.id === id);
          if (parent) {
            const session = makeSession(
              `fork-${items.length}`,
              `${parent.title} (fork)`,
              parent.preview,
              0,
              id,
            );
            setItems((current) => [session, ...current]);
            setActive(session.id);
          }
        }}
        store={{
          ...args.store,
          items,
          roots,
          query,
          setQuery,
          flatResults: terms.length
            ? items.filter((item) =>
                terms.every((term) =>
                  `${item.title} ${item.preview}`.toLowerCase().includes(term),
                ),
              )
            : null,
          rename: async (id, title) => {
            await args.store.rename(id, title);
            setItems((current) =>
              current.map((item) =>
                item.id === id ? { ...item, title } : item,
              ),
            );
          },
          remove: async (id) => {
            await args.store.remove(id);
            setItems((current) => current.filter((item) => item.id !== id));
          },
        }}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: "clamp(16px, 5vw, 72px)",
          background: "var(--background)",
        }}
      >
        <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
          Continue learning
        </p>
        <h1
          style={{
            fontSize: "clamp(24px, 3vw, 40px)",
            maxWidth: "18ch",
            lineHeight: 1.2,
          }}
        >
          {items.find((item) => item.id === active)?.title ||
            "Follow your curiosity."}
        </h1>
      </main>
    </div>
  );
}
const meta = {
  title: "Sessions/Side panel",
  component: SessionBrowserDesktop,
  parameters: { layout: "fullscreen" },
  args: {
    store,
    activeSessionId: "standing",
    onLoad: fn(),
    onFork: fn(),
    onNewSession: fn(),
    onSuggestTitle: fn(async () => "Waves, from motion to music"),
  },
  render: (args) => <PanelDemo {...args} />,
} satisfies Meta<typeof SessionBrowserDesktop>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Library: Story = {};
export const LatestForkHandlers: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    for (let count = 1; count <= 2; count += 1) {
      await userEvent.click(canvas.getByRole("button", { name: "Actions for Wave mechanics" }));
      await userEvent.click(canvas.getByRole("button", { name: "Fork session" }));
      await expect(canvas.findAllByRole("button", { name: "Open session Wave mechanics (fork)" })).resolves.toHaveLength(count);
    }
    await expect(args.onFork).toHaveBeenCalledTimes(2);
  },
};
export const Collapsed: Story = { args: { collapsed: true } };
export const Empty: Story = {
  args: { store: { ...store, items: [], roots: [], heroes: new Map() } },
};
export const SearchKeepsAncestry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search sessions" }),
      "harmonics",
    );
    for (const name of [
      "Wave mechanics",
      "Standing waves, explained",
      "Wave harmonics",
    ]) {
      await expect(
        canvas.getByRole("button", { name: `Open session ${name}` }),
      ).toBeVisible();
    }
    await expect(
      canvas.queryByRole("button", {
        name: "Open session Roman history: the republic",
      }),
    ).not.toBeInTheDocument();
  },
};
export const KeyboardAndResize: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resize = canvas.getByRole("separator", {
      name: "Resize session panel",
    });
    resize.focus();
    await userEvent.keyboard("{Home}");
    await expect(resize).toHaveAttribute("aria-valuenow", "288");
    await userEvent.keyboard("{ArrowRight}");
    await expect(resize).toHaveAttribute("aria-valuenow", "312");
    const tree = canvas.getByRole("tree", { name: "Session library" });
    tree.focus();
    await userEvent.keyboard("{Home}{ArrowRight}");
    await expect(tree).toHaveAttribute(
      "aria-activedescendant",
      expect.stringContaining("standing"),
    );
    await userEvent.click(canvas.getByRole("button", { name: "New session" }));
    await expect(
      canvas.getByRole("button", { name: "Open session New session" }),
    ).toBeVisible();
  },
};
