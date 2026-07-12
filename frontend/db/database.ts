import Dexie, { Table } from 'dexie';
import { type InvoiceData } from '../schema/invoiceSchema';

/**
 * Domain types — re-exported so consumers don't need a second import.
 */
export type InvoiceStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Invoice {
  id?: number;
  filename: string;
  blob: Blob;
  status: InvoiceStatus;
  extractedData?: InvoiceData;
  createdAt: Date;
}

/**
 * Module-level logger. Routes to console.* with a stable `[db]` prefix
 * so logs are easy to grep/filter in DevTools.
 */
const PREFIX = '[db]';
const logger = {
  debug: (...args: unknown[]) => console.debug(PREFIX, ...args),
  info: (...args: unknown[]) => console.info(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};

/**
 * Allowed status transitions. Any move outside this graph is rejected
 * with a warning so a buggy caller can't silently corrupt invoice state.
 */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  pending:    new Set<InvoiceStatus>(['processing', 'error']),
  processing: new Set<InvoiceStatus>(['done', 'error']),
  done:       new Set<InvoiceStatus>(),
  error:      new Set<InvoiceStatus>(['pending']), // allow manual retry
};

export class AppDatabase extends Dexie {
  invoices!: Table<Invoice>;

  constructor() {
    super('AIAccountantDB');
    this.version(1).stores({
      // Primary key + indexes. `createdAt` index supports ordering.
      invoices: '++id, filename, status, createdAt',
    });

    // Surface unhandled Dexie errors to the console so they're never silent.
    this.on('blocked', () => logger.warn('DB upgrade blocked by another tab — close other tabs holding the DB.'));
    this.on('versionchange', () => logger.warn('DB schema version change requested by another tab.'));
    this.on('close', () => logger.warn('DB connection closed unexpectedly.'));
  }
}

export const db = new AppDatabase();

/* -------------------------------------------------------------------------- */
/*                              Helper functions                              */
/* -------------------------------------------------------------------------- */

/**
 * Retries an async DB op once if it fails with a transient/closed-DB error.
 * Used to absorb IndexedDB quirks like DatabaseClosedError after tab sleep.
 */
async function retryOnce<T>(op: () => Promise<T>, label: string): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const transient =
      err instanceof Dexie.DexieError ||
      (err instanceof Error && /DatabaseClosed|InvalidState|QuotaExceeded/i.test(err.message));
    if (!transient) throw err;
    logger.warn(`Transient error in ${label}, retrying once:`, err);
    return await op();
  }
}

/** Cheap sanity-check for invoice inputs. Throws on bad data. */
function assertValidInvoice(inv: Omit<Invoice, 'id' | 'createdAt'>): void {
  if (!inv || typeof inv !== 'object') {
    throw new Error('Invoice must be an object');
  }
  if (!inv.filename || typeof inv.filename !== 'string') {
    throw new Error('Invoice.filename is required and must be a non-empty string');
  }
  if (!(inv.blob instanceof Blob)) {
    throw new Error('Invoice.blob must be a Blob');
  }
  if (inv.blob.size === 0) {
    throw new Error(`Invoice.blob for "${inv.filename}" is empty (0 bytes)`);
  }
  const validStatuses: InvoiceStatus[] = ['pending', 'processing', 'done', 'error'];
  if (!validStatuses.includes(inv.status)) {
    throw new Error(`Invoice.status must be one of ${validStatuses.join(', ')}`);
  }
}

/* ---------------------------------- CRUD ---------------------------------- */

/** Insert a new invoice row. Returns the assigned id. */
export async function saveInvoice(
  input: Omit<Invoice, 'id' | 'createdAt'>,
): Promise<number> {
  try {
    assertValidInvoice(input);
    const id = await retryOnce(
      () => db.invoices.add({ ...input, createdAt: new Date() }),
      'saveInvoice',
    );
    logger.info(`saveInvoice: stored "${input.filename}" as id=${id} (status=${input.status})`);
    return Number(id);
  } catch (err) {
    logger.error('saveInvoice failed:', err, { filename: input?.filename });
    throw err;
  }
}

