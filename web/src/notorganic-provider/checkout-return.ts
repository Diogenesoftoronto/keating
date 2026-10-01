import { isNotOrganicPackId, type NotOrganicPackId } from "./packs";

/** Keep account storage and the learner's session on the originating web host. */
export function notOrganicCheckoutReturnUrl(href: string, packId: NotOrganicPackId): string {
  const current = new URL(href);
  const destination = current.protocol === "https:"
    ? new URL(current.pathname, current.origin)
    : new URL("https://keating.help/pricing");
  if (current.protocol === "https:") {
    for (const key of ["session", "course", "courseMode"]) {
      const value = current.searchParams.get(key);
      if (value) destination.searchParams.set(key, value);
    }
  }
  destination.searchParams.set("checkout", "returned");
  destination.searchParams.set("credit_pack", packId);
  return destination.href;
}

export function notOrganicCheckoutReturn(href: string): { packId?: NotOrganicPackId; cleanHref: string } | null {
  const url = new URL(href);
  if (url.searchParams.get("checkout") !== "returned") return null;
  const pack = url.searchParams.get("credit_pack");
  url.searchParams.delete("checkout");
  url.searchParams.delete("credit_pack");
  return { ...(pack && isNotOrganicPackId(pack) ? { packId: pack } : {}), cleanHref: `${url.pathname}${url.search}${url.hash}` };
}
