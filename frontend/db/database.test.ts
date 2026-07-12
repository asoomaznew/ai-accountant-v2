/**
 * Permanent test suite for db/database.ts.
 *
 * The module exports a module-level `db` singleton that points at the
 * hard-coded IDB name `AIAccountantDB`. Tests don't import this singleton;
 * instead they exercise the exported CRUD helpers directly and call
 * `indexedDB.deleteDatabase()` in a `beforeEach` to guarantee a clean
 * slate. The `AppDatabase` class is also tested independently so we can
 * construct fresh instances with unique names.
 *
 * Environment is `node` (set by vitest.config.ts); fake-indexeddb is
 * loaded by vitest.setup.ts before any test runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppDatabase,
  db,
  saveInvoice,
  updateInvoice,
  updateInvoiceStatus,
  getAllInvoices,
  getInvoicesByStatus,
  deleteInvoice,
  clearAllInvoices,
  type InvoiceStatus,
} from './database';

// Helpers --------------------------------------------------------------------

/** Build a real Blob with a chosen byte count for tests. */
function makeBlob(bytes = 100): Blob {
  return new Blob(['x'.repeat(bytes)], { type: 'application/pdf' });
}

/** Wipe the singleton DB before each test so runs are hermetic. */
async function wipeDatabase(): Promise<void> {
  // Do NOT call db.close() — that permanently closes the singleton and all
  // subsequent tests will see DatabaseClosedError. Just delete the underlying
  // IDB; Dexie will lazily reopen the connection on the next operation.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('AIAccountantDB');
    req.onsuccess = () => resolve();
    req.onerror   = () => resolve();
    req.onblocked = () => resolve();
  });
}

// Logger output from db/database.ts (prefixed [db]) is allowed to flow to the
// vitest reporter. It is intentionally not mocked because vitest's
// SpyInstance typing for console.* is too narrow to satisfy here.

// =============================================================================
// 1. Class surface & schema
// =============================================================================
describe('AppDatabase class', () => {
  it('is exported and constructible', () => {
    const d = new (AppDatabase as unknown as new (name: string) => AppDatabase)('TEST-DB');
    expect(d).toBeInstanceOf(AppDatabase);
    // The source hardcodes 'AIAccountantDB' in super(), so the constructor
    // arg is ignored at runtime — assert the actual fixed name.
    expect(d.name).toBe('AIAccountantDB');
    d.close();
  });

  it('declares the `invoices` table', () => {
    const d = new (AppDatabase as unknown as new (name: string) => AppDatabase)('TEST-DB-SCHEMA-' + Date.now());
    expect(d.invoices).toBeDefined();
    expect(d.tables.map((t) => t.name)).toContain('invoices');
    d.close();
  });
});