/** Update an existing invoice by id. Returns the count of updated rows (0 or 1). */
export async function updateInvoice(
  id: number,
  patch: Partial<Omit<Invoice, 'id' | 'createdAt'>>,
): Promise<number> {
  try {
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`updateInvoice: invalid id ${id}`);
    }
    if (patch.blob !== undefined && !(patch.blob instanceof Blob)) {
      throw new Error('updateInvoice: patch.blob must be a Blob');
    }
    if (patch.filename !== undefined && (typeof patch.filename !== 'string' || !patch.filename)) {
      throw new Error('updateInvoice: patch.filename must be a non-empty string');
    }
    const count = await retryOnce(() => db.invoices.update(id, patch), `updateInvoice(${id})`);
    if (count === 0) logger.warn(`updateInvoice(${id}): no row matched`);
    else logger.info(`updateInvoice(${id}): updated ${count} field(s)`);
    return count;
  } catch (err) {
    logger.error(`updateInvoice(${id}) failed:`, err);
    throw err;
  }
}

/**
 * Move an invoice to a new status, enforcing the allowed-transitions graph.
 * Returns true if the row was updated, false if the row was missing.
 * Throws if the transition is not allowed.
 */
export async function updateInvoiceStatus(
  id: number,
  next: InvoiceStatus,
): Promise<boolean> {
  try {
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`updateInvoiceStatus: invalid id ${id}`);
    }
    const current = await db.invoices.get(id);
    if (!current) {
      logger.warn(`updateInvoiceStatus(${id}): row not found`);
      return false;
    }
    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.has(next)) {
      const msg = `Illegal status transition ${current.status} → ${next} for invoice ${id}`;
      logger.error(msg);
      throw new Error(msg);
    }
    await retryOnce(() => db.invoices.update(id, { status: next }), `updateInvoiceStatus(${id})`);
    logger.info(`updateInvoiceStatus(${id}): ${current.status} → ${next}`);
    return true;
  } catch (err) {
    logger.error(`updateInvoiceStatus(${id}, ${next}) failed:`, err);
    throw err;
  }
}

/** Read all invoices, newest first. Never throws — returns [] on failure. */
export async function getAllInvoices(): Promise<Invoice[]> {
  try {
    const rows = await retryOnce(
      () => db.invoices.orderBy('createdAt').reverse().toArray(),
      'getAllInvoices',
    );
    logger.debug(`getAllInvoices: returned ${rows.length} row(s)`);
    return rows;
  } catch (err) {
    logger.error('getAllInvoices failed:', err);
    return [];
  }
}

/** Get invoices filtered by status, newest first. Never throws. */
export async function getInvoicesByStatus(status: InvoiceStatus): Promise<Invoice[]> {
  try {
    const rows = await retryOnce(
      () =>
        db.invoices
          .where('status')
          .equals(status)
          .reverse()
          .sortBy('createdAt'),
      `getInvoicesByStatus(${status})`,
    );
    logger.debug(`getInvoicesByStatus(${status}): returned ${rows.length} row(s)`);
    return rows;
  } catch (err) {
    logger.error(`getInvoicesByStatus(${status}) failed:`, err);
    return [];
  }
}

/** Delete a single invoice. Returns true if a row was actually removed. */
export async function deleteInvoice(id: number): Promise<boolean> {
  try {
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`deleteInvoice: invalid id ${id}`);
    }
    // Dexie's `delete()` returns Promise<void>; check existence first
    // so we can return a meaningful boolean to the caller.
    const existing = await retryOnce(() => db.invoices.get(id), `deleteInvoice(${id}).get`);
    if (!existing) {
      logger.warn(`deleteInvoice(${id}): no row matched`);
      return false;
    }
    await retryOnce(() => db.invoices.delete(id), `deleteInvoice(${id})`);
    logger.info(`deleteInvoice(${id}): removed`);
    return true;
  } catch (err) {
    logger.error(`deleteInvoice(${id}) failed:`, err);
    throw err;
  }
}

/**
 * DANGER: wipe the entire `invoices` table. Used by tests / "Reset cache" UI.
 * Logs loudly because the operation is irreversible.
 * Returns the number of rows that were present before the wipe.
 */
export async function clearAllInvoices(): Promise<number> {
  try {
    const before = await retryOnce(() => db.invoices.count(), 'clearAllInvoices.count');
    logger.warn(`clearAllInvoices: wiping ${before} row(s) from the invoices table`);
    await retryOnce(() => db.invoices.clear(), 'clearAllInvoices');
    logger.warn(`clearAllInvoices: removed ${before} row(s)`);
    return before;
  } catch (err) {
    logger.error('clearAllInvoices failed:', err);
    throw err;
  }
}