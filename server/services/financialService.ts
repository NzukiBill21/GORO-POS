import { prisma } from '../lib/prisma.js';
import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';
import { logActivity } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { safeOrderBy } from '../lib/tenant.js';
import { Prisma } from '@prisma/client';

export class FinancialService {
  async listExpenses(businessId: string, params: PaginationParams & { category?: string; startDate?: string; endDate?: string }) {
    const { page = 1, limit = 20, search, category, startDate, endDate, sortBy, sortOrder = 'desc' } = params;

    const where: Prisma.ExpenseWhereInput = {
      businessId,
      ...(category && { category }),
      ...(search && { description: { contains: search } }),
      ...(startDate || endDate
        ? { date: { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) } }
        : {}),
    };

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true } }, branch: { select: { name: true } } },
        orderBy: safeOrderBy('expense', sortBy, sortOrder),
        ...skipTake(page, limit),
      }),
      prisma.expense.count({ where }),
    ]);

    return paginateResult(expenses, total, page, limit);
  }

  async createExpense(businessId: string, userId: string, data: {
    category: string;
    amount: number;
    description?: string;
    reference?: string;
    date?: string;
    branchId?: string;
  }) {
    const expense = await prisma.expense.create({
      data: {
        businessId,
        userId,
        branchId: data.branchId,
        category: data.category,
        amount: data.amount,
        description: data.description,
        reference: data.reference,
        date: data.date ? new Date(data.date) : new Date(),
      },
    });

    await logActivity({ userId, action: 'CREATE', module: 'FINANCIALS', entityId: expense.id, details: `Expense: ${data.category} $${data.amount}` });
    return expense;
  }

  async deleteExpense(id: string, businessId: string, userId: string) {
    const expense = await prisma.expense.findFirst({ where: { id, businessId } });
    if (!expense) throw new AppError('Expense not found', 404);

    await prisma.expense.delete({ where: { id } });
    await logActivity({ userId, action: 'DELETE', module: 'FINANCIALS', entityId: id, details: `Deleted expense $${expense.amount}` });
    return { success: true };
  }

  async getSummary(businessId: string, branchId?: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const branchFilter = branchId ? { branchId } : { branch: { businessId } };

    const [monthSales, todaySales, monthExpenses, todayExpenses] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      prisma.sale.aggregate({
        where: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfDay } },
        _sum: { total: true },
      }),
      prisma.expense.aggregate({
        where: { businessId, date: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { businessId, date: { gte: startOfDay } },
        _sum: { amount: true },
      }),
    ]);

    const monthIncome = monthSales._sum.total ?? 0;
    const monthExpenseTotal = monthExpenses._sum.amount ?? 0;

    return {
      todayIncome: todaySales._sum.total ?? 0,
      todayExpenses: todayExpenses._sum.amount ?? 0,
      monthIncome,
      monthExpenses: monthExpenseTotal,
      monthProfit: monthIncome - monthExpenseTotal,
      todayProfit: (todaySales._sum.total ?? 0) - (todayExpenses._sum.amount ?? 0),
    };
  }

  async listTaxes(businessId: string) {
    return prisma.tax.findMany({ where: { businessId, isActive: true }, orderBy: { name: 'asc' } });
  }
}

export const financialService = new FinancialService();