// =============================================================================
// 2. saveInvoice — happy paths
// =============================================================================
describe('saveInvoice', () => {
  beforeEach(async () => { await wipeDatabase(); });
  afterEach(async () => { await wipeDatabase(); });

  it('returns a numeric id and persists the row', async () => {
    const id = await saveInvoice({ filename: 'jan.pdf', blob: makeBlob(100), status: 'pending' });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
    const all = await getAllInvoices();
    expect(all).toHaveLength(1);
    expect(all[0]!.filename).toBe('jan.pdf');
    expect(all[0]!.status).toBe('pending');
    expect(all[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('stamps createdAt on every row', async () => {
    const before = Date.now();
    await saveInvoice({ filename: 'a.pdf', blob: makeBlob(1), status: 'pending' });
    const after = Date.now();
    const [row] = await getAllInvoices();
    expect(row!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row!.createdAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('accepts every valid status enum value', async () => {
    for (const status of ['pending', 'processing', 'done', 'error'] as InvoiceStatus[]) {
      const id = await saveInvoice({ filename: `${status}.pdf`, blob: makeBlob(10), status });
      expect(id).toBeGreaterThan(0);
    }
    const all = await getAllInvoices();
    expect(all).toHaveLength(4);
  });

  it('preserves extractedData when provided', async () => {
    const data = { accountName: 'Acme', accountNumber: 'X1', transactions: [] };
    await saveInvoice({
      filename: 'with-data.pdf', blob: makeBlob(50), status: 'done', extractedData: data,
    });
    const [row] = await getAllInvoices();
    expect(row!.extractedData).toEqual(data);
  });
});

// =============================================================================
// 3. saveInvoice — input validation
// =============================================================================
describe('saveInvoice validation', () => {
  beforeEach(async () => { await wipeDatabase(); });

  it('rejects an empty filename', async () => {
    await expect(
      saveInvoice({ filename: '', blob: makeBlob(10), status: 'pending' }),
    ).rejects.toThrow(/filename is required/);
  });

  it('rejects a non-string filename', async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      saveInvoice({ filename: 42, blob: makeBlob(10), status: 'pending' }),
    ).rejects.toThrow(/filename is required/);
  });

  it('rejects a missing blob', async () => {
    await expect(
      saveInvoice({ filename: 'a.pdf', blob: undefined as unknown as Blob, status: 'pending' }),
    ).rejects.toThrow(/blob must be a Blob/);
  });

  it('rejects a non-Blob blob', async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      saveInvoice({ filename: 'a.pdf', blob: { size: 5 }, status: 'pending' }),
    ).rejects.toThrow(/blob must be a Blob/);
  });

  it('rejects a 0-byte blob', async () => {
    await expect(
      saveInvoice({ filename: 'a.pdf', blob: makeBlob(0), status: 'pending' }),
    ).rejects.toThrow(/is empty \(0 bytes\)/);
  });

  it('rejects an unknown status', async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      saveInvoice({ filename: 'a.pdf', blob: makeBlob(10), status: 'lolwut' }),
    ).rejects.toThrow(/status must be one of/);
  });

  it('rejects a non-object input', async () => {
    await expect(
      saveInvoice(null as unknown as Parameters<typeof saveInvoice>[0]),
    ).rejects.toThrow(/Invoice must be an object/);
  });

  it('does NOT write anything when validation fails', async () => {
    await expect(
      saveInvoice({ filename: '', blob: makeBlob(1), status: 'pending' }),
    ).rejects.toThrow();
    expect(await getAllInvoices()).toHaveLength(0);
  });
});

// =============================================================================
// 4. updateInvoiceStatus — transition graph
// =============================================================================
describe('updateInvoiceStatus — transition graph', () => {
  let id: number;
  beforeEach(async () => {
    await wipeDatabase();
    id = await saveInvoice({ filename: 'trans.pdf', blob: makeBlob(10), status: 'pending' });
  });
  afterEach(async () => { await wipeDatabase(); });

  it('allows pending → processing', async () => {
    await expect(updateInvoiceStatus(id, 'processing')).resolves.toBe(true);
    const [row] = await getInvoicesByStatus('processing');
    expect(row?.id).toBe(id);
  });

  it('allows pending → error (early failure)', async () => {
    await expect(updateInvoiceStatus(id, 'error')).resolves.toBe(true);
  });

  it('allows processing → done', async () => {
    await updateInvoiceStatus(id, 'processing');
    await expect(updateInvoiceStatus(id, 'done')).resolves.toBe(true);
  });

  it('allows processing → error', async () => {
    await updateInvoiceStatus(id, 'processing');
    await expect(updateInvoiceStatus(id, 'error')).resolves.toBe(true);
  });

  it('allows error → pending (manual retry)', async () => {
    await updateInvoiceStatus(id, 'processing');
    await updateInvoiceStatus(id, 'error');
    await expect(updateInvoiceStatus(id, 'pending')).resolves.toBe(true);
  });

  it('REJECTS done → processing (terminal state)', async () => {
    await updateInvoiceStatus(id, 'processing');
    await updateInvoiceStatus(id, 'done');
    await expect(updateInvoiceStatus(id, 'processing')).rejects.toThrow(/Illegal status transition/);
  });

  it('REJECTS done → pending (terminal state)', async () => {
    await updateInvoiceStatus(id, 'processing');
    await updateInvoiceStatus(id, 'done');
    await expect(updateInvoiceStatus(id, 'pending')).rejects.toThrow(/Illegal status transition/);
  });

  it('REJECTS done → error (terminal state)', async () => {
    await updateInvoiceStatus(id, 'processing');
    await updateInvoiceStatus(id, 'done');
    await expect(updateInvoiceStatus(id, 'error')).rejects.toThrow(/Illegal status transition/);
  });

  it('returns false (not throws) for a missing id', async () => {
    await expect(updateInvoiceStatus(999_999, 'processing')).resolves.toBe(false);
  });

  it('rejects a non-positive id', async () => {
    await expect(updateInvoiceStatus(0, 'processing')).rejects.toThrow(/invalid id/);
    await expect(updateInvoiceStatus(-1, 'processing')).rejects.toThrow(/invalid id/);
    await expect(updateInvoiceStatus(NaN, 'processing')).rejects.toThrow(/invalid id/);
  });

  it('does NOT mutate state when the transition is illegal', async () => {
    await updateInvoiceStatus(id, 'processing');
    await updateInvoiceStatus(id, 'done');
    try { await updateInvoiceStatus(id, 'pending'); } catch { /* expected */ }
    const [row] = await getInvoicesByStatus('done');
    expect(row?.id).toBe(id);
  });
});

// =============================================================================
// 5. updateInvoice — partial patch
// =============================================================================
describe('updateInvoice', () => {
  let id: number;
  beforeEach(async () => {
    await wipeDatabase();
    id = await saveInvoice({ filename: 'orig.pdf', blob: makeBlob(10), status: 'pending' });
  });
  afterEach(async () => { await wipeDatabase(); });

  it('returns 1 for a successful patch', async () => {
    expect(await updateInvoice(id, { filename: 'new.pdf' })).toBe(1);
  });

  it('returns 0 for a missing id (warning, not throw)', async () => {
    expect(await updateInvoice(999_999, { filename: 'x.pdf' })).toBe(0);
  });

  it('applies the patch to the row', async () => {
    await updateInvoice(id, { filename: 'renamed.pdf' });
    const [row] = await getAllInvoices();
    expect(row!.filename).toBe('renamed.pdf');
  });

  it('rejects a non-positive id', async () => {
    await expect(updateInvoice(0, { filename: 'x.pdf' })).rejects.toThrow(/invalid id/);
  });

  it('rejects an empty-string filename patch', async () => {
    await expect(updateInvoice(id, { filename: '' })).rejects.toThrow(/non-empty string/);
  });

  it('rejects a non-Blob blob patch', async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      updateInvoice(id, { blob: { size: 5 } }),
    ).rejects.toThrow(/must be a Blob/);
  });

  it('can update extractedData', async () => {
    const data = { accountName: 'A', accountNumber: '1', transactions: [] };
    await updateInvoice(id, { extractedData: data, status: 'done' });
    const [row] = await getAllInvoices();
    expect(row!.extractedData).toEqual(data);
    expect(row!.status).toBe('done');
  });
});

