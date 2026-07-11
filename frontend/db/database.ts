import Dexie, { Table } from 'dexie';
import { type InvoiceData } from '../schema/invoiceSchema';

export interface Invoice {
  id?: number;
  filename: string;
  blob: Blob;
  status: 'pending' | 'processing' | 'done' | 'error';
  extractedData?: InvoiceData;
  createdAt: Date;
}

export class AppDatabase extends Dexie {
  invoices!: Table<Invoice>;

  constructor() {
    super('AIAccountantDB');
    this.version(1).stores({
      invoices: '++id, filename, status, createdAt' // Primary key and indexed props
    });
  }
}

export const db = new AppDatabase();
