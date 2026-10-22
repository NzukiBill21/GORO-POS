import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email').max(255),
  password: z.string().min(1, 'Password required').max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  sessionId: z.string().uuid(),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email().max(255),
});

export const passwordResetSchema = z
  .object({
    email: z.string().email().max(255).optional(),
    code: z
      .string()
      .regex(/^\d{6}$/, 'Code must be 6 digits')
      .optional(),
    token: z.string().min(16).max(256).optional(),
    password: z.string().min(12).max(128),
  })
  .refine((data) => Boolean(data.token) || (Boolean(data.email) && Boolean(data.code)), {
    message: 'Provide either token or email with code',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().max(200).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

export const productCreateSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(50).optional(),
  barcode: z.string().max(50).optional(),
  costPrice: z.number().min(0).optional().default(0),
  sellingPrice: z.number().min(0),
  wholesalePrice: z.number().min(0).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  brandId: z.string().uuid().optional().nullable(),
  minStock: z.number().int().min(0).optional().default(0),
  trackStock: z.boolean().optional().default(true),
  isFavorite: z.boolean().optional().default(false),
  initialStock: z.number().int().min(0).optional().default(0),
});

export const saleCreateSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    name: z.string().min(1),
    sku: z.string().optional(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().min(0),
    costPrice: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    taxAmount: z.number().min(0).optional(),
    total: z.number().min(0),
  })).min(1),
  discountAmount: z.number().min(0).optional().default(0),
  taxAmount: z.number().min(0).optional().default(0),
  notes: z.string().max(500).optional(),
  status: z.enum(['DRAFT', 'HELD']).optional().default('HELD'),
  payments: z.array(z.object({
    method: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK', 'CREDIT', 'GIFT_CARD']),
    amount: z.number().min(0),
    reference: z.string().max(100).optional(),
  })).optional(),
});

export const inventoryAdjustSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number().int().min(1),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT']),
  reason: z.string().min(3, 'Reason is required').max(500),
  notes: z.string().max(500).optional(),
});

export const inventoryTransferSchema = z.object({
  productId: z.string().uuid(),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  quantity: z.number().int().min(1),
  reason: z.string().min(3, 'Reason is required').max(500),
});

export const customerCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional(),
  address: z.string().max(300).optional(),
  creditLimit: z.number().min(0).optional().default(0),
  notes: z.string().max(500).optional(),
});

export const expenseCreateSchema = z.object({
  category: z.string().min(1).max(100),
  amount: z.number().min(0.01),
  description: z.string().max(500).optional(),
  reference: z.string().max(100).optional(),
  date: z.string().optional(),
});

export const employeeCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  roleId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  phone: z.string().max(20).optional(),
});

export const employeeInviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  roleId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  phone: z.string().max(20).optional(),
});

export const employeeUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  roleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  phone: z.string().max(20).optional(),
  password: z.string().min(8).max(128).optional(),
  pin: z.string().max(20).optional().nullable(),
});

export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  parentId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const settingsUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legalName: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(50).optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

export function validateFileUpload(mimetype: string, size: number, filename: string): { valid: boolean; error?: string } {
  if (!ALLOWED_UPLOAD_TYPES.includes(mimetype)) {
    return { valid: false, error: 'File type not allowed. Use JPEG, PNG, WebP, or GIF.' };
  }
  if (size > MAX_UPLOAD_SIZE) {
    return { valid: false, error: 'File size exceeds 5MB limit' };
  }
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (sanitized !== filename) {
    return { valid: false, error: 'Filename contains invalid characters' };
  }
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return { valid: false, error: 'Invalid file extension' };
  }
  return { valid: true };
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}