// =============================================================================
// 6. Queries — getAllInvoices / getInvoicesByStatus
// =============================================================================
describe('queries', () => {
  beforeEach(async () => { await wipeDatabase(); });
  afterEach(async () => { await wipeDatabase(); });

  it('getAllInvoices returns [] when empty', async () => {
    expect(await getAllInvoices()).toEqual([]);
  });

  it('getAllInvoices returns rows sorted newest-first', async () => {
    await saveInvoice({ filename: 'a.pdf', blob: makeBlob(1), status: 'pending' });
    await new Promise((r) => setTimeout(r, 5));
    await saveInvoice({ filename: 'b.pdf', blob: makeBlob(1), status: 'pending' });
    await new Promise((r) => setTimeout(r, 5));
    await saveInvoice({ filename: 'c.pdf', blob: makeBlob(1), status: 'pending' });
    const all = await getAllInvoices();
    expect(all.map((r) => r.filename)).toEqual(['c.pdf', 'b.pdf', 'a.pdf']);
  });

  it('getInvoicesByStatus filters correctly', async () => {
    const id1 = await saveInvoice({ filename: 'a.pdf', blob: makeBlob(1), status: 'pending' });
    const id2 = await saveInvoice({ filename: 'b.pdf', blob: makeBlob(1), status: 'pending' });
    await saveInvoice({ filename: 'c.pdf', blob: makeBlob(1), status: 'done' });
    await updateInvoiceStatus(id1, 'processing');
    await updateInvoiceStatus(id1, 'done');

    expect(await getInvoicesByStatus('pending')).toHaveLength(1);
    expect(await getInvoicesByStatus('processing')).toHaveLength(0);
    expect(await getInvoicesByStatus('done')).toHaveLength(2);
    expect(await getInvoicesByStatus('error')).toHaveLength(0);

    // sanity check: id2 is still pending
    const pending = await getInvoicesByStatus('pending');
    expect(pending[0]!.id).toBe(id2);
  });
});

