import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { SessionMetadata } from "../types/session";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import { SessionBrowserSheet } from "./SessionBrowserSheet";
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

function LibraryDemo(args: SessionBrowserSurfaceProps) {
  const [items, setItems] = useState(args.store.items);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(args.activeSessionId);
  const roots = useMemo(() => buildSessionTree(items), [items]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const flatResults = terms.length
    ? items.filter((session) =>
        terms.every((term) =>
          `${session.title} ${session.preview}`.toLowerCase().includes(term),
        ),
      )
    : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: 16 }}
      >
        Open session library
      </button>
      {open ? (
        <SessionBrowserSheet
          {...args}
          activeSessionId={active}
          onMobileClose={() => {
            args.onMobileClose?.();
            setOpen(false);
          }}
          onLoad={async (id) => {
            await args.onLoad(id);
            setActive(id);
          }}
          onFork={async (id) => {
            await args.onFork(id);
            const parent = items.find((session) => session.id === id);
            if (parent)
              setItems((current) => [
                makeSession(
                  `fork-${current.length}`,
                  `${parent.title} (fork)`,
                  parent.preview,
                  0,
                  parent.id,
                ),
                ...current,
              ]);
          }}
          store={{
            ...args.store,
            items,
            roots,
            query,
            setQuery,
            flatResults,
            rename: async (id, title) => {
              await args.store.rename(id, title);
              setItems((current) =>
                current.map((session) =>
                  session.id === id ? { ...session, title } : session,
                ),
              );
            },
            remove: async (id) => {
              await args.store.remove(id);
              setItems((current) =>
                current.filter((session) => session.id !== id),
              );
            },
          }}
        />
      ) : null}
    </>
  );
}

const meta = {
  title: "Sessions/Library",
  component: SessionBrowserSheet,
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    store,
    activeSessionId: "standing",
    onLoad: fn(),
    onFork: fn(),
    onMobileClose: fn(),
    onNewSession: fn(),
    onSuggestTitle: fn(async () => "Waves, from motion to music"),
  },
  render: (args) => <LibraryDemo {...args} />,
} satisfies Meta<typeof SessionBrowserSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {};
export const SearchKeepsAncestry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search sessions" }),
      "harmonics",
    );
    await expect(
      canvas.getByRole("button", { name: "Open session Wave mechanics" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: "Open session Standing waves, explained",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Open session Wave harmonics" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", {
        name: "Open session Roman history: the republic",
      }),
    ).not.toBeInTheDocument();
  },
};
export const RenameAndFork: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Actions for Wave mechanics" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Rename" }));
    const title = canvas.getByRole("textbox", { name: "Session title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Physics at the beach");
    await userEvent.click(canvas.getByRole("button", { name: "Save title" }));
    await expect(
      canvas.getByRole("button", { name: "Open session Physics at the beach" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Actions for Physics at the beach" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Fork session" }));
    await expect(
      canvas.getByRole("button", {
        name: "Open session Physics at the beach (fork)",
      }),
    ).toBeVisible();
  },
};
export const Empty: Story = {
  args: { store: { ...store, items: [], roots: [], heroes: new Map() } },
};
export const Loading: Story = { args: { store: { ...store, loading: true } } };
export const LongTitlesAndDeepForks: Story = {
  args: {
    store: {
      ...store,
      items: [
        ...sessions,
        makeSession(
          "deep",
          "Physics: understanding superposition, interference, and the surprising behavior of waves in everyday life",
          "A closer look at what changes when the waves meet. Follow the original explanation all the way back to its source.",
          0.1,
          "harmonics",
        ),
      ],
    },
    activeSessionId: "deep",
  },
};
