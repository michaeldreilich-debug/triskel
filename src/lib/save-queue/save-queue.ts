/**
 * Speicher-Warteschlange (E3, E4 – Grundlage für „Nie Daten verlieren“).
 *
 * - Debounce: Änderungen werden gesammelt und nach `debounceMs` Ruhe gespeichert.
 * - Zusammenführen: mehrere Änderungen am selben Datensatz (table + id) werden zu einer
 *   Operation (spätere Werte gewinnen); die Position in der Reihenfolge bleibt die der ersten.
 * - Reihenfolge: Es ist immer höchstens ein Paket unterwegs. Änderungen an einem Datensatz
 *   überholen sich daher nie, und Pakete behalten die Reihenfolge des ersten Eintragens
 *   (z. B. Notiz vor ihren Blöcken).
 * - Wiederholung: Fehler → erneuter Versuch mit exponentiellem Backoff, unbegrenzt.
 *   Dauerhafte Fehler (isRetryable = false) werden isoliert: das Paket wird einzeln
 *   wiederholt, nur die fehlerhafte Operation landet in `failed` (bleibt gespeichert).
 * - Spiegel in localStorage: alles Unbestätigte (wartend, unterwegs, fehlgeschlagen) liegt
 *   synchron im Speicher und wird beim nächsten Start mit `restore()` nachgeholt.
 * - Mehrere Tabs (mit `tabId`, D-1): jeder Tab spiegelt unter eigenem Schlüssel
 *   (`<storageKey>:tab:<tabId>`) und übernimmt beim Start nur Verwaistes – Spiegel eines
 *   geschlossenen Tabs (pagehide, `markClosed`) oder ohne Herzschlag seit `staleMs` (Absturz,
 *   vom Browser verworfen) sowie den einen Schlüssel der Vorgängerversion. Der Übernehmende
 *   hinterlässt eine Marke; wacht der alte Tab doch wieder auf (`resume`), verwirft er die
 *   übernommenen Operationen, statt sie ein zweites Mal (und älter) zu senden.
 *
 * Die eigentliche Speicherung (`persist`) ist austauschbar; in Session A2 kommt der
 * Supabase-Persister (Upsert ganzer Zeilen bzw. Update, idempotent).
 */

export type SaveMode = "upsert" | "update";

export interface SaveOp {
  table: string;
  id: string;
  values: Record<string, unknown>;
  /** upsert = ganze Zeile (anlegen oder ersetzen), update = nur diese Felder ändern */
  mode: SaveMode;
  /** Zeitpunkt des Eintragens (ms) – zum Abgleich mit `updated_at` auf dem Server (V-4) */
  at?: number;
  /**
   * Aus einem verwaisten Spiegel bzw. der letzten Sitzung übernommen (V-4): Der Persister wendet
   * sie nicht an, wenn die Zeile auf dem Server seitdem geändert wurde – sie landet dann in
   * „fehlgeschlagen“, wo der Nutzer sie trotzdem anwenden oder verwerfen kann.
   */
  adopted?: boolean;
}

/** `navigator.locks` (Web Locks API) – im Test gespielt, in Node nicht vorhanden. */
export interface LockManagerLike {
  request(
    name: string,
    options: { mode: "exclusive" | "shared" },
    callback: () => Promise<unknown> | unknown,
  ): Promise<unknown>;
  query?(): Promise<{ held?: Array<{ name?: string | null }> | null }>;
}

export type SaveStatus = "idle" | "pending" | "saving" | "retrying" | "offline" | "error";

export interface SaveQueueSnapshot {
  status: SaveStatus;
  /** wartende + gerade gesendete Operationen */
  pending: number;
  /** dauerhaft fehlgeschlagene Operationen (bleiben gespeichert, siehe retryFailed) */
  failed: number;
  attempts: number;
  lastError: string | null;
  lastSavedAt: number | null;
  /** localStorage nicht beschreibbar (z. B. voll) */
  storageError: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** zum Auffinden verwaister Tab-Spiegel (localStorage hat beides) */
  readonly length?: number;
  key?(index: number): string | null;
}

