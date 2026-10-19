/** Account-derived identities, mirrored into refs so long-running turns can re-check them. */
import { type MutableRefObject, useRef } from "react";
import { defaultNotOrganicAccountConfig } from "@/lib/notorganic-account/contracts";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";
import {
  type AccountScopeInput,
  type ActivityAccount,
  activityAccountOf,
  memoryScopeOf,
  quizIdentityOf,
} from "@/state/account-scope";

export interface AccountScopes {
  activePedagogy: ReturnType<typeof useNotOrganicAccount>["activePedagogy"];
  activePedagogyRef: MutableRefObject<AccountScopes["activePedagogy"]>;
  quizIdentity: string;
  quizIdentityRef: MutableRefObject<string>;
  activityAccountRef: MutableRefObject<ActivityAccount>;
  memoryScopeRef: MutableRefObject<string | null>;
}

export function useAccountScopes(): AccountScopes {
  const { activePedagogy, session, account, status } = useNotOrganicAccount();
  const input: AccountScopeInput = {
    status,
    session,
    account,
    activityIssuer: defaultNotOrganicAccountConfig().issuer,
  };
  const quizIdentity = quizIdentityOf(input);
  const quizIdentityRef = useRef(quizIdentity);
  const activePedagogyRef = useRef(activePedagogy);
  const activityAccountRef = useRef<ActivityAccount>({ scope: null, granted: false });
  const memoryScopeRef = useRef<string | null>(null);
  quizIdentityRef.current = quizIdentity;
  activePedagogyRef.current = activePedagogy;
  activityAccountRef.current = activityAccountOf(input);
  memoryScopeRef.current = memoryScopeOf(input);
  return { activePedagogy, activePedagogyRef, quizIdentity, quizIdentityRef, activityAccountRef, memoryScopeRef };
}
