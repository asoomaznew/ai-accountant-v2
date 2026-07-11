import { describe, it, expect } from 'vitest';
import { convert001To49Rows, formatDate } from '../convert001To49Service';

describe('convert001To49Service - formatDate', () => {
  it('should format Date objects to DD-MM-YYYY', () => {
    const date = new Date(2024, 6, 1); // 1 July 2024
    expect(formatDate(date)).toBe('01-07-2024');
  });

  it('should format Excel serial numbers to DD-MM-YYYY', () => {
    // 45472 is the Excel serial number for 29 June 2024
    expect(formatDate(45472)).toBe('29-06-2024');
  });

  it('should pass through valid string dates', () => {
    expect(formatDate('01-07-2024')).toBe('01-07-2024');
  });

  it('should return empty string for null/undefined/empty inputs', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
  });
});

describe('convert001To49Service - convert001To49Rows', () => {
  it('should ignore rows where Offset Account does not start with 50-', () => {
    const input = [
      {
        'Account No': '1001',
        'Offset Account': '40-000001', // Should be ignored
        'Debit Amount': 100,
        'Credit Amount': '',
      }
    ];
    const result = convert001To49Rows(input);
    expect(result).toEqual([]);
  });

  it('should swap Debit and Credit amounts and set Account No to 49-000001', () => {
    const input = [
      {
        'Account No': '011010232380',
        'Offset Account': '50-000010',
        'Debit Amount': 250,
        'Credit Amount': '',
        'Posting Date': '2024-07-01',
        'Description': 'TEST INV / 2024',
      }
    ];
    const result = convert001To49Rows(input);
    expect(result.length).toBe(1);
    expect(result[0]['Debit Amount']).toBe('');
    expect(result[0]['Credit Amount']).toBe(250);
    expect(result[0]['Account No']).toBe('49-000001');
    expect(result[0]['Description']).toBe('TEST INV');
  });

  it('should handle both Debit and Credit empty by keeping them empty', () => {
    const input = [
      {
        'Account No': '011010232380',
        'Offset Account': '50-000010',
        'Debit Amount': '',
        'Credit Amount': '',
        'Posting Date': '2024-07-01',
        'Description': 'TEST / INV',
      }
    ];
    const result = convert001To49Rows(input);
    expect(result.length).toBe(1);
    expect(result[0]['Debit Amount']).toBe('');
    expect(result[0]['Credit Amount']).toBe('');
  });

  it('should swap values when both Debit and Credit are present', () => {
    const input = [
      {
        'Account No': '011010232380',
        'Offset Account': '50-000010',
        'Debit Amount': 100,
        'Credit Amount': 200,
        'Posting Date': '2024-07-01',
        'Description': 'TEST / INV',
      }
    ];
    const result = convert001To49Rows(input);
    expect(result.length).toBe(1);
    expect(result[0]['Debit Amount']).toBe(200);
    expect(result[0]['Credit Amount']).toBe(100);
  });

  it('should swap zero, negative, and text-based values safely', () => {
    const input = [
      {
        'Account No': '011010232380',
        'Offset Account': '50-000010',
        'Debit Amount': -50.5,
        'Credit Amount': 0,
        'Posting Date': '2024-07-01',
        'Description': 'TEST / INV',
      },
      {
        'Account No': '011010232380',
        'Offset Account': '50-000010',
        'Debit Amount': '1,000 KD',
        'Credit Amount': 'N/A',
        'Posting Date': '2024-07-01',
        'Description': 'TEST / INV',
      }
    ];
    const result = convert001To49Rows(input);
    expect(result.length).toBe(2);
    expect(result[0]['Debit Amount']).toBe(0);
    expect(result[0]['Credit Amount']).toBe(-50.5);
    expect(result[1]['Debit Amount']).toBe('N/A');
    expect(result[1]['Credit Amount']).toBe('1,000 KD');
  });

  it('should group journal numbers by original Account No', () => {
    const input = [
      {
        'Account No': 'ACC-1',
        'Offset Account': '50-000001',
        'Debit Amount': 10,
        'Credit Amount': '',
      },
      {
        'Account No': 'ACC-1',
        'Offset Account': '50-000001',
        'Debit Amount': '',
        'Credit Amount': 20,
      },
      {
        'Account No': 'ACC-2',
        'Offset Account': '50-000001',
        'Debit Amount': 30,
        'Credit Amount': '',
      }
    ];
    const result = convert001To49Rows(input);
    expect(result.length).toBe(3);
    expect(result[0]['Journal Number']).toBe(1);
    expect(result[0]['Line Num']).toBe(1);
    expect(result[1]['Journal Number']).toBe(1);
    expect(result[1]['Line Num']).toBe(2);
    expect(result[2]['Journal Number']).toBe(2);
    expect(result[2]['Line Num']).toBe(1);
  });
});
