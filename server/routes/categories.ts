import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { categoryCreateSchema } from '../lib/schemas.js';
import { asyncHandler } from '../lib/errors.js';

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

categoriesRouter.get('/', requirePermission('products.view'), asyncHandler(async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { businessId: req.user!.businessId, isActive: true, parentId: null },
    include: {
      _count: { select: { products: true } },
      children: {
        where: { isActive: true },
        include: { _count: { select: { products: true } } },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });
  const withCounts = categories.map((cat) => {
    const childProductCount = cat.children.reduce((sum, ch) => sum + ch._count.products, 0);
    return {
      ...cat,
      _count: { products: cat._count.products + childProductCount },
    };
  });
  res.json(withCounts);
}));

categoriesRouter.post('/', requirePermission('products.create'), validate(categoryCreateSchema), asyncHandler(async (req, res) => {
  const category = await prisma.category.create({
    data: { ...req.body, businessId: req.user!.businessId },
  });
  res.status(201).json(category);
}));
