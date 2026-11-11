/**
 * On-device storage for self-paced courses: the plans, the evidence, the
 * prepared materials and the preparation jobs. Its own IndexedDB database, so
 * it never forces a migration of the main learner database.
 *
 * Every write rejects on failure; callers surface that instead of dropping
 * learner work silently.
 */
import type { ActivityMaterial, CourseEvidence, SelfPacedCourse } from "./contract";
import type { PrepJob } from "./jobs";

const DB_NAME = "keating-self-paced";
const DB_VERSION = 1;
const STORES = { courses: "courses", evidence: "evidence", materials: "materials", jobs: "jobs" } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

export const SELF_PACED_CHANGED_EVENT = "keating:self-paced-changed";

export interface SelfPacedStore {
	listCourses(): Promise<SelfPacedCourse[]>;
	getCourse(id: string): Promise<SelfPacedCourse | undefined>;
	putCourse(course: SelfPacedCourse): Promise<void>;
	deleteCourse(id: string): Promise<void>;
	listEvidence(courseId: string): Promise<CourseEvidence[]>;
	addEvidence(evidence: CourseEvidence): Promise<void>;
	listMaterials(courseId: string): Promise<ActivityMaterial[]>;
	putMaterial(material: ActivityMaterial): Promise<void>;
	listJobs(courseId?: string): Promise<PrepJob[]>;
	putJob(job: PrepJob): Promise<void>;
	deleteJob(id: string): Promise<void>;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		value.onsuccess = () => resolve(value.result);
		value.onerror = () => reject(value.error ?? new Error("Storage request failed"));
	});
}

function announce(): void {
	try { window.dispatchEvent(new CustomEvent(SELF_PACED_CHANGED_EVENT)); } catch { /* No window outside the browser. */ }
}

export function createSelfPacedStore(factory: IDBFactory = indexedDB, name = DB_NAME): SelfPacedStore {
	let opened: Promise<IDBDatabase> | null = null;
	const open = (): Promise<IDBDatabase> => {
		opened ??= new Promise<IDBDatabase>((resolve, reject) => {
			const opening = factory.open(name, DB_VERSION);
			opening.onupgradeneeded = () => {
				const db = opening.result;
				if (!db.objectStoreNames.contains(STORES.courses)) db.createObjectStore(STORES.courses, { keyPath: "id" });
				for (const store of [STORES.evidence, STORES.materials, STORES.jobs]) {
					if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" }).createIndex("courseId", "courseId");
				}
			};
			opening.onsuccess = () => {
				opening.result.onversionchange = () => { opening.result.close(); opened = null; };
				resolve(opening.result);
			};
			opening.onerror = () => { opened = null; reject(opening.error ?? new Error("Course storage could not be opened")); };
			opening.onblocked = () => { opened = null; reject(new Error("Course storage is in use by another tab")); };
		});
		return opened;
	};
	const read = async <T>(store: StoreName, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
		request(run((await open()).transaction(store, "readonly").objectStore(store)));
	// Resolve on transaction completion, not request success: only then is the write durable.
	const write = async (stores: StoreName[], run: (transaction: IDBTransaction) => void): Promise<void> => {
		const transaction = (await open()).transaction(stores, "readwrite");
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error ?? new Error("Course storage write failed"));
			transaction.onabort = () => reject(transaction.error ?? new Error("Course storage write was aborted"));
			run(transaction);
		});
		announce();
	};
	const byCourse = <T>(store: StoreName, courseId: string) =>
		read<T[]>(store, (objectStore) => objectStore.index("courseId").getAll(courseId) as IDBRequest<T[]>);

	return {
		listCourses: async () => (await read<SelfPacedCourse[]>(STORES.courses, (store) => store.getAll())).sort((a, b) => b.updatedAt - a.updatedAt),
		getCourse: (id) => read<SelfPacedCourse | undefined>(STORES.courses, (store) => store.get(id)),
		putCourse: (course) => write([STORES.courses], (transaction) => { transaction.objectStore(STORES.courses).put(course); }),
		// A course and everything prepared or recorded for it go together.
		deleteCourse: (id) => write([STORES.courses, STORES.evidence, STORES.materials, STORES.jobs], (transaction) => {
			transaction.objectStore(STORES.courses).delete(id);
			for (const store of [STORES.evidence, STORES.materials, STORES.jobs]) {
				const cursor = transaction.objectStore(store).index("courseId").openKeyCursor(IDBKeyRange.only(id));
				cursor.onsuccess = () => {
					const current = cursor.result;
					if (!current) return;
					transaction.objectStore(store).delete(current.primaryKey);
					current.continue();
				};
			}
		}),
		listEvidence: async (courseId) => (await byCourse<CourseEvidence>(STORES.evidence, courseId)).sort((a, b) => a.at - b.at),
		addEvidence: (evidence) => write([STORES.evidence], (transaction) => { transaction.objectStore(STORES.evidence).put(evidence); }),
		listMaterials: (courseId) => byCourse<ActivityMaterial>(STORES.materials, courseId),
		putMaterial: (material) => write([STORES.materials], (transaction) => { transaction.objectStore(STORES.materials).put(material); }),
		listJobs: async (courseId) => (courseId
			? await byCourse<PrepJob>(STORES.jobs, courseId)
			: await read<PrepJob[]>(STORES.jobs, (store) => store.getAll())).sort((a, b) => a.createdAt - b.createdAt),
		putJob: (job) => write([STORES.jobs], (transaction) => { transaction.objectStore(STORES.jobs).put(job); }),
		deleteJob: (id) => write([STORES.jobs], (transaction) => { transaction.objectStore(STORES.jobs).delete(id); }),
	};
}

let shared: SelfPacedStore | null = null;
export function selfPacedStore(): SelfPacedStore {
	shared ??= createSelfPacedStore();
	return shared;
}