// =============================================================================
// 7. deleteInvoice
// =============================================================================
describe('deleteInvoice', () => {
  let id: number;
  beforeEach(async () => {
    await wipeDatabase();
    id = await saveInvoice({ filename: 'del.pdf', blob: makeBlob(1), status: 'pending' });
  });
  afterEach(async () => { await wipeDatabase(); });

  it('returns true and removes the row', async () => {
    expect(await deleteInvoice(id)).toBe(true);
    expect(await getAllInvoices()).toHaveLength(0);
  });

  it('returns false for a missing id (no throw)', async () => {
    expect(await deleteInvoice(999_999)).toBe(false);
  });

  it('rejects a non-positive id', async () => {
    await expect(deleteInvoice(0)).rejects.toThrow(/invalid id/);
    await expect(deleteInvoice(-5)).rejects.toThrow(/invalid id/);
  });

  it('only removes the targeted row', async () => {
    const otherId = await saveInvoice({ filename: 'keep.pdf', blob: makeBlob(1), status: 'pending' });
    await deleteInvoice(id);
    const remaining = await getAllInvoices();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(otherId);
  });
});

// =============================================================================
// 8. clearAllInvoices
// =============================================================================
describe('clearAllInvoices', () => {
  beforeEach(async () => { await wipeDatabase(); });
  afterEach(async () => { await wipeDatabase(); });

  it('removes all rows and returns the count that were present', async () => {
    await saveInvoice({ filename: 'a.pdf', blob: makeBlob(1), status: 'pending' });
    await saveInvoice({ filename: 'b.pdf', blob: makeBlob(1), status: 'pending' });
    await saveInvoice({ filename: 'c.pdf', blob: makeBlob(1), status: 'pending' });
    const removed = await clearAllInvoices();
    expect(removed).toBe(3);
    expect(await getAllInvoices()).toHaveLength(0);
  });

  it('returns 0 when the table is already empty', async () => {
    expect(await clearAllInvoices()).toBe(0);
  });
});

// =============================================================================
// 9. Crash safety — getAllInvoices never throws
// =============================================================================
describe('read helpers are crash-safe', () => {
  it('getAllInvoices returns [] on a closed DB (not throws)', async () => {
    await wipeDatabase();
    // Close the singleton to force IDB errors on subsequent reads.
    db.close();
    const rows = await getAllInvoices();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toEqual([]);
  });
});