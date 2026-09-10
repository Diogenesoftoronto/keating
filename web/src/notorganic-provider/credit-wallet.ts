import { NOTORGANIC_PACKS, type NotOrganicPack } from "./packs";

export interface CreditWallet {
  availableMicros: number;
  blocked: boolean;
  checkout: { available: boolean; packIds: string[]; planIds?: string[] };
  welcomeCredit?: { eligible: boolean; granted: boolean; amountMicros: number; remainingMicros: number };
}

function micros(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Prefer the gateway's product-scoped available balance. Never sum unscoped grants. */
export function normalizeCreditWallet(input: unknown): CreditWallet {
  if (!input || typeof input !== "object") throw new Error("Your balance could not be verified.");
  const value = input as Record<string, any>;
  if (value.availableMicros !== undefined && !micros(value.availableMicros)) throw new Error("Your balance could not be verified.");
  const cash = value.balanceMicros ?? value.balance_microusd;
  const held = value.reservedMicros ?? 0;
  const available = micros(value.availableMicros) ? value.availableMicros
    : micros(cash) && micros(held) ? Math.max(0, cash - held) : undefined;
  if (available === undefined) throw new Error("Your balance could not be verified.");
  const welcome = value.welcomeCredit;
  return {
    availableMicros: available,
    blocked: value.hostedInferenceBlocked === true || (typeof value.debtMicros === "number" && value.debtMicros > 0),
    checkout: {
      available: value.checkout?.available === true,
      planIds: Array.isArray(value.checkout?.planIds) ? value.checkout.planIds.filter((id: unknown): id is string => typeof id === "string") : [],
      packIds: Array.isArray(value.checkout?.packIds) ? value.checkout.packIds.filter((id: unknown): id is string => typeof id === "string") : [],
    },
    ...(welcome && typeof welcome.eligible === "boolean" && typeof welcome.granted === "boolean"
      && micros(welcome.amountMicros) && micros(welcome.remainingMicros)
      ? { welcomeCredit: { eligible: welcome.eligible, granted: welcome.granted, amountMicros: welcome.amountMicros, remainingMicros: welcome.remainingMicros } } : {}),
  };
}

export function canRetryWithWallet(wallet: CreditWallet | undefined, requiredMicros: number): boolean {
  return !!wallet && !wallet.blocked && Number.isSafeInteger(requiredMicros) && requiredMicros > 0
    && wallet.availableMicros >= requiredMicros;
}

export function availableCreditPacks(wallet: CreditWallet | undefined, locallyEnabled: boolean): NotOrganicPack[] {
  return locallyEnabled && wallet?.checkout.available
    ? NOTORGANIC_PACKS.filter(pack => wallet.checkout.packIds.includes(pack.id)) : [];
}

export function formatCreditBalance(amountMicros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountMicros / 1_000_000);
}
