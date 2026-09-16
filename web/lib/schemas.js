import { z } from 'zod';

export const createOrderSchema = z.object({
  buyerName: z.string().trim().min(3).max(120),
  buyerEmail: z.string().trim().email().max(180),
  documentType: z.string().trim().max(12).optional().or(z.literal('')),
  documentNumber: z.string().trim().max(32).optional().or(z.literal(''))
});

export const orderTokenSchema = z.object({
  orderToken: z.string().trim().min(32).max(128)
});

export const cardPaymentSchema = orderTokenSchema.extend({
  token: z.string().trim().min(8).max(512),
  paymentMethodId: z.string().trim().min(1).max(40),
  issuerId: z.union([z.string(), z.number()]).optional().nullable(),
  installments: z.coerce.number().int().min(1).max(24),
  identificationType: z.string().trim().max(12).optional().or(z.literal('')),
  identificationNumber: z.string().trim().max(32).optional().or(z.literal(''))
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(200)
});

export const clientLoginSchema = adminLoginSchema;

export const clientMagicLinkRequestSchema = z.object({
  email: z.string().trim().email().max(180)
});

export const clientSetPasswordSchema = z.object({
  password: z.string().min(8).max(200)
});
