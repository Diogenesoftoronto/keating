import { create } from "zustand";
import {
  loadWebSpeechSettings,
  primeSpeechAudio,
  saveWebSpeechSettings,
  type WebSpeechSettings,
} from "../keating/speech";

const PERSISTENT_STORAGE_STATUS_KEY = "keating:persistent-storage-status";
const PERSISTENT_STORAGE_BANNER_DISMISSED_KEY = "keating:persistent-storage-banner-dismissed";
const SESSION_SIDEBAR_COLLAPSED_KEY = "keating:session-sidebar-collapsed";

export type PersistentStorageStatus = "unknown" | "granted" | "declined";

export interface ForkInfo {
  parentId: string;
  parentTitle: string;
  forkedAt: string;
}

function readSessionSidebarCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(SESSION_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionSidebarCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SESSION_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore storage failures
  }
}

function getPersistentStorageStatus(): PersistentStorageStatus {
  if (typeof localStorage === "undefined") return "unknown";
  try {
    const value = localStorage.getItem(PERSISTENT_STORAGE_STATUS_KEY);
    if (value === "granted" || value === "declined") return value;
    return "unknown";
  } catch {
    return "unknown";
  }
}

function getPersistentBannerDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PERSISTENT_STORAGE_BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePersistentStorageStatus(status: Exclude<PersistentStorageStatus, "unknown">): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERSISTENT_STORAGE_STATUS_KEY, status);
  } catch {
    // Ignore storage failures; the in-memory state still suppresses repeats.
  }
}

function savePersistentBannerDismissed(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERSISTENT_STORAGE_BANNER_DISMISSED_KEY, "1");
  } catch {
    // Ignore storage failures; the in-memory state still hides the banner.
  }
}

interface KeatingAgentStore {
  activeSessionId: string;
  forkingSessionId: string | null;
  forkedSessionId: string | null;
  forkInfo: ForkInfo | null;
  sessionSidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  speechSettings: WebSpeechSettings;
  persistentStorageStatus: PersistentStorageStatus;
  persistentStorageChecked: boolean;
  persistentBannerDismissed: boolean;
  setActiveSessionId: (sessionId: string) => void;
  setForkingSessionId: (sessionId: string | null) => void;
  setForkedSessionId: (sessionId: string | null) => void;
  clearForkedSessionId: (sessionId: string) => void;
  setForkInfo: (forkInfo: ForkInfo | null) => void;
  setSessionSidebarCollapsed: (collapsed: boolean) => void;
  toggleSessionSidebar: () => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  setSpeechSettings: (settings: WebSpeechSettings) => void;
  toggleSpeech: () => void;
  setPersistentStorageStatus: (status: PersistentStorageStatus) => void;
  setPersistentStorageChecked: (checked: boolean) => void;
  dismissPersistentBanner: () => void;
}

export const useKeatingAgentStore = create<KeatingAgentStore>((set, get) => ({
  activeSessionId: "",
  forkingSessionId: null,
  forkedSessionId: null,
  forkInfo: null,
  sessionSidebarCollapsed: readSessionSidebarCollapsed(),
  mobileSidebarOpen: false,
  speechSettings: loadWebSpeechSettings(),
  persistentStorageStatus: getPersistentStorageStatus(),
  persistentStorageChecked: false,
  persistentBannerDismissed: getPersistentBannerDismissed(),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setForkingSessionId: (forkingSessionId) => set({ forkingSessionId }),
  setForkedSessionId: (forkedSessionId) => set({ forkedSessionId }),
  clearForkedSessionId: (sessionId) => {
    if (get().forkedSessionId === sessionId) set({ forkedSessionId: null });
  },
  setForkInfo: (forkInfo) => set({ forkInfo }),
  setSessionSidebarCollapsed: (sessionSidebarCollapsed) => {
    writeSessionSidebarCollapsed(sessionSidebarCollapsed);
    set({ sessionSidebarCollapsed });
  },
  toggleSessionSidebar: () => {
    const sessionSidebarCollapsed = !get().sessionSidebarCollapsed;
    writeSessionSidebarCollapsed(sessionSidebarCollapsed);
    set({ sessionSidebarCollapsed });
  },
  toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  setSpeechSettings: (speechSettings) => {
    const wasEnabled = get().speechSettings.enabled;
    saveWebSpeechSettings(speechSettings);
    if (speechSettings.enabled && !wasEnabled) primeSpeechAudio().catch(console.warn);
    set({ speechSettings });
  },
  toggleSpeech: () => {
    const current = get().speechSettings;
    const speechSettings = { ...current, enabled: !current.enabled };
    saveWebSpeechSettings(speechSettings);
    if (speechSettings.enabled) primeSpeechAudio().catch(console.warn);
    set({ speechSettings });
  },
  setPersistentStorageStatus: (persistentStorageStatus) => set({ persistentStorageStatus }),
  setPersistentStorageChecked: (persistentStorageChecked) => set({ persistentStorageChecked }),
  dismissPersistentBanner: () => {
    savePersistentBannerDismissed();
    set({ persistentBannerDismissed: true });
  },
}));