export interface SaveQueueOptions {
  persist: (batch: SaveOp[]) => Promise<void>;
  storage?: StorageLike | null;
  storageKey?: string;
  debounceMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** false = dauerhafter Fehler (z. B. Constraint-Verletzung), wird nicht endlos wiederholt */
  isRetryable?: (error: unknown) => boolean;
  isOnline?: () => boolean;
  now?: () => number;
  /**
   * Dauerhafter Fehler, nach dem die Op gegenstandslos ist (z. B. Zurückholen eines inzwischen
   * endgültig gelöschten Datensatzes, D-9): verwerfen statt in `failed` legen.
   */
  isObsolete?: (op: SaveOp, error: unknown) => boolean;
  /** gemeldet, wenn eine Op als gegenstandslos verworfen wurde */
  onObsolete?: (op: SaveOp) => void;
  /**
   * Reihenfolge, in der ein Paket nach einem dauerhaften Fehler einzeln gesendet wird – die des
   * Persisters (D-10); ohne: Reihenfolge des Eintragens.
   */
  order?: (batch: SaveOp[]) => SaveOp[];
  /** eigener Spiegel je Tab (D-1); ohne: ein Schlüssel für alle (Testseiten) */
  tabId?: string;
  /** Spiegel ohne Herzschlag gilt nach so vielen ms als verwaist */
  staleMs?: number;
  /** so oft erneuert ein Tab mit Unbestätigtem seinen Zeitstempel */
  heartbeatMs?: number;
  /**
   * Web Locks (V-4/V-12): Jeder Tab hält eine Sperre `<storageKey>:tab:<tabId>`, solange er lebt –
   * ein Spiegel ohne gehaltene Sperre ist sofort verwaist (kein Warten auf `staleMs`); die
   * Übernahme selbst läuft unter einer exklusiven Sperre, damit nie zwei Tabs denselben Spiegel
   * übernehmen. Standard: `navigator.locks`, wenn vorhanden; null = aus.
   */
  locks?: LockManagerLike | null;
}

interface StoredState {
  v: 1;
  entries: SaveOp[];
  failed: SaveOp[];
  /** letzter Herzschlag des Tabs (nur mit tabId) */
  at?: number;
  /** Tab wurde verlassen (pagehide) – darf sofort übernommen werden */
  closed?: boolean;
  /** Marke: ein anderer Tab hat diesen Stand übernommen */
  adoptedBy?: string;
}

const STORAGE_VERSION = 1;
/** Übernahme-Marken toter Tabs nach einem Tag wegräumen */
const TOMBSTONE_MS = 24 * 60 * 60 * 1000;

export function opKey(op: Pick<SaveOp, "table" | "id">): string {
  return `${op.table}:${op.id}`;
}

/** Zwei Operationen am selben Datensatz zusammenführen (spätere Werte gewinnen). */
export function mergeOps(earlier: SaveOp, later: SaveOp): SaveOp {
  const at = later.at ?? earlier.at;
  // eine eigene, frische Änderung an derselben Zeile hebt die Übernahme-Marke auf: Sie entstand
  // mit dem aktuellen Stand im Blick; nur Übernommenes bleibt Übernommenes
  const adopted = earlier.adopted === true && later.adopted === true;
  return {
    table: earlier.table,
    id: earlier.id,
    values: { ...earlier.values, ...later.values },
    mode: earlier.mode === "upsert" || later.mode === "upsert" ? "upsert" : "update",
    ...(at !== undefined ? { at } : {}),
    ...(adopted ? { adopted } : {}),
  };
}

function cloneOp(op: SaveOp): SaveOp {
  return {
    table: op.table,
    id: op.id,
    mode: op.mode,
    values: { ...op.values },
    ...(op.at !== undefined ? { at: op.at } : {}),
    ...(op.adopted ? { adopted: true } : {}),
  };
}

