import { prisma } from '../lib/prisma.js';
import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';
import { safeOrderBy } from '../lib/tenant.js';
import { logActivity } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { assertBarcodeUniqueInBusiness } from '../lib/barcodeUnique.js';
import { Prisma } from '@prisma/client';

export type ProductImportRow = {
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  costPrice?: number;
  sellingPrice?: number;
  stock?: number;
  unit?: string;
  minStock?: number;
};

async function assertProductBarcodeUnique(businessId: string, barcode: string | null | undefined, excludeProductId?: string) {
  await assertBarcodeUniqueInBusiness(businessId, barcode, { excludeProductId });
}

export class ProductService {
  async list(businessId: string, params: PaginationParams & { categoryId?: string; favorites?: boolean }) {
    const { page = 1, limit = 20, search, sortBy = 'name', sortOrder = 'asc', categoryId, favorites } = params;
    const where: Prisma.ProductWhereInput = {
      businessId,
      isActive: true,
      ...(categoryId && { categoryId }),
      ...(favorites && { isFavorite: true }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { sku: { contains: search } },
          { barcode: { contains: search } },
        ],
      }),
    };

    const normalizedSort =
      sortBy === 'price' || sortBy === 'sellingPrice'
        ? 'sellingPrice'
        : sortBy === 'stock'
          ? 'name'
          : sortBy;
    const orderBy = safeOrderBy('product', normalizedSort, sortOrder) as Prisma.ProductOrderByWithRelationInput;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          stocks: { select: { quantity: true } },
          variants: { where: { isActive: true }, select: { id: true, name: true, sku: true, barcode: true, sellingPrice: true } },
        },
        orderBy,
        ...skipTake(page, limit),
      }),
      prisma.product.count({ where }),
    ]);

    return paginateResult(
      products.map((p) => ({ ...p, stock: p.stocks.reduce((s, st) => s + st.quantity, 0), stocks: undefined })),
      total,
      page,
      limit
    );
  }

  async getById(id: string, businessId: string) {
    const product = await prisma.product.findFirst({
      where: { id, businessId },
      include: {
        category: true,
        brand: true,
        supplier: true,
        stocks: { include: { warehouse: true } },
        variants: { where: { isActive: true } },
        taxGroup: true,
      },
    });
    if (!product) throw new AppError('Product not found', 404);
    return { ...product, stock: product.stocks.reduce((s, st) => s + st.quantity, 0) };
  }

  async getByBarcode(code: string, businessId: string) {
    const normalized = code.trim();
    if (!normalized) throw new AppError('Product not found', 404);
    const product = await prisma.product.findFirst({
      where: { businessId, OR: [{ barcode: normalized }, { sku: normalized }], isActive: true },
      include: {
        category: { select: { id: true, name: true } },
        stocks: { select: { quantity: true } },
        variants: { where: { isActive: true } },
      },
    });
    if (product) {
      return {
        ...product,
        stock: product.stocks.reduce((s, st) => s + st.quantity, 0),
        stocks: undefined,
        matchedVariantId: null as string | null,
      };
    }

    const variant = await prisma.variant.findFirst({
      where: {
        isActive: true,
        OR: [{ barcode: normalized }, { sku: normalized }],
        product: { businessId, isActive: true },
      },
      include: {
        product: {
          include: {
            category: { select: { id: true, name: true } },
            stocks: { select: { quantity: true, variantId: true } },
            variants: { where: { isActive: true } },
          },
        },
      },
    });
    if (!variant) throw new AppError('Product not found', 404);

    const p = variant.product;
    const variantStock = p.stocks.filter((s) => s.variantId === variant.id).reduce((s, st) => s + st.quantity, 0);
    const stock = variantStock || p.stocks.reduce((s, st) => s + st.quantity, 0);
    return {
      ...p,
      sellingPrice: variant.sellingPrice ?? p.sellingPrice,
      costPrice: variant.costPrice ?? p.costPrice,
      sku: variant.sku ?? p.sku,
      barcode: variant.barcode ?? p.barcode,
      stock,
      stocks: undefined,
      matchedVariantId: variant.id,
      variants: p.variants,
    };
  }

  async create(
    businessId: string,
    userId: string,
    data: Prisma.ProductCreateInput & { initialStock?: number; warehouseId?: string; branchId?: string }
  ) {
    const { initialStock = 0, warehouseId, branchId, ...productData } = data as Record<string, unknown>;

    const barcode = typeof productData.barcode === 'string' ? productData.barcode.trim() : undefined;
    if (barcode) productData.barcode = barcode;
    await assertProductBarcodeUnique(businessId, barcode);

    return prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { ...productData, business: { connect: { id: businessId } } } as Prisma.ProductCreateInput,
        include: { category: true, brand: true },
      });

      if (initialStock > 0) {
        let whId = warehouseId as string | undefined;
        if (!whId) {
          const wh = await tx.warehouse.findFirst({ where: { businessId, isDefault: true } });
          whId = wh?.id;
        }
        if (whId) {
          const stock = await tx.stock.create({
            data: {
              productId: product.id,
              warehouseId: whId,
              branchId: (branchId as string | undefined) ?? undefined,
              quantity: initialStock as number,
            },
          });
          await tx.stockMovement.create({
            data: { stockId: stock.id, type: 'IN', quantity: initialStock as number, reference: 'INITIAL', createdBy: userId },
          });
        }
      }

      await logActivity({ userId, action: 'CREATE', module: 'PRODUCTS', entityId: product.id, details: `Created product: ${product.name}` });
      return product;
    });
  }

  async update(id: string, businessId: string, userId: string, data: Prisma.ProductUpdateInput) {
    const existing = await prisma.product.findFirst({ where: { id, businessId } });
    if (!existing) throw new AppError('Product not found', 404);

    if (typeof data.barcode === 'string') {
      const trimmed = data.barcode.trim();
      data.barcode = trimmed || null;
      await assertProductBarcodeUnique(businessId, trimmed || null, id);
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: { category: true, brand: true },
    });

    await logActivity({ userId, action: 'UPDATE', module: 'PRODUCTS', entityId: id, details: `Updated product: ${product.name}` });
    return product;
  }

  async delete(id: string, businessId: string, userId: string) {
    const existing = await prisma.product.findFirst({ where: { id, businessId } });
    if (!existing) throw new AppError('Product not found', 404);

    await prisma.product.update({ where: { id }, data: { isActive: false } });
    await logActivity({ userId, action: 'DELETE', module: 'PRODUCTS', entityId: id, details: `Deleted product: ${existing.name}` });
    return { success: true };
  }

  async exportAll(businessId: string) {
    return prisma.product.findMany({
      where: { businessId, isActive: true },
      include: { category: { select: { name: true } }, brand: { select: { name: true } }, stocks: { select: { quantity: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createVariant(
    productId: string,
    businessId: string,
    userId: string,
    data: { name: string; sku?: string; barcode?: string; sellingPrice?: number; costPrice?: number }
  ) {
    await this.getById(productId, businessId);
    if (data.barcode?.trim()) {
      await assertBarcodeUniqueInBusiness(businessId, data.barcode.trim());
    }
    const variant = await prisma.variant.create({
      data: {
        productId,
        name: data.name,
        sku: data.sku,
        barcode: data.barcode?.trim() || undefined,
        sellingPrice: data.sellingPrice,
        costPrice: data.costPrice,
      },
    });
    await logActivity({ userId, action: 'CREATE', module: 'PRODUCTS', entityId: variant.id, details: `Variant ${data.name}` });
    return variant;
  }

  async updateVariant(
    productId: string,
    variantId: string,
    businessId: string,
    userId: string,
    data: Partial<{ name: string; sku: string; barcode: string; sellingPrice: number; costPrice: number; isActive: boolean }>
  ) {
    await this.getById(productId, businessId);
    const existing = await prisma.variant.findFirst({ where: { id: variantId, productId } });
    if (!existing) throw new AppError('Variant not found', 404);
    if (typeof data.barcode === 'string' && data.barcode.trim()) {
      await assertBarcodeUniqueInBusiness(businessId, data.barcode.trim(), { excludeVariantId: variantId });
    }
    const variant = await prisma.variant.update({ where: { id: variantId }, data });
    await logActivity({ userId, action: 'UPDATE', module: 'PRODUCTS', entityId: variantId, details: `Updated variant ${variant.name}` });
    return variant;
  }

  async importProducts(
    businessId: string,
    userId: string,
    branchId: string | undefined,
    rows: ProductImportRow[]
  ) {
    if (!rows.length) throw new AppError('No rows to import', 400);

    const defaultWh = await prisma.warehouse.findFirst({ where: { businessId, isDefault: true } });
    if (!defaultWh) throw new AppError('No default warehouse configured', 400);

    const categories = await prisma.category.findMany({ where: { businessId } });
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      if (!row.name?.trim()) continue;
      const sku = row.sku?.trim();
      const barcode = row.barcode?.trim();
      const categoryId = row.category ? byName.get(row.category.toLowerCase()) : undefined;

      const existing =
        sku || barcode
          ? await prisma.product.findFirst({
              where: {
                businessId,
                OR: [...(sku ? [{ sku }] : []), ...(barcode ? [{ barcode }] : [])],
              },
            })
          : await prisma.product.findFirst({ where: { businessId, name: row.name.trim() } });

      const payload = {
        name: row.name.trim(),
        sku: sku || undefined,
        barcode: barcode || undefined,
        costPrice: row.costPrice ?? 0,
        sellingPrice: row.sellingPrice ?? 0,
        unit: row.unit?.trim() || 'pcs',
        minStock: row.minStock ?? 0,
        trackStock: true,
        ...(categoryId ? { categoryId } : {}),
      };

      if (existing) {
        await prisma.product.update({ where: { id: existing.id }, data: payload });
        updated++;
      } else {
        const product = await prisma.product.create({
          data: { ...payload, business: { connect: { id: businessId } }, isActive: true },
        });
        created++;
        const stockQty = Math.max(0, Math.round(row.stock ?? 0));
        if (stockQty > 0) {
          const stock = await prisma.stock.create({
            data: {
              productId: product.id,
              warehouseId: defaultWh.id,
              branchId: branchId ?? undefined,
              quantity: stockQty,
            },
          });
          await prisma.stockMovement.create({
            data: { stockId: stock.id, type: 'IN', quantity: stockQty, reference: 'IMPORT', createdBy: userId },
          });
        }
      }
    }

    await logActivity({
      userId,
      action: 'IMPORT',
      module: 'PRODUCTS',
      details: `Imported products: ${created} created, ${updated} updated`,
    });

    return { created, updated, total: rows.length };
  }

  async generateInternalBarcode(
    productId: string,
    businessId: string,
    userId: string,
    variantId?: string
  ) {
    await this.getById(productId, businessId);
    const code = `INT${businessId.replace(/-/g, '').slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
    await assertBarcodeUniqueInBusiness(businessId, code);

    if (variantId) {
      const variant = await prisma.variant.findFirst({ where: { id: variantId, productId } });
      if (!variant) throw new AppError('Variant not found', 404);
      await prisma.variant.update({
        where: { id: variantId },
        data: { barcode: code },
      });
      await logActivity({
        userId,
        action: 'UPDATE',
        module: 'PRODUCTS',
        entityId: variantId,
        details: `Generated internal barcode for variant ${variant.name}`,
      });
      return { barcode: code, variantId, productId };
    }

    await prisma.product.update({ where: { id: productId }, data: { barcode: code } });
    await logActivity({
      userId,
      action: 'UPDATE',
      module: 'PRODUCTS',
      entityId: productId,
      details: 'Generated internal barcode for product',
    });
    return { barcode: code, productId };
  }
}

export const productService = new ProductService();
