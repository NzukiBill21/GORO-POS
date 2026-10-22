import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/stats', requirePermission('dashboard.view'), async (req, res) => {
  try {
    const { businessId, branchId } = req.user!;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const branchFilter = branchId ? { branchId } : { branch: { businessId } };

    const [
      todaySales,
      weekSales,
      monthSales,
      recentSales,
      lowStockProducts,
      topProducts,
      totalProducts,
    ] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfDay } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfWeek } },
        _sum: { total: true },
      }),
      prisma.sale.aggregate({
        where: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      prisma.sale.findMany({
        where: { ...branchFilter, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          customer: { select: { firstName: true, lastName: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.product.findMany({
        where: {
          businessId,
          isActive: true,
          trackStock: true,
        },
        include: {
          stocks: true,
          category: { select: { name: true } },
        },
        take: 20,
      }),
      prisma.saleItem.groupBy({
        by: ['productId', 'name'],
        where: { sale: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfMonth } } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      prisma.product.count({ where: { businessId, isActive: true } }),
    ]);

    const lowStock = lowStockProducts
      .map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category?.name,
        stock: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
        minStock: p.minStock,
      }))
      .filter((p) => p.stock <= p.minStock)
      .slice(0, 10);

    const inventoryValue = lowStockProducts.reduce((sum, p) => {
      const stock = p.stocks.reduce((s, st) => s + st.quantity, 0);
      return sum + stock * p.costPrice;
    }, 0);

    const todayProfit = await prisma.saleItem.aggregate({
      where: {
        sale: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfDay } },
      },
      _sum: { total: true },
    });

    const todayCost = await prisma.saleItem.aggregate({
      where: {
        sale: { ...branchFilter, status: 'COMPLETED', createdAt: { gte: startOfDay } },
      },
      _sum: { costPrice: true },
    });

    const profit = (todayProfit._sum.total ?? 0) - (todayCost._sum.costPrice ?? 0) * 1;

    // Chart data - last 7 days
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(startOfDay);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const daySales = await prisma.sale.aggregate({
        where: {
          ...branchFilter,
          status: 'COMPLETED',
          createdAt: { gte: date, lt: nextDate },
        },
        _sum: { total: true },
        _count: true,
      });

      chartData.push({
        date: date.toISOString().split('T')[0],
        sales: daySales._sum.total ?? 0,
        orders: daySales._count,
      });
    }

    res.json({
      todaySales: todaySales._sum.total ?? 0,
      todayOrders: todaySales._count,
      todayProfit: profit,
      weekSales: weekSales._sum.total ?? 0,
      monthSales: monthSales._sum.total ?? 0,
      inventoryValue,
      totalProducts,
      cashInDrawer: todaySales._sum.total ?? 0,
      lowStock,
      topProducts: topProducts.map((p) => ({
        id: p.productId,
        name: p.name,
        quantity: p._sum.quantity ?? 0,
        revenue: p._sum.total ?? 0,
      })),
      recentTransactions: recentSales.map((s) => ({
        id: s.id,
        invoiceNumber: s.invoiceNumber,
        total: s.total,
        customer: s.customer
          ? `${s.customer.firstName} ${s.customer.lastName ?? ''}`.trim()
          : 'Walk-in',
        cashier: `${s.user.firstName} ${s.user.lastName}`,
        createdAt: s.createdAt,
      })),
      chartData,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});
