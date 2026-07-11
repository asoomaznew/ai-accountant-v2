import { z } from 'zod';

export const InvoiceSchema = z.object({
  accountName: z.string().min(1, "Account name is required"),
  accountNumber: z.string(),
  transactions: z.array(z.object({
    date: z.string(),
    description: z.string(),
    amount: z.number(),
    type: z.enum(['credit', 'debit'])
  }))
});

export type InvoiceData = z.infer<typeof InvoiceSchema>;
