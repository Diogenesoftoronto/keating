import type { Meta, StoryObj } from "@storybook/react-vite";
import { WebSearchPart } from "./WebSearchPart";

const meta = { title: "Chat/Web search", component: WebSearchPart, args: { toolName: "web_search" }, decorators: [(Story) => <div style={{ maxWidth: 620, padding: 16 }}><Story /></div>] } satisfies Meta<typeof WebSearchPart>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Searching: Story = { args: { args: { query: "How does linear attention reduce memory use?" }, status: { type: "running" } } };
export const Sources: Story = { args: { args: { query: "Linear attention architecture and implementation" }, result: { citations: [
  { title: "Linear Transformers Are Secretly Fast Weight Programmers", url: "https://arxiv.org/abs/2102.11174", snippet: "A connection between linear attention and fast weight memory." },
  { title: "Transformers are RNNs: Fast Autoregressive Transformers with Linear Attention", url: "https://arxiv.org/abs/2006.16236", snippet: "An implementation of attention with linear complexity." },
  { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" },
  { title: "PyTorch documentation", url: "https://docs.pytorch.org/" },
] } } };
export const Failed: Story = { args: { args: { query: "Linear attention paper" }, isError: true, result: { message: "The search provider rejected the saved credential (401)." } } };
export const NoSources: Story = { args: { result: { text: "The provider returned an answer without citations." } } };
export const Narrow: Story = { ...Sources, decorators: [(Story) => <div style={{ width: 290 }}><Story /></div>] };
