const SORT_WHITELIST: Record<string, string[]> = {
  product: ['name', 'sellingPrice', 'createdAt', 'sku'],
  sale: ['createdAt', 'total', 'invoiceNumber', 'status'],
  customer: ['firstName', 'lastName', 'email', 'createdAt'],
  employee: ['firstName', 'lastName', 'email', 'createdAt'],
  expense: ['date', 'amount', 'category', 'createdAt'],
  purchase: ['createdAt', 'total', 'orderNumber', 'status'],
  inventory: ['name', 'sku'],
};

export function safeOrderBy(entity: string, sortBy?: string, sortOrder: 'asc' | 'desc' = 'asc') {
  const allowed = SORT_WHITELIST[entity] || ['createdAt'];
  const field = sortBy && allowed.includes(sortBy) ? sortBy : allowed[0];
  return { [field]: sortOrder };
}

export async function getBusinessUserIds(businessId: string): Promise<string[]> {
  const { prisma } = await import('./prisma.js');
  const users = await prisma.user.findMany({ where: { businessId }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function assertBranchInBusiness(branchId: string, businessId: string) {
  const { prisma } = await import('./prisma.js');
  const branch = await prisma.branch.findFirst({ where: { id: branchId, businessId } });
  if (!branch) throw new (await import('./errors.js')).AppError('Invalid branch', 403);
  return branch;
}

export async function assertWarehouseInBusiness(warehouseId: string, businessId: string) {
  const { prisma } = await import('./prisma.js');
  const wh = await prisma.warehouse.findFirst({ where: { id: warehouseId, businessId } });
  if (!wh) throw new (await import('./errors.js')).AppError('Invalid warehouse', 403);
  return wh;
}

export async function assertProductInBusiness(productId: string, businessId: string) {
  const { prisma } = await import('./prisma.js');
  const product = await prisma.product.findFirst({ where: { id: productId, businessId } });
  if (!product) throw new (await import('./errors.js')).AppError('Product not found', 404);
  return product;
}

export async function assertCustomerInBusiness(customerId: string, businessId: string) {
  const { prisma } = await import('./prisma.js');
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) throw new (await import('./errors.js')).AppError('Invalid customer', 403);
  return customer;
}

export async function assertSupplierInBusiness(supplierId: string, businessId: string) {
  const { prisma } = await import('./prisma.js');
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, businessId } });
  if (!supplier) throw new (await import('./errors.js')).AppError('Invalid supplier', 403);
  return supplier;
}

export async function assertSessionInBusiness(sessionId: string, businessId: string) {
  const { prisma } = await import('./prisma.js');
  const session = await prisma.session.findFirst({ where: { id: sessionId, businessId } });
  if (!session) throw new (await import('./errors.js')).AppError('Session not found', 404);
  return session;
}
