import type * as SecureStoreModule from "expo-secure-store";

/**
 * The native Courses API is deliberately scoped to the one server-issued
 * account cookie. Keeping it separate from the app state prevents a course
 * identity from ending up in AsyncStorage alongside ordinary UI state.
 */
export const COURSE_ACCOUNT_COOKIE_NAME = "keating_course_account";
const COURSE_ACCOUNT_CREDENTIAL_KEY = "keating.mobile.course-account-cookie.v1";

export interface CourseCredentialStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

function nativeSecureStore(): typeof SecureStoreModule {
  // Metro resolves this at runtime on a native device. Keeping it lazy lets
  // request-level tests replace the credential store without loading React
  // Native's native module into Bun.
  return require("expo-secure-store") as typeof SecureStoreModule;
}

const nativeStore: CourseCredentialStore = {
  getItem: (key) => nativeSecureStore().getItemAsync(key),
  setItem: (key, value) => {
    const secureStore = nativeSecureStore();
    return secureStore.setItemAsync(key, value, {
      keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  deleteItem: (key) => nativeSecureStore().deleteItemAsync(key),
};

let store: CourseCredentialStore = nativeStore;

export function getCourseCredentialStore(): CourseCredentialStore {
  return store;
}

/** Test seam for deterministic request-level tests; never persisted itself. */
export function setCourseCredentialStoreForTests(next: CourseCredentialStore | null): void {
  store = next ?? nativeStore;
}

export function courseAccountCredentialKey(): string {
  return COURSE_ACCOUNT_CREDENTIAL_KEY;
}
