/** Transient per-tab receipts. No copied card text or learner answers, no canonical learner writes. */
import { projectStudyEstimate, type StudySnapshot, type StudyEstimateReceipt } from "./study-estimates";

const KEY = "keating:study-estimates:session:v1";
type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class StudyEstimateStore {
  constructor(private readonly storage: SessionStore | null = typeof sessionStorage === "undefined" ? null : sessionStorage) {}
  private read(): StudyEstimateReceipt[] {
    try { const raw = this.storage?.getItem(KEY); const rows = raw && raw.length <= 256_000 ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows.filter(row => row?.version === 1 && typeof row.deckId === "string") : [];
    } catch { return []; }
  }
  save(receipt: StudyEstimateReceipt): void {
    const rows = [...this.read().filter(row => row.deckId !== receipt.deckId), receipt].slice(-12);
    const json = JSON.stringify(rows);
    if (json.length > 256_000) return;
    try { this.storage?.setItem(KEY, json); } catch { /* A receipt cannot block review. */ }
  }
  deckIds(): string[] { return this.read().map(row => row.deckId); }
  current(snapshot: StudySnapshot, now = Date.now()): StudyEstimateReceipt | null {
    const row = this.read().find(row => row.deckId === snapshot.deckId);
    if (!row) return null;
    if (!Number.isFinite(row.createdAt) || row.createdAt > now || now - row.createdAt > 86_400_000
      || row.sourceDigest !== snapshot.sourceDigest || row.questionsDigest !== snapshot.questionsDigest
      || JSON.stringify(row.cardIds) !== JSON.stringify(snapshot.cardIds)) { this.remove(snapshot.deckId); return null; }
    try { return projectStudyEstimate(snapshot, row.response, row.createdAt); } catch { this.remove(snapshot.deckId); return null; }
  }
  remove(deckId: string): void { try { this.storage?.setItem(KEY, JSON.stringify(this.read().filter(row => row.deckId !== deckId))); } catch { /* Optional. */ } }
  clear(): void { try { this.storage?.removeItem(KEY); } catch { /* Optional. */ } }
}
