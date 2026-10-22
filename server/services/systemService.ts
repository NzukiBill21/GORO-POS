import { prisma } from '../lib/prisma.js';
import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';
import { logActivity } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';

export class NotificationService {
  async list(businessId: string, userId: string, params: PaginationParams & { unreadOnly?: boolean }) {
    const { page = 1, limit = 20, unreadOnly } = params;

    const where = {
      businessId,
      OR: [{ recipientUserId: userId }, { recipientUserId: null }],
      ...(unreadOnly && { isRead: false }),
    };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
      }),
      prisma.notification.count({ where }),
    ]);

    return paginateResult(notifications, total, page, limit);
  }

  async markRead(id: string, businessId: string, userId: string) {
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new AppError('Notification not found', 404);
    if (notification.businessId && notification.businessId !== businessId) {
      throw new AppError('Not authorized to modify this notification', 403);
    }
    if (notification.recipientUserId !== null && notification.recipientUserId !== userId) {
      throw new AppError('Not authorized to modify this notification', 403);
    }
    return prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(businessId: string, userId: string) {
    await prisma.notification.updateMany({
      where: {
        businessId,
        OR: [{ recipientUserId: userId }, { recipientUserId: null }],
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  }

  async getUnreadCount(businessId: string, userId: string) {
    return prisma.notification.count({
      where: {
        businessId,
        OR: [{ recipientUserId: userId }, { recipientUserId: null }],
        isRead: false,
      },
    });
  }
}

export class SettingsService {
  async getAll(businessId: string) {
    const [business, settings, taxes, branches] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.settings.findMany({ where: { businessId } }),
      prisma.tax.findMany({ where: { businessId, isActive: true } }),
      prisma.branch.findMany({ where: { businessId, isActive: true } }),
    ]);

    const settingsMap: Record<string, string> = {};
    settings.forEach((s) => { settingsMap[s.key] = s.value; });

    return { business, settings: settingsMap, taxes, branches };
  }

  async updateBusiness(businessId: string, userId: string, data: Record<string, unknown>) {
    const allowed = ['name', 'legalName', 'email', 'phone', 'address', 'city', 'country', 'taxId', 'logo', 'currency', 'timezone'] as const;
    const updateData: Record<string, unknown> = {};
    for (const key of allowed) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (typeof updateData.currency === 'string') {
      updateData.currency = updateData.currency.toUpperCase().trim();
    }
    const business = await prisma.business.update({ where: { id: businessId }, data: updateData });
    await logActivity({ userId, action: 'UPDATE', module: 'SETTINGS', entityId: businessId, details: 'Updated business info' });
    return business;
  }

  async setSetting(businessId: string, userId: string, key: string, value: string) {
    const setting = await prisma.settings.upsert({
      where: { businessId_key: { businessId, key } },
      update: { value },
      create: { businessId, key, value },
    });
    clearBusinessSettingsCache(businessId);
    await logActivity({
      userId,
      action: 'UPDATE',
      module: 'SETTINGS',
      entityId: businessId,
      details: `Store setting updated: ${key} (applies to all staff on this business)`,
    });
    return setting;
  }

  async createTax(businessId: string, userId: string, data: { name: string; rate: number; isInclusive?: boolean; isDefault?: boolean }) {
    if (data.isDefault) {
      await prisma.tax.updateMany({ where: { businessId }, data: { isDefault: false } });
    }
    const tax = await prisma.tax.create({ data: { businessId, ...data } });
    await logActivity({ userId, action: 'CREATE', module: 'SETTINGS', entityId: tax.id, details: `Created tax: ${tax.name}` });
    return tax;
  }

  async updateTax(id: string, businessId: string, userId: string, data: Record<string, unknown>) {
    const tax = await prisma.tax.findFirst({ where: { id, businessId } });
    if (!tax) throw new AppError('Tax not found', 404);
    return prisma.tax.update({ where: { id }, data });
  }
}

import { assertBranchInBusiness } from '../lib/tenant.js';
import { clearBusinessSettingsCache } from '../lib/businessSettings.js';

export class ReportService {
  async salesReport(businessId: string, params: { startDate: string; endDate: string; branchId?: string }) {
    let branchIds: string[];
    if (params.branchId) {
      await assertBranchInBusiness(params.branchId, businessId);
      branchIds = [params.branchId];
    } else {
      const branches = await prisma.branch.findMany({ where: { businessId }, select: { id: true } });
      branchIds = branches.map((b) => b.id);
    }

    const sales = await prisma.sale.findMany({
      where: {
        branchId: { in: branchIds },
        status: 'COMPLETED',
        createdAt: { gte: new Date(params.startDate), lte: new Date(params.endDate) },
      },
      include: {
        items: true,
        customer: { select: { firstName: true, lastName: true } },
        user: { select: { firstName: true, lastName: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalSales = sales.reduce((s, sale) => s + sale.total, 0);
    const totalOrders = sales.length;
    const avgOrder = totalOrders > 0 ? totalSales / totalOrders : 0;

    const byPayment = sales.flatMap((s) => s.payments).reduce((acc, p) => {
      acc[p.method] = (acc[p.method] || 0) + p.amount;
      return acc;
    }, {} as Record<string, number>);

    const byDay = sales.reduce((acc, s) => {
      const day = s.createdAt.toISOString().split('T')[0];
      acc[day] = (acc[day] || 0) + s.total;
      return acc;
    }, {} as Record<string, number>);

    return { sales, summary: { totalSales, totalOrders, avgOrder, byPayment, byDay } };
  }

  async inventoryReport(businessId: string) {
    const products = await prisma.product.findMany({
      where: { businessId, isActive: true, trackStock: true },
      include: { category: { select: { name: true } }, stocks: true },
    });

    return products.map((p) => ({
      name: p.name,
      sku: p.sku,
      category: p.category?.name,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      stock: p.stocks.reduce((s, st) => s + st.quantity, 0),
      value: p.stocks.reduce((s, st) => s + st.quantity, 0) * p.costPrice,
      minStock: p.minStock,
    }));
  }

  async profitReport(businessId: string, params: { startDate: string; endDate: string; branchId?: string }) {
    let branchIds: string[];
    if (params.branchId) {
      await assertBranchInBusiness(params.branchId, businessId);
      branchIds = [params.branchId];
    } else {
      const branches = await prisma.branch.findMany({ where: { businessId }, select: { id: true } });
      branchIds = branches.map((b) => b.id);
    }

    const saleWhere = {
      branchId: { in: branchIds },
      status: 'COMPLETED' as const,
      createdAt: { gte: new Date(params.startDate), lte: new Date(params.endDate) },
    };

    const [sales, expenses, saleItems] = await Promise.all([
      prisma.sale.aggregate({
        where: saleWhere,
        _sum: { total: true, subtotal: true },
      }),
      prisma.expense.aggregate({
        where: { businessId, date: { gte: new Date(params.startDate), lte: new Date(params.endDate) } },
        _sum: { amount: true },
      }),
      prisma.saleItem.findMany({
        where: { sale: saleWhere },
        select: { quantity: true, costPrice: true },
      }),
    ]);

    const revenue = sales._sum.total ?? 0;
    const expenseTotal = expenses._sum.amount ?? 0;
    const cogs = saleItems.reduce((s, i) => s + i.costPrice * i.quantity, 0);
    const grossProfit = revenue - cogs;
    const profit = grossProfit - expenseTotal;

    const missingCostLines = saleItems.filter((i) => !i.costPrice || i.costPrice <= 0).length;
    const cogsReliable = missingCostLines === 0;

    return {
      revenue,
      cogs,
      grossProfit,
      expenses: expenseTotal,
      profit,
      cogsReliable,
      missingCostLineCount: missingCostLines,
    };
  }

  async retailSummary(
    businessId: string,
    params: { startDate: string; endDate: string; branchId?: string }
  ) {
    let branchIds: string[];
    if (params.branchId) {
      await assertBranchInBusiness(params.branchId, businessId);
      branchIds = [params.branchId];
    } else {
      const branches = await prisma.branch.findMany({ where: { businessId }, select: { id: true } });
      branchIds = branches.map((b) => b.id);
    }

    const saleWhere = {
      branchId: { in: branchIds },
      status: 'COMPLETED' as const,
      createdAt: { gte: new Date(params.startDate), lte: new Date(params.endDate) },
    };

    const sales = await prisma.sale.findMany({
      where: saleWhere,
      include: {
        items: { include: { product: { select: { categoryId: true, name: true, category: { select: { name: true } } } } } },
        payments: true,
      },
    });

    const grossSales = sales.reduce((s, x) => s + x.subtotal, 0);
    const discountTotal = sales.reduce((s, x) => s + (x.discountAmount ?? 0), 0);
    const netSales = sales.reduce((s, x) => s + x.total, 0);

    const byCategory: Record<string, { units: number; revenue: number }> = {};
    const byProduct: Record<string, { name: string; units: number; revenue: number }> = {};
    let cogsKnown = 0;
    let cogsMissingLines = 0;

    for (const sale of sales) {
      for (const item of sale.items) {
        const cat = item.product?.category?.name ?? 'Uncategorised';
        byCategory[cat] = byCategory[cat] ?? { units: 0, revenue: 0 };
        byCategory[cat].units += item.quantity;
        byCategory[cat].revenue += item.total;

        const pid = item.productId;
        if (!byProduct[pid]) {
          byProduct[pid] = { name: item.name, units: 0, revenue: 0 };
        }
        byProduct[pid].units += item.quantity;
        byProduct[pid].revenue += item.total;

        if (item.costPrice > 0) {
          cogsKnown += item.costPrice * item.quantity;
        } else {
          cogsMissingLines += 1;
        }
      }
    }

    const payments = sales.flatMap((s) => s.payments).filter((p) => p.status === 'COMPLETED');
    const byPayment: Record<string, number> = {};
    let cashTendered = 0;
    let cashChange = 0;
    for (const p of payments) {
      const amt = p.amountCents ?? Math.round(p.amount);
      byPayment[p.method] = (byPayment[p.method] ?? 0) + amt;
      if (p.method === 'CASH') {
        cashTendered += p.tenderedCents ?? amt;
        if (p.tenderedCents != null) cashChange += p.tenderedCents - amt;
      }
    }

    const products = await prisma.product.findMany({
      where: { businessId, isActive: true, trackStock: true },
      include: { category: { select: { name: true } }, stocks: true, variants: { include: { stocks: true } } },
    });

    const lowStock: Array<{ name: string; sku?: string | null; stock: number; minStock: number }> = [];
    for (const p of products) {
      const stock = p.stocks.reduce((s, st) => s + st.quantity, 0);
      if (stock <= p.minStock) {
        lowStock.push({ name: p.name, sku: p.sku, stock, minStock: p.minStock });
      }
    }

    return {
      grossSales,
      discountTotal,
      netSales,
      byCategory,
      byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue),
      byPayment,
      cashTendered,
      cashChange,
      cogsKnown,
      grossProfitKnown: netSales - cogsKnown,
      cogsReliable: cogsMissingLines === 0,
      missingCostLineCount: cogsMissingLines,
      lowStock,
    };
  }

  async stockMovementsReport(
    businessId: string,
    params: { startDate: string; endDate: string; limit?: number }
  ) {
    const limit = Math.min(params.limit ?? 200, 500);
    const movements = await prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: new Date(params.startDate), lte: new Date(params.endDate) },
        stock: { product: { businessId } },
      },
      include: {
        stock: {
          include: {
            product: { select: { name: true, sku: true } },
            variant: { select: { name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return movements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      reference: m.reference,
      notes: m.notes,
      createdAt: m.createdAt,
      productName: m.stock.product.name,
      productSku: m.stock.product.sku,
      variantName: m.stock.variant?.name ?? null,
      variantSku: m.stock.variant?.sku ?? null,
    }));
  }
}

export const notificationService = new NotificationService();
export const settingsService = new SettingsService();
export const reportService = new ReportService();
