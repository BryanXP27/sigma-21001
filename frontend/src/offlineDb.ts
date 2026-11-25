import type {
  AttendanceRecord,
  Section,
  Student,
  Personnel,
  Guardian,
  Alert,
  Fut,
} from "./types";

const DATABASE_NAME = "sigma-attendance";
const DATABASE_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("sections")) {
        database.createObjectStore("sections", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("students")) {
        database.createObjectStore("students", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("sessions")) {
        database.createObjectStore("sessions", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("attendance")) {
        const attendance = database.createObjectStore("attendance", {
          keyPath: "clientEventId",
        });
        attendance.createIndex("byDate", "date");
        attendance.createIndex("byStudentDate", ["studentId", "date"]);
      }
      if (!database.objectStoreNames.contains("personnel")) {
        database.createObjectStore("personnel", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("guardians")) {
        database.createObjectStore("guardians", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("alerts")) {
        database.createObjectStore("alerts", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("futs")) {
        database.createObjectStore("futs", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestResult<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function cacheRoster(sections: Section[], students: Student[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ["sections", "students"],
        "readwrite",
      );
      const sectionStore = transaction.objectStore("sections");
      const studentStore = transaction.objectStore("students");
      sections.forEach((section) => sectionStore.put(section));
      students.forEach((student) => studentStore.put(student));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readSections() {
  return requestResult<Section[]>("sections", "readonly", (store) =>
    store.getAll(),
  );
}

export async function readStudents(sectionId: string) {
  const students = await requestResult<Student[]>(
    "students",
    "readonly",
    (store) => store.getAll(),
  );
  return students.filter((student) => student.sectionId === sectionId);
}

export async function readAllStudents(): Promise<Student[]> {
  return requestResult<Student[]>("students", "readonly", (store) =>
    store.getAll(),
  );
}

export async function readAttendance(date: string) {
  return requestResult<AttendanceRecord[]>("attendance", "readonly", (store) =>
    store.index("byDate").getAll(date),
  );
}

export async function readAllAttendance() {
  return requestResult<AttendanceRecord[]>("attendance", "readonly", (store) =>
    store.getAll(),
  );
}

export async function saveAttendance(record: AttendanceRecord) {
  await requestResult<IDBValidKey>(
    "attendance",
    "readwrite",
    (store) => store.put(record),
  );
}

export async function saveAttendanceBatch(records: AttendanceRecord[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("attendance", "readwrite");
      const store = transaction.objectStore("attendance");
      records.forEach((record) => store.put(record));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveSession(
  key: string,
  session: { id: string; status: "open" | "closed" } | null,
) {
  await requestResult<IDBValidKey>("sessions", "readwrite", (store) =>
    store.put({ key, session }),
  );
}

export async function readSession(key: string) {
  const result = await requestResult<{
    key: string;
    session: { id: string; status: "open" | "closed" } | null;
  } | undefined>("sessions", "readonly", (store) => store.get(key));
  return result?.session ?? null;
}

export async function deleteAttendance(clientEventId: string) {
  await requestResult<undefined>(
    "attendance",
    "readwrite",
    (store) => store.delete(clientEventId),
  );
}

// Personnel
export async function cachePersonnel(personnel: Personnel[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("personnel", "readwrite");
      const store = transaction.objectStore("personnel");
      personnel.forEach((p) => store.put(p));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readPersonnel(): Promise<Personnel[]> {
  return requestResult<Personnel[]>("personnel", "readonly", (store) =>
    store.getAll(),
  );
}

// Guardians
export async function cacheGuardians(guardians: Guardian[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("guardians", "readwrite");
      const store = transaction.objectStore("guardians");
      guardians.forEach((g) => store.put(g));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readGuardians(): Promise<Guardian[]> {
  return requestResult<Guardian[]>("guardians", "readonly", (store) =>
    store.getAll(),
  );
}

// Alerts
export async function cacheAlerts(alerts: Alert[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("alerts", "readwrite");
      const store = transaction.objectStore("alerts");
      alerts.forEach((a) => store.put(a));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readAlerts(): Promise<Alert[]> {
  return requestResult<Alert[]>("alerts", "readonly", (store) =>
    store.getAll(),
  );
}

// FUTs
export async function cacheFuts(futs: Fut[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("futs", "readwrite");
      const store = transaction.objectStore("futs");
      futs.forEach((f) => store.put(f));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readFuts(): Promise<Fut[]> {
  return requestResult<Fut[]>("futs", "readonly", (store) => store.getAll());
}
