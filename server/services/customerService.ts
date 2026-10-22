import { prisma } from '../lib/prisma.js';
import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';
import { logActivity } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { Prisma } from '@prisma/client';

export class CustomerService {
  async list(businessId: string, params: PaginationParams) {
    const { page = 1, limit = 20, search, sortBy = 'firstName', sortOrder = 'asc' } = params;

    const where: Prisma.CustomerWhereInput = {
      businessId,
      isActive: true,
      ...(search && {
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { phone: { contains: search } },
          { email: { contains: search } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        ...skipTake(page, limit),
      }),
      prisma.customer.count({ where }),
    ]);

    return paginateResult(customers, total, page, limit);
  }

  async getById(id: string, businessId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, businessId },
      include: {
        sales: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, invoiceNumber: true, total: true, status: true, createdAt: true },
        },
      },
    });
    if (!customer) throw new AppError('Customer not found', 404);
    return customer;
  }

  async create(businessId: string, userId: string, data: Prisma.CustomerCreateInput) {
    const customer = await prisma.customer.create({
      data: { ...data, business: { connect: { id: businessId } } },
    });
    await logActivity({ userId, action: 'CREATE', module: 'CUSTOMERS', entityId: customer.id, details: `Created customer: ${customer.firstName}` });
    return customer;
  }

  async update(id: string, businessId: string, userId: string, data: Prisma.CustomerUpdateInput) {
    const existing = await prisma.customer.findFirst({ where: { id, businessId } });
    if (!existing) throw new AppError('Customer not found', 404);

    const customer = await prisma.customer.update({ where: { id }, data });
    await logActivity({ userId, action: 'UPDATE', module: 'CUSTOMERS', entityId: id, details: `Updated customer: ${customer.firstName}` });
    return customer;
  }

  async delete(id: string, businessId: string, userId: string) {
    const existing = await prisma.customer.findFirst({ where: { id, businessId } });
    if (!existing) throw new AppError('Customer not found', 404);

    await prisma.customer.update({ where: { id }, data: { isActive: false } });
    await logActivity({ userId, action: 'DELETE', module: 'CUSTOMERS', entityId: id, details: `Deleted customer: ${existing.firstName}` });
    return { success: true };
  }

  async addLoyaltyPoints(id: string, businessId: string, points: number, userId: string) {
    const customer = await prisma.customer.findFirst({ where: { id, businessId } });
    if (!customer) throw new AppError('Customer not found', 404);

    const updated = await prisma.customer.update({
      where: { id },
      data: { loyaltyPoints: customer.loyaltyPoints + points },
    });
    await logActivity({ userId, action: 'UPDATE', module: 'CUSTOMERS', entityId: id, details: `Added ${points} loyalty points` });
    return updated;
  }
}

export const customerService = new CustomerService();
