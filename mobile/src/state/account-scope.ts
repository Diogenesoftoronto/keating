/**
 * Account-derived scopes that bind cached learner evidence to a signed-in
 * identity. They are pure functions of the account snapshot.
 */
export type AccountStatus = "loading" | "signed-in" | "signed-out" | string;

export interface AccountScopeInput {
  status: AccountStatus;
  session: { issuer?: string; accountId?: string; scope: string } | null;
  account: { id?: string; did?: string } | null;
  /** Issuer the activity-learning service trusts. */
  activityIssuer: string;
}

/** Changes whenever the signed-in learner changes, invalidating in-flight evidence. */
export function quizIdentityOf({ status, session, account }: AccountScopeInput): string {
  return `${status}:${session?.issuer ?? ""}:${session?.accountId ?? account?.id ?? account?.did ?? ""}`;
}

export interface ActivityAccount {
  scope: string | null;
  granted: boolean;
}

export function activityAccountOf(input: AccountScopeInput): ActivityAccount {
  const { status, session, account, activityIssuer } = input;
  const accountId = session?.accountId ?? account?.did ?? account?.id;
  return {
    scope: status === "signed-in" && session?.issuer === activityIssuer && accountId
      ? JSON.stringify([session.issuer, accountId]) : null,
    granted: !!session?.scope.split(/\s+/).includes("tabular:predict"),
  };
}

/** Null while the account is loading; "device-local" once definitely signed out. */
export function memoryScopeOf({ status, session, account }: AccountScopeInput): string | null {
  const accountId = session?.accountId ?? account?.id ?? account?.did;
  return status === "signed-in" && session?.issuer && accountId
    ? JSON.stringify(["notorganic", session.issuer, accountId]) : status === "signed-out" ? "device-local" : null;
}