const defaultLocks = (): LockManagerLike | null =>
  typeof navigator !== "undefined" && "locks" in navigator && navigator.locks
    ? (navigator.locks as unknown as LockManagerLike)
    : null;

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export class SaveQueue {
  private readonly persistFn: SaveQueueOptions["persist"];
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly debounceMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly isRetryable: (error: unknown) => boolean;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;
  private readonly isObsolete: (op: SaveOp, error: unknown) => boolean;
  private readonly onObsolete: (op: SaveOp) => void;
  private readonly order: (batch: SaveOp[]) => SaveOp[];
  private readonly beforeFlush = new Set<() => void>();
  /** Editoren mit entprellter, noch nicht übergebener Eingabe */
  private readonly dirty = new Set<object>();
  private readonly tabId: string | null;
  /** Schlüssel des eigenen Spiegels (mit tabId je Tab) */
  private readonly ownKey: string;
  private readonly staleMs: number;
  private readonly heartbeatMs: number;
  private readonly locks: LockManagerLike | null;
  /** Zeitpunkt des letzten Eintragens je Datensatz – geht nur in den Spiegel (V-4) */
  private readonly ats = new Map<string, number>();
  /** die eigene Tab-Sperre freigeben (dispose) */
  private releaseTabLock: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private restored = false;

  /** wartende Operationen in Reihenfolge des ersten Eintragens */
  private pending = new Map<string, SaveOp>();
  private inflight: SaveOp[] | null = null;
  private inflightPromise: Promise<void> | null = null;
  private failed = new Map<string, SaveOp>();
  /** nach einem dauerhaften Fehler: so viele Operationen einzeln senden */
  private isolateRemaining = 0;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private lastError: string | null = null;
  private lastSavedAt: number | null = null;
  /** Anzahl bestätigter Pakete (für Abfragen: wurde während des Ladens gespeichert?) */
  private persisted = 0;
  private storageError = false;
  private disposed = false;
  /** Anzahl beim Erzeugen aus localStorage übernommener Operationen */
  private recovered = 0;

  private listeners = new Set<() => void>();
  private snapshot: SaveQueueSnapshot;

  constructor(options: SaveQueueOptions) {
    this.persistFn = options.persist;
    this.storage = options.storage ?? null;
    this.storageKey = options.storageKey ?? "sz:save-queue";
    this.debounceMs = options.debounceMs ?? 500;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
    this.isRetryable = options.isRetryable ?? (() => true);
    this.isOnline = options.isOnline ?? (() => true);
    this.now = options.now ?? Date.now;
    this.isObsolete = options.isObsolete ?? (() => false);
    this.onObsolete = options.onObsolete ?? (() => {});
    this.order = options.order ?? ((batch) => batch);
    this.tabId = options.tabId ?? null;
    this.ownKey = this.tabId ? `${this.storageKey}:tab:${this.tabId}` : this.storageKey;
    this.staleMs = options.staleMs ?? 120_000;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.locks = options.locks === undefined ? defaultLocks() : options.locks;
    // Ein Schlüssel für alle: Gespeichertes sofort übernehmen – so überschreibt keine neue
    // Eingabe den Stand der letzten Sitzung, auch wenn restore() erst später aufgerufen wird.
    // Je Tab erst in restore(): Der Konstruktor darf nichts schreiben (React erzeugt im
    // Entwicklungsmodus zwei Instanzen und verwirft eine), und Übernommenes ist älter als alles,
    // was bis dahin eingereiht wurde.
    if (!this.tabId) {
      const stored = this.readStorage(this.storageKey);
      if (stored) this.adopt(stored);
    }
    this.snapshot = this.computeSnapshot();
  }

  /* ------------------------------------------------------------------ */
  /* öffentliche API                                                     */
  /* ------------------------------------------------------------------ */

  enqueue(op: SaveOp): void {
    if (this.disposed) throw new Error("SaveQueue wurde beendet.");
    this.dropIfAdopted();
    const key = opKey(op);
    const existing = this.pending.get(key);
    const incoming = cloneOp(op);
    // Zeitpunkt nur im Spiegel (V-4), nicht an der Op selbst – Pakete bleiben wie bisher
    this.ats.set(key, incoming.at ?? this.now());
    this.pending.set(key, existing ? mergeOps(existing, incoming) : incoming);
    this.writeStorage();
    // während eines Backoffs nicht vorzeitig senden – der Wiederholungs-Timer nimmt alles mit
    if (!this.retryTimer) this.scheduleDebounce(this.debounceMs);
    this.emit();
  }

  /** Sofort speichern (blur, pagehide, „Jetzt speichern“). Wartet, bis alles bestätigt ist oder ein Fehler auftritt. */
  /**
   * Rückruf vor jedem `flush()` (D-6): Editoren übernehmen dort ihren entprellten Stand, damit er
   * beim Verlassen (pagehide/hidden) im selben Paket mitgeht – unabhängig davon, wer seinen
   * Listener zuerst angehängt hat. Gibt die Abmeldung zurück.
   */
  /**
   * Ein Editor hält entprellte Eingabe zurück (OutlineSync, Aufgaben-Notiz): solange zeigt der
   * Speicherstatus „wartet“ statt „gespeichert“ – sonst hieße es kurz „gespeichert“, obwohl die
   * letzten Tasten noch im Editor stecken.
   */
  markDirty(source: object, dirty: boolean): void {
    if (dirty === this.dirty.has(source)) return;
    if (dirty) this.dirty.add(source);
    else this.dirty.delete(source);
    this.emit();
  }

  onBeforeFlush(callback: () => void): () => void {
    this.beforeFlush.add(callback);
    return () => this.beforeFlush.delete(callback);
  }

  async flush(): Promise<void> {
    for (const callback of [...this.beforeFlush]) {
      try {
        callback();
      } catch {
        // ein Editor darf das Speichern der anderen nicht verhindern
      }
    }
    this.clearDebounce();
    this.clearRetry();
    while (!this.disposed) {
      if (this.inflightPromise) {
        await this.inflightPromise;
        continue;
      }
      if (this.pending.size === 0 || this.retryTimer) return;
      const ok = await this.sendNext();
      if (!ok) return;
    }
  }

  /**
   * Aus localStorage übernommene Operationen (der letzten Sitzung bzw. verwaister Tabs) jetzt
   * senden. Mit Web Locks läuft die Übernahme asynchron (V-12); das Ergebnis ist die Anzahl der
   * übernommenen Operationen.
   */
  restore(): Promise<number> {
    const finish = () => {
      if (this.pending.size > 0 && !this.inflight && !this.retryTimer) this.scheduleDebounce(0);
      this.emit();
      return this.recovered;
    };
    if (this.restored || this.disposed) return Promise.resolve(finish());
    this.restored = true;
    const adopt = this.tabId ? this.adoptOrphans() : Promise.resolve();
    return adopt.then(() => {
      if (this.disposed) return this.recovered;
      // Fehlgeschlagenes der letzten Sitzung einmal von selbst wiederholen (z. B. nach dem
      // Abmelden mit Wartendem oder einem Fehler, den inzwischen ein anderes Gerät behoben hat)
      if (this.failed.size > 0) this.retryFailed();
      return finish();
    });
  }

  /**
   * Dauerhaft fehlgeschlagene Operationen erneut versuchen. Sie sind älter als alles Wartende:
   * vorn einreihen, neuere Werte derselben Felder gewinnen (D-2). `force` (Speicherstatus ›
   * „Erneut versuchen“): auch übernommene Operationen, die wegen eines neueren Serverstands
   * zurückgehalten wurden, jetzt anwenden (V-4).
   */
  retryFailed({ force = false }: { force?: boolean } = {}): void {
    if (this.failed.size === 0 || this.disposed) return;
    this.dropIfAdopted();
    const failed = [...this.failed.values()].map((op) =>
      force && op.adopted ? { ...cloneOp(op), adopted: undefined } : op,
    );
    this.failed.clear();
    this.requeueFront(failed);
    this.writeStorage();
    if (!this.retryTimer) this.scheduleDebounce(this.debounceMs);
    this.emit();
  }

  /**
   * Fehlgeschlagenes verwerfen (Speicherstatus › „Verwerfen“, D-4) – etwa Änderungen an einem
   * anderswo endgültig gelöschten Datensatz. Liefert die Ops, damit „Rückgängig“ sie mit
   * `restoreFailed` zurücklegen kann.
   */
  discardFailed(): SaveOp[] {
    this.dropIfAdopted();
    const dropped = [...this.failed.values()].map(cloneOp);
    if (dropped.length === 0) return dropped;
    this.failed.clear();
    this.lastError = null;
    this.writeStorage();
    this.emit();
    return dropped;
  }

  /** Verworfenes zurücklegen (Rückgängig nach `discardFailed`); Neueres hat Vorrang. */
  restoreFailed(ops: SaveOp[]): void {
    if (this.disposed || ops.length === 0) return;
    for (const op of ops) {
      const key = opKey(op);
      const prev = this.failed.get(key);
      this.failed.set(key, prev ? mergeOps(op, prev) : cloneOp(op));
    }
    this.writeStorage();
    this.emit();
  }

  /** Alle unbestätigten Operationen, je Datensatz zusammengeführt (fehlgeschlagen, unterwegs, wartend). */
  unconfirmedOps(): SaveOp[] {
    const merged = new Map<string, SaveOp>();
    for (const op of [
      ...this.failed.values(),
      ...(this.inflight ?? []),
      ...this.pending.values(),
    ]) {
      const key = opKey(op);
      const prev = merged.get(key);
      merged.set(key, prev ? mergeOps(prev, op) : cloneOp(op));
    }
    return [...merged.values()];
  }

  getSnapshot = (): SaveQueueSnapshot => this.snapshot;

  /** Zähler bestätigter Pakete – ändert er sich während einer Abfrage, ist sie evtl. veraltet. */
  persistedCount(): number {
    return this.persisted;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Bei Netz-Rückkehr sofort erneut versuchen. */
  handleOnline(): void {
    if (this.retryTimer || this.pending.size > 0) void this.flush();
  }

  /**
   * Beenden (Abmelden, D-4): nichts mehr senden – sonst ginge es mit dem anon-Schlüssel raus und
   * landete in „fehlgeschlagen“. Unbestätigtes bleibt im Spiegel und gilt als geschlossen, die
   * nächste Sitzung übernimmt es.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDebounce();
    this.clearRetry();
    this.clearHeartbeat();
    if (this.tabId && !this.dropIfAdopted()) {
      this.closed = true;
      this.writeStorage();
    }
    this.releaseTabLock?.();
    this.releaseTabLock = null;
    this.listeners.clear();
  }

  /** Seite wird verlassen (pagehide): der Spiegel darf sofort von einem neuen Tab übernommen werden. */
  markClosed(): void {
    if (!this.tabId || this.disposed) return;
    this.dropIfAdopted();
    this.closed = true;
    this.writeStorage();
  }

  /** Seite ist wieder da (pageshow, sichtbar): übernommene Ops verwerfen, sonst weiter wie gehabt. */
  resume(): void {
    if (!this.tabId || this.disposed) return;
    this.closed = false;
    const dropped = this.dropIfAdopted();
    this.writeStorage();
    if (dropped) this.emit();
  }

  /* ------------------------------------------------------------------ */
  /* intern                                                              */
  /* ------------------------------------------------------------------ */

  /** Sendet das nächste Paket. true = erfolgreich (oder isolierter Fehler verarbeitet). */
  private sendNext(): Promise<boolean> {
    if (this.dropIfAdopted()) {
      this.emit();
      return Promise.resolve(true);
    }
    const all = [...this.pending.values()];
    const batch = this.isolateRemaining > 0 ? all.slice(0, 1) : all;
    for (const op of batch) this.pending.delete(opKey(op));
    this.inflight = batch;
    this.writeStorage();
    this.emit();

    let succeeded = false;
    const run = (async () => {
      try {
        await this.persistFn(batch.map(cloneOp));
        succeeded = true;
        this.settleFailed(batch);
        for (const op of batch) if (!this.pending.has(opKey(op))) this.ats.delete(opKey(op));
        this.attempts = 0;
        this.lastError = null;
        this.lastSavedAt = this.now();
        this.persisted += 1;
        if (this.isolateRemaining > 0) this.isolateRemaining -= 1;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        if (!this.isRetryable(error)) {
          if (batch.length > 1) {
            // fehlerhafte Operation finden: Paket einzeln wiederholen
            this.isolateRemaining = batch.length;
            this.requeueFront(this.order(batch));
          } else {
            // zusammenführen statt ersetzen: ein späteres Teil-Update (z. B. NOT_FOUND, weil das
            // Anlegen scheiterte) darf das gescheiterte Anlegen nicht verdrängen (D-2)
            for (const op of batch) {
              if (this.isObsolete(op, error)) {
                this.lastError = null;
                this.onObsolete(op);
                continue;
              }
              const key = opKey(op);
              const prev = this.failed.get(key);
              this.failed.set(key, prev ? mergeOps(prev, op) : op);
            }
            if (this.isolateRemaining > 0) this.isolateRemaining -= 1;
          }
          succeeded = true; // weiter mit dem Rest
        } else {
          this.attempts += 1;
          this.requeueFront(batch);
          this.scheduleRetry();
        }
      } finally {
        this.inflight = null;
        this.inflightPromise = null;
        // während des Sendens übernommen (Tab galt als verwaist)? Dann gehört der Rest dem anderen
        if (this.dropIfAdopted()) succeeded = false;
        this.writeStorage();
        if (
          succeeded &&
          this.pending.size > 0 &&
          !this.debounceTimer &&
          !this.retryTimer &&
          !this.disposed
        ) {
          // was während des Sendens dazukam, wurde bereits entprellt
          this.scheduleDebounce(this.isolateRemaining > 0 ? 0 : this.debounceMs);
        }
        this.emit();
      }
    })();
    this.inflightPromise = run;
    return run.then(() => succeeded);
  }

  /**
   * Bestätigte Werte sind neuer als fehlgeschlagene derselben Felder: dort entfernen, sonst
   * überlagerten sie bei jedem Laden den gespeicherten Stand (D-4). Leere Ops fallen weg.
   */
  private settleFailed(batch: SaveOp[]): void {
    for (const op of batch) {
      const key = opKey(op);
      const failed = this.failed.get(key);
      if (!failed) continue;
      const rest = Object.fromEntries(
        Object.entries(failed.values).filter(([field]) => !(field in op.values)),
      );
      if (Object.keys(rest).length === 0) this.failed.delete(key);
      else this.failed.set(key, { ...failed, values: rest });
    }
  }

  /** Fehlgeschlagenes Paket wieder vorne einreihen; neuere Änderungen daran einmischen. */
  private requeueFront(batch: SaveOp[]): void {
    const next = new Map<string, SaveOp>();
    for (const op of batch) {
      const key = opKey(op);
      const newer = this.pending.get(key);
      next.set(key, newer ? mergeOps(op, newer) : op);
    }
    for (const [key, op] of this.pending) if (!next.has(key)) next.set(key, op);
    this.pending = next;
  }

  private scheduleDebounce(ms: number): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, ms);
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = backoffDelay(this.attempts, this.retryBaseMs, this.retryMaxMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * Gespeicherten Stand (der letzten Sitzung bzw. eines verwaisten Tabs) einmischen. Er ist älter
   * als alles hier Eingereihte: steht vorn, und eigene Werte derselben Felder gewinnen – auch die
   * eines gerade gesendeten Pakets.
   */
  private adopt(stored: StoredState): void {
    const inflight = new Map((this.inflight ?? []).map((op) => [opKey(op), op]));
    // übernommen (V-4): mit Zeitpunkt (eigener, sonst Herzschlag des Spiegels) und Marke – der
    // Persister prüft vor dem Senden, ob die Zeile auf dem Server seitdem geändert wurde
    const taken = (op: SaveOp): SaveOp => {
      const at = op.at ?? stored.at ?? this.now();
      this.ats.set(opKey(op), at);
      return { ...cloneOp(op), at, adopted: true };
    };
    const older = (op: SaveOp): SaveOp | null => {
      const sent = inflight.get(opKey(op));
      if (!sent) return taken(op);
      const values = Object.fromEntries(
        Object.entries(op.values).filter(([field]) => !(field in sent.values)),
      );
      return Object.keys(values).length > 0 ? { ...taken(op), values } : null;
    };
    const next = new Map<string, SaveOp>();
    for (const raw of stored.entries) {
      const op = older(raw);
      if (!op) continue;
      const key = opKey(op);
      const prev = next.get(key);
      next.set(key, prev ? mergeOps(prev, op) : op);
    }
    for (const [key, op] of this.pending) {
      const prev = next.get(key);
      next.set(key, prev ? mergeOps(prev, op) : op);
    }
    this.pending = next;
    for (const op of stored.failed) {
      const key = opKey(op);
      const prev = this.failed.get(key);
      this.failed.set(key, prev ? mergeOps(taken(op), prev) : taken(op));
    }
    this.recovered += stored.entries.length;
  }

  private tabLockName(tabId: string): string {
    return `${this.storageKey}:tab:${tabId}`;
  }

  /** Eigene Tab-Sperre halten, solange der Tab lebt (der Browser gibt sie bei Absturz/Schließen frei). */
  private holdTabLock(): void {
    if (!this.locks || !this.tabId || this.releaseTabLock || this.disposed) return;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.releaseTabLock = release;
    this.locks
      .request(this.tabLockName(this.tabId), { mode: "exclusive" }, () => held)
      .catch(() => {
        // Web Locks nicht nutzbar (z. B. verweigert): dann gilt nur der Herzschlag
        this.releaseTabLock = null;
      });
  }

  /** Lebt der Tab eines Spiegels noch? Ohne Web Locks unbekannt (null) – dann zählt der Herzschlag. */
  private async tabAlive(key: string): Promise<boolean | null> {
    if (!this.locks?.query) return null;
    const prefix = `${this.storageKey}:tab:`;
    if (!key.startsWith(prefix)) return null;
    try {
      const { held } = await this.locks.query();
      return (held ?? []).some((lock) => lock.name === key);
    } catch {
      return null;
    }
  }

  /**
   * Mit tabId: verwaiste Spiegel (und den Schlüssel der Vorgängerversion) übernehmen – unter
   * einer exklusiven Sperre, damit zwei gleichzeitig startende Tabs denselben Spiegel nicht beide
   * übernehmen und doppelt senden (V-12).
   */
  private async adoptOrphans(): Promise<void> {
    if (!this.storage) return;
    this.holdTabLock();
    if (this.locks) {
      try {
        await this.locks.request(`${this.storageKey}:adopt`, { mode: "exclusive" }, () =>
          this.adoptOrphansNow(),
        );
        return;
      } catch {
        // ohne Sperre weiter wie bisher
      }
    }
    await this.adoptOrphansNow();
  }

  private async adoptOrphansNow(): Promise<void> {
    const storage = this.storage;
    if (!storage || this.disposed) return;
    const prefix = `${this.storageKey}:tab:`;
    const keys: string[] = [this.storageKey];
    try {
      const count = storage.length ?? 0;
      for (let i = 0; i < count; i += 1) {
        const key = storage.key?.(i);
        if (key?.startsWith(prefix) && key !== this.ownKey) keys.push(key);
      }
    } catch {
      // ohne Aufzählung nur der alte Schlüssel
    }
    const now = this.now();
    const adopted: string[] = [];
    for (const key of keys) {
      const stored = this.readStorage(key);
      if (!stored) continue;
      if (stored.adoptedBy) {
        if (now - (stored.at ?? 0) > TOMBSTONE_MS) this.removeKey(key);
        continue;
      }
      const legacy = key === this.storageKey;
      if (!legacy && !stored.closed) {
        // Tab hält seine Sperre → lebt; keine Sperren-Auskunft → nach dem Herzschlag (V-4)
        const alive = await this.tabAlive(key);
        if (alive === true) continue;
        if (alive === null && now - (stored.at ?? 0) < this.staleMs) continue;
        // seit der Abfrage übernommen?
        if (this.readStorage(key)?.adoptedBy) continue;
      }
      this.adopt(stored);
      adopted.push(key);
    }
    if (adopted.length === 0) return;
    // erst den eigenen Spiegel schreiben, dann die alten markieren – so liegt der Stand immer
    // irgendwo; klappt das Schreiben nicht, bleiben die alten unangetastet
    this.writeStorage();
    if (this.storageError) return;
    for (const key of adopted) {
      if (key === this.storageKey) this.removeKey(key);
      else
        this.writeKey(key, {
          v: STORAGE_VERSION,
          entries: [],
          failed: [],
          adoptedBy: this.tabId ?? "",
          at: now,
        });
    }
  }

  /**
   * Hat ein anderer Tab unseren Spiegel übernommen (wir galten als geschlossen oder verwaist)?
   * Dann gehören ihm die Ops – hier verwerfen, damit sie nicht ein zweites Mal (und älter) gehen.
   */
  private dropIfAdopted(): boolean {
    if (!this.tabId || !this.storage) return false;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.ownKey);
    } catch {
      return false;
    }
    // schnelle Vorprüfung: der eigene Spiegel kann groß sein, die Marke ist klein
    if (!raw?.includes('"adoptedBy"')) return false;
    if (!this.readStorage(this.ownKey)?.adoptedBy) return false;
    this.pending.clear();
    this.failed.clear();
    this.isolateRemaining = 0;
    this.clearDebounce();
    this.clearRetry();
    this.removeKey(this.ownKey);
    return true;
  }

  private readStorage(key: string): StoredState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      if (parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return null;
      const valid = (op: unknown): op is SaveOp =>
        typeof op === "object" &&
        op !== null &&
        typeof (op as SaveOp).table === "string" &&
        typeof (op as SaveOp).id === "string" &&
        typeof (op as SaveOp).values === "object" &&
        ((op as SaveOp).mode === "upsert" || (op as SaveOp).mode === "update");
      return {
        v: 1,
        entries: parsed.entries.filter(valid),
        failed: Array.isArray(parsed.failed) ? parsed.failed.filter(valid) : [],
        at: typeof parsed.at === "number" ? parsed.at : undefined,
        closed: parsed.closed === true,
        adoptedBy: typeof parsed.adoptedBy === "string" ? parsed.adoptedBy : undefined,
      };
    } catch {
      return null;
    }
  }

  private writeKey(key: string, state: StoredState): void {
    try {
      this.storage?.setItem(key, JSON.stringify(state));
    } catch {
      // Marke ist nur ein Hinweis
    }
  }

  private removeKey(key: string): void {
    try {
      this.storage?.removeItem(key);
    } catch {
      // nichts zu tun
    }
  }

  private writeStorage(): void {
    if (!this.storage) return;
    const stamp = (op: SaveOp): SaveOp => {
      const at = op.at ?? this.ats.get(opKey(op));
      return at === undefined ? op : { ...op, at };
    };
    const entries = [...(this.inflight ?? []), ...this.pending.values()].map(stamp);
    const failed = [...this.failed.values()].map(stamp);
    const empty = entries.length === 0 && failed.length === 0;
    try {
      if (empty) {
        this.storage.removeItem(this.ownKey);
      } else {
        const state: StoredState = { v: STORAGE_VERSION, entries, failed };
        if (this.tabId) {
          state.at = this.now();
          if (this.closed) state.closed = true;
        }
        this.storage.setItem(this.ownKey, JSON.stringify(state));
      }
      this.storageError = false;
    } catch {
      this.storageError = true;
    }
    if (this.tabId) {
      if (empty) this.clearHeartbeat();
      else {
        this.scheduleHeartbeat();
        // sobald ein Spiegel da ist, zeigt die Sperre anderen Tabs: dieser lebt (V-4)
        this.holdTabLock();
      }
    }
  }

  /** Solange Unbestätigtes da ist, den Zeitstempel erneuern – sonst gälte der Tab als verwaist. */
  private scheduleHeartbeat(): void {
    if (this.heartbeatTimer || this.disposed) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (this.disposed) return;
      if (this.dropIfAdopted()) {
        this.emit();
        return;
      }
      this.writeStorage();
    }, this.heartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private computeSnapshot(): SaveQueueSnapshot {
    const pending = this.pending.size + (this.inflight?.length ?? 0) + this.dirty.size;
    let status: SaveStatus = "idle";
    if (this.failed.size > 0) status = "error";
    else if (this.retryTimer) status = this.isOnline() ? "retrying" : "offline";
    else if (this.inflight) status = "saving";
    else if (this.pending.size > 0 || this.dirty.size > 0) status = "pending";
    return {
      status,
      pending,
      failed: this.failed.size,
      attempts: this.attempts,
      lastError: this.lastError,
      lastSavedAt: this.lastSavedAt,
      storageError: this.storageError,
    };
  }

  private emit(): void {
    this.snapshot = this.computeSnapshot();
    for (const listener of this.listeners) listener();
  }
}

export function createSaveQueue(options: SaveQueueOptions): SaveQueue {
  return new SaveQueue(options);
}

/**
 * Lebenszyklus im Browser: beim Verlassen/Verbergen der Seite sofort speichern,
 * bei Netz-Rückkehr erneut versuchen. Gibt eine Aufräumfunktion zurück.
 */
export function attachSaveQueueLifecycle(
  queue: SaveQueue,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">,
): () => void {
  const onPageHide = () => {
    queue.markClosed();
    void queue.flush();
  };
  const onPageShow = () => queue.resume();
  const onOnline = () => queue.handleOnline();
  const onVisibility = () => {
    if (doc?.visibilityState === "hidden") void queue.flush();
    else queue.resume();
  };
  target.addEventListener("pagehide", onPageHide);
  target.addEventListener("pageshow", onPageShow);
  target.addEventListener("online", onOnline);
  doc?.addEventListener("visibilitychange", onVisibility);
  return () => {
    target.removeEventListener("pagehide", onPageHide);
    target.removeEventListener("pageshow", onPageShow);
    target.removeEventListener("online", onOnline);
    doc?.removeEventListener("visibilitychange", onVisibility);
  };
}
