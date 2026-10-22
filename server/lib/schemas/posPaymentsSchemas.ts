import { z } from 'zod';

export const quoteLineSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive().max(10_000),
  discount: z.number().min(0).optional(),
});

export const checkoutQuoteSchema = z.object({
  items: z.array(quoteLineSchema).min(1).max(500),
  discountAmount: z.number().min(0).optional(),
});

export const checkoutCreateSchema = checkoutQuoteSchema.extend({
  customerId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid().optional(),
  heldSaleId: z.string().uuid().optional(),
});

export const payCashSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  tenderedCents: z.number().int().positive(),
});

export const payMpesaStkSchema = z.object({
  phone: z.string().min(9).max(20),
  amountCents: z.number().int().positive().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const payMpesaManualSchema = z.object({
  transactionCode: z.string().min(8).max(12),
  senderPhone: z.string().min(9).max(20),
  amountCents: z.number().int().positive().optional(),
});

export const paySplitSchema = z.object({
  lines: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'MPESA_MANUAL', 'MPESA_STK']),
        amountCents: z.number().int().positive(),
        phone: z.string().optional(),
        transactionCode: z.string().optional(),
        terminalRef: z.string().optional(),
        last4: z.string().optional(),
        tenderedCents: z.number().int().positive().optional(),
      })
    )
    .min(1)
    .max(10),
});

export const saleIdParamSchema = z.object({
  saleId: z.string().uuid(),
});
