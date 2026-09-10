import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CreditRecoveryCard } from "./NotOrganicCreditRecovery";
import { normalizeCreditWallet } from "../notorganic-provider/credit-wallet";

const meta = { title: "Chat/Credit recovery", component: CreditRecoveryCard,
  args: { onRefresh: fn(), onRetry: fn(), onCheckout: fn(), onModelSelect: fn(), wallet: normalizeCreditWallet({ availableMicros: 0 }) },
  decorators: [(Story) => <div style={{ maxWidth: 620, padding: 16 }}><Story /></div>],
} satisfies Meta<typeof CreditRecoveryCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InsufficientFunds: Story = {};
export const RefreshingWallet: Story = { args: { refreshing: true } };
export const CheckoutUnavailable: Story = { args: { initialPackId: "keating_pack_10", checkoutEnabled: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(/purchases aren’t available/)).toBeVisible();
  await expect(canvas.queryByRole("button", { name: /Continue to checkout/ })).not.toBeInTheDocument();
} };
export const ConfiguredPacks: Story = { args: { initialPackId: "keating_pack_10", checkoutEnabled: true, wallet: normalizeCreditWallet({ availableMicros: 0, checkout: { available: true, packIds: ["keating_pack_10", "keating_pack_25", "keating_pack_50"] } }) }, play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("radio", { name: "$25" }));
  await userEvent.click(canvas.getByRole("button", { name: "Continue to checkout · $25" }));
  await expect(args.onCheckout).toHaveBeenCalledWith("keating_pack_25");
} };
export const PaymentPending: Story = { args: { checkoutUrl: "https://checkout.example.test/payment" } };
export const FreeStarterCredit: Story = { args: { wallet: normalizeCreditWallet({ availableMicros: 2_500_000, welcomeCredit: { eligible: false, granted: true, amountMicros: 2_500_000, remainingMicros: 2_500_000 } }) } };
export const RetryReady: Story = { args: { wallet: normalizeCreditWallet({ availableMicros: 10_000_000 }) }, play: async ({ canvasElement, args }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Retry response" }));
  await expect(args.onRetry).toHaveBeenCalledTimes(1);
} };
export const WalletUnavailable: Story = { args: { wallet: undefined, error: "We couldn’t verify your balance. Check your connection and refresh again." } };
export const Mobile: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };
export const ReducedMotion: Story = { decorators: [(Story) => <div data-credit-reduced-motion><style>{"[data-credit-reduced-motion] .keating-credit-sprite { animation: none !important; background-position: 0 0; }"}</style><Story /></div>], args: { refreshing: true } };
