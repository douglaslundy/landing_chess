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

export const lessonSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  contentType: z.enum(['pdf', 'video']),
  url: z.string().trim().max(2000).refine(
    (value) => /^https?:\/\//i.test(value),
    { message: 'URL deve começar com http:// ou https://' }
  ),
  position: z.coerce.number().int(),
  published: z.boolean().optional().default(true)
});

export const settingsUpdateSchema = z.object({
  product_title: z.string().trim().min(1).max(200),
  product_description: z.string().trim().max(2000),
  product_amount_cents: z.coerce.number().int().positive(),
  product_currency: z.string().trim().length(3),
  mercadopago_public_key: z.string().trim().max(500),
  mercadopago_access_token: z.string().trim().max(500),
  mercadopago_webhook_secret: z.string().trim().max(500),
  smtp_host: z.string().trim().max(255),
  smtp_port: z.coerce.number().int().min(1).max(65535),
  smtp_secure: z.boolean(),
  smtp_user: z.string().trim().max(255),
  smtp_password: z.string().trim().max(500),
  email_from: z.string().trim().email().max(255),
  email_reply_to: z.string().trim().email().max(255).or(z.literal('')),
  product_access_url: z.string().trim().max(2000).refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    { message: 'URL deve começar com http:// ou https://' }
  )
}).partial();

export const testEmailSchema = z.object({
  to: z.string().trim().email().max(255)
});
