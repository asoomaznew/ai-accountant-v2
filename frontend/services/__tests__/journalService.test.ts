import { describe, it, expect } from 'vitest';
import { generateJournalEntries } from '../journalService';
import { ExtractedData } from '../../types';

describe('journalService - generateJournalEntries', () => {
  it('should return empty array for empty transactions list', () => {
    const data: ExtractedData = {
      accountName: 'TEST CLINIC',
      accountNumber: '011010232380',
      transactions: []
    };
    const result = generateJournalEntries(data);
    expect(result).toEqual([]);
  });

  it('should correct "pos purchase" description to debit', () => {
    const data: ExtractedData = {
      accountName: 'IRIS POLYCLINIC',
      accountNumber: '011010232282',
      transactions: [
        {
          date: '2024-07-01',
          description: 'POS Purchase KNET',
          amount: 15.5,
          type: 'credit' // Will be corrected to debit
        }
      ]
    };
    const result = generateJournalEntries(data);
    expect(result.length).toBe(1);
    expect(result[0].creditAmount).toBe(15.5);
    expect(result[0].journalName).toBe('STVINV');
  });

  it('should resolve specific offset account and details for Clover accounts', () => {
    const data: ExtractedData = {
      accountName: 'AL ASEEL INTERNATIONAL POLYCLINIC',
      accountNumber: '011010232380',
      transactions: [
        {
          date: '2024-07-02',
          description: 'Ordinary Deposit',
          amount: 100.0,
          type: 'credit'
        }
      ]
    };
    const result = generateJournalEntries(data);
    expect(result.length).toBe(1);
    expect(result[0].accountNo).toBe('KIBAA-2380');
    expect(result[0].activities).toBe('1194');
    expect(result[0].projectId).toBe('104');
    expect(result[0].offsetAccount).toBe('50-000010'); // Resolved offset account
  });

  it('should keep negative debit payments separate and aggregate only small bank charges', () => {
    const data: ExtractedData = {
      accountName: 'AL ASEEL INTERNATIONAL POLYCLINIC',
      accountNumber: '011010232380',
      transactions: [
        {
          date: '2026-06-04',
          description: 'Transfer from investor salary',
          amount: 1231,
          type: 'credit'
        },
        {
          date: '2026-06-04',
          description: 'Transfer from investor salary',
          amount: 458.054,
          type: 'credit'
        },
        {
          date: '2026-06-14',
          description: 'Transfer from investor salary',
          amount: 2655,
          type: 'credit'
        },
        {
          date: '2026-06-01',
          description: 'PMT investor salary',
          amount: -2450,
          type: 'debit'
        },
        {
          date: '2026-06-11',
          description: 'PMT investor salary',
          amount: -1231,
          type: 'debit'
        },
        {
          date: '2026-06-14',
          description: 'PMT investor salary',
          amount: -2650,
          type: 'debit'
        },
        {
          date: '2026-06-14',
          description: 'TFR Charge',
          amount: -5,
          type: 'debit'
        },
        {
          date: '2026-06-14',
          description: 'Bank charge',
          amount: -5,
          type: 'debit'
        }
      ]
    };

    const result = generateJournalEntries(data);
    const debitSideCreditAmounts = result
      .filter(entry => entry.journalName === 'STVINV')
      .map(entry => entry.creditAmount);

    expect(debitSideCreditAmounts).toEqual([2450, 1231, 2650, 10]);
    expect(result.find(entry => entry.description === 'Aggregated Bank Charges and Fees')?.creditAmount).toBe(10);
    expect(result.some(entry => entry.creditAmount === -6341)).toBe(false);
  });

  it('should force "deposit", "transfer from", and "profit" descriptions to credit (debit to bank account)', () => {
    const data: ExtractedData = {
      accountName: 'IRIS POLYCLINIC',
      accountNumber: '011010232282',
      transactions: [
        {
          date: '2026-06-01',
          description: 'Deposit Transfer From: 011010247832 to: 011010232240',
          amount: 71.500,
          type: 'debit' // Misclassified by AI, should be corrected to credit
        },
        {
          date: '2026-06-02',
          description: 'Saving Account Profit',
          amount: 12.34,
          type: 'debit' // Misclassified, should be corrected to credit
        }
      ]
    };
    const result = generateJournalEntries(data);
    expect(result.length).toBe(2);
    
    // First entry: KIBIR-2282 / Deposit Transfer From
    const first = result.find(e => e.accountNo === 'KIBIR-2282' && e.debitAmount === 71.5);
    expect(first).toBeDefined();
    expect(first?.journalName).toBe('CRNOTE');
    expect(first?.debitAmount).toBe(71.5);
    expect(first?.creditAmount).toBe('');

    // Second entry: Saving Account Profit
    const second = result.find(e => e.description.includes('Saving account profit'));
    expect(second).toBeDefined();
    expect(second?.journalName).toBe('CRNOTE');
    expect(second?.debitAmount).toBe(12.34);
    expect(second?.creditAmount).toBe('');
  });
});
