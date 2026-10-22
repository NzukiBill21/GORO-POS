import { PrismaClient } from '@prisma/client';
import { hashPasswordUnsafe } from '../server/lib/password.js';
import { seedPermissionsAndRoles, seedPlans, seedOrganizationSubscription, seedPlatform } from './seedBilling.js';

const prisma = new PrismaClient();

async function main() {
  if (process.env.DESKTOP_MODE === 'true') {
    console.error('Demo seed refused: DESKTOP_MODE is enabled. Use the first-run setup wizard instead.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error('Demo seed refused in production. Set ALLOW_DEMO_SEED=true only on intentional dev hosts.');
    process.exit(1);
  }
  console.log('Seeding database...');

  const createdRoles = await seedPermissionsAndRoles(prisma);
  await seedPlans(prisma);
  await seedPlatform(prisma);
  const business = await prisma.business.upsert({
    where: { id: 'demo-business' },
    update: { currency: 'KES' },
    create: {
      id: 'demo-business',
      name: 'Demo Store',
      legalName: 'Demo Store Ltd',
      email: 'info@demostore.com',
      phone: '+254 700 000000',
      address: '123 Kenyatta Avenue',
      city: 'Nairobi',
      country: 'Kenya',
      currency: 'KES',
    },
  });

  // Branch
  const branch = await prisma.branch.upsert({
    where: { id: 'demo-branch' },
    update: {},
    create: {
      id: 'demo-branch',
      businessId: business.id,
      name: 'Main Store',
      address: '123 Main Street, New York',
      isDefault: true,
    },
  });

  // Warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { id: 'demo-warehouse' },
    update: {},
    create: {
      id: 'demo-warehouse',
      businessId: business.id,
      name: 'Main Warehouse',
      isDefault: true,
    },
  });

  const demoPassword = 'DemostoreAdmin1!';
  const passwordHash = await hashPasswordUnsafe(demoPassword);
  const managerUser = await prisma.user.upsert({
    where: { email: 'admin@demostore.com' },
    update: { passwordHash, roleId: createdRoles.manager },
    create: {
      businessId: business.id,
      branchId: branch.id,
      roleId: createdRoles.manager,
      email: 'admin@demostore.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      pin: '1234',
    },
  });

  await seedOrganizationSubscription(prisma, business.id, 'BUSINESS', managerUser.id);

  const demoStaff = [
    { email: 'manager@demostore.com', firstName: 'Mary', lastName: 'Manager', role: 'manager', pin: '2345' },
    { email: 'supervisor@demostore.com', firstName: 'Sam', lastName: 'Supervisor', role: 'supervisor', pin: '3456' },
    { email: 'cashier@demostore.com', firstName: 'Chris', lastName: 'Cashier', role: 'cashier', pin: '4567' },
  ];
  for (const staff of demoStaff) {
    await prisma.user.upsert({
      where: { email: staff.email },
      update: { passwordHash, roleId: createdRoles[staff.role] },
      create: {
        businessId: business.id,
        branchId: branch.id,
        roleId: createdRoles[staff.role],
        email: staff.email,
        passwordHash,
        firstName: staff.firstName,
        lastName: staff.lastName,
        pin: staff.pin,
      },
    });
  }

  // Tax
  const tax = await prisma.tax.upsert({
    where: { id: 'demo-tax' },
    update: {},
    create: {
      id: 'demo-tax',
      businessId: business.id,
      name: 'Sales Tax',
      rate: 8.25,
      isDefault: true,
    },
  });

  // Categories — upsert to prevent duplicates on re-seed
  const categoryDefs = [
    { id: 'cat-beverages', name: 'Beverages', sortOrder: 1 },
    { id: 'cat-snacks', name: 'Snacks', sortOrder: 2 },
    { id: 'cat-dairy', name: 'Dairy', sortOrder: 3 },
    { id: 'cat-produce', name: 'Produce', sortOrder: 4 },
    { id: 'cat-bakery', name: 'Bakery', sortOrder: 5 },
    { id: 'cat-frozen', name: 'Frozen', sortOrder: 6 },
    { id: 'cat-household', name: 'Household', sortOrder: 7 },
  ];

  const createdCategories: Record<string, string> = {};
  for (const cat of categoryDefs) {
    const created = await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: cat.name, sortOrder: cat.sortOrder, isActive: true },
      create: { id: cat.id, businessId: business.id, name: cat.name, sortOrder: cat.sortOrder },
    });
    createdCategories[cat.name] = created.id;
  }

  // Remove orphan/duplicate categories from prior seed runs
  await prisma.category.deleteMany({
    where: {
      businessId: business.id,
      id: { notIn: categoryDefs.map((c) => c.id) },
    },
  });

  // Units of measure
  const unitDefs = [
    { id: 'unit-pcs', name: 'Pieces', abbreviation: 'pcs' },
    { id: 'unit-kg', name: 'Kilogram', abbreviation: 'kg' },
    { id: 'unit-l', name: 'Liter', abbreviation: 'L' },
    { id: 'unit-box', name: 'Box', abbreviation: 'box' },
  ];
  for (const u of unitDefs) {
    await prisma.unit.upsert({
      where: { id: u.id },
      update: { name: u.name, abbreviation: u.abbreviation },
      create: { id: u.id, businessId: business.id, name: u.name, abbreviation: u.abbreviation },
    });
  }

  // Brands
  const brands = ['Coca-Cola', 'Pepsi', 'Nestle', 'Kraft', 'General Mills'];
  const createdBrands: Record<string, string> = {};
  for (const brandName of brands) {
    const created = await prisma.brand.create({
      data: { businessId: business.id, name: brandName },
    });
    createdBrands[brandName] = created.id;
  }

  // Products
  const products = [
    { name: 'Coca-Cola 330ml', sku: 'BEV-001', barcode: '049000028911', category: 'Beverages', brand: 'Coca-Cola', cost: 0.75, price: 1.99, stock: 120 },
    { name: 'Pepsi 330ml', sku: 'BEV-002', barcode: '012000161155', category: 'Beverages', brand: 'Pepsi', cost: 0.70, price: 1.89, stock: 95 },
    { name: 'Orange Juice 1L', sku: 'BEV-003', barcode: '041270933012', category: 'Beverages', brand: 'Nestle', cost: 2.50, price: 4.99, stock: 45 },
    { name: 'Potato Chips', sku: 'SNK-001', barcode: '028400090000', category: 'Snacks', brand: 'Kraft', cost: 1.20, price: 2.99, stock: 80 },
    { name: 'Chocolate Bar', sku: 'SNK-002', barcode: '034000050000', category: 'Snacks', brand: 'Nestle', cost: 0.80, price: 1.49, stock: 150 },
    { name: 'Whole Milk 1L', sku: 'DRY-001', barcode: '041900000000', category: 'Dairy', brand: 'Kraft', cost: 1.50, price: 3.49, stock: 60 },
    { name: 'Cheddar Cheese 200g', sku: 'DRY-002', barcode: '041900000001', category: 'Dairy', brand: 'Kraft', cost: 2.00, price: 4.99, stock: 35 },
    { name: 'Bananas (kg)', sku: 'PRD-001', barcode: '4011', category: 'Produce', brand: 'General Mills', cost: 0.50, price: 1.29, stock: 200 },
    { name: 'Apples (kg)', sku: 'PRD-002', barcode: '4016', category: 'Produce', brand: 'General Mills', cost: 1.00, price: 2.49, stock: 75 },
    { name: 'White Bread', sku: 'BAK-001', barcode: '071000000000', category: 'Bakery', brand: 'General Mills', cost: 1.00, price: 2.49, stock: 40 },
    { name: 'Croissant', sku: 'BAK-002', barcode: '071000000001', category: 'Bakery', brand: 'General Mills', cost: 0.60, price: 1.99, stock: 25 },
    { name: 'Frozen Pizza', sku: 'FRZ-001', barcode: '071000000002', category: 'Frozen', brand: 'General Mills', cost: 3.00, price: 6.99, stock: 30 },
    { name: 'Ice Cream 500ml', sku: 'FRZ-002', barcode: '071000000003', category: 'Frozen', brand: 'Nestle', cost: 2.50, price: 5.99, stock: 20 },
    { name: 'Paper Towels', sku: 'HHD-001', barcode: '036000000000', category: 'Household', brand: 'General Mills', cost: 2.00, price: 4.99, stock: 50 },
    { name: 'Dish Soap', sku: 'HHD-002', barcode: '036000000001', category: 'Household', brand: 'General Mills', cost: 1.50, price: 3.99, stock: 8, minStock: 10 },
    { name: 'Mineral Water 500ml', sku: 'BEV-004', barcode: '049000028912', category: 'Beverages', brand: 'Coca-Cola', cost: 0.30, price: 0.99, stock: 200, isFavorite: true },
    { name: 'Energy Drink', sku: 'BEV-005', barcode: '049000028913', category: 'Beverages', brand: 'Pepsi', cost: 1.50, price: 3.49, stock: 65, isFavorite: true },
    { name: 'Granola Bar Box', sku: 'SNK-003', barcode: '034000050001', category: 'Snacks', brand: 'General Mills', cost: 3.00, price: 5.99, stock: 45, isFavorite: true },
  ];

  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { businessId: business.id, sku: p.sku } });
    if (existing) continue;

    const product = await prisma.product.create({
      data: {
        businessId: business.id,
        categoryId: createdCategories[p.category],
        brandId: createdBrands[p.brand],
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        costPrice: p.cost,
        sellingPrice: p.price,
        minStock: (p as { minStock?: number }).minStock ?? 5,
        isFavorite: (p as { isFavorite?: boolean }).isFavorite ?? false,
        taxGroupId: tax.id,
      },
    });

    await prisma.stock.create({
      data: {
        productId: product.id,
        warehouseId: warehouse.id,
        branchId: branch.id,
        quantity: p.stock,
      },
    });
  }

  // Sample Customers
  const customers = [
    { firstName: 'John', lastName: 'Smith', email: 'john@email.com', phone: '+1 555-0101', loyaltyPoints: 150 },
    { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah@email.com', phone: '+1 555-0102', loyaltyPoints: 320 },
    { firstName: 'Mike', lastName: 'Williams', email: 'mike@email.com', phone: '+1 555-0103', loyaltyPoints: 75 },
    { firstName: 'Emily', lastName: 'Brown', email: 'emily@email.com', phone: '+1 555-0104', loyaltyPoints: 500 },
    { firstName: 'David', lastName: 'Davis', phone: '+1 555-0105', loyaltyPoints: 25 },
  ];

  for (const c of customers) {
    await prisma.customer.create({
      data: { businessId: business.id, ...c },
    });
  }

  // Sample sales for dashboard
  const admin = await prisma.user.findUnique({ where: { email: 'admin@demostore.com' } });
  const allProducts = await prisma.product.findMany({ where: { businessId: business.id }, take: 5 });

  for (let i = 0; i < 15; i++) {
    const daysAgo = Math.floor(Math.random() * 7);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(Math.floor(Math.random() * 12) + 8);

    const numItems = Math.floor(Math.random() * 3) + 1;
    const items = [];
    let subtotal = 0;

    for (let j = 0; j < numItems; j++) {
      const product = allProducts[Math.floor(Math.random() * allProducts.length)];
      const qty = Math.floor(Math.random() * 3) + 1;
      const total = product.sellingPrice * qty;
      subtotal += total;
      items.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: qty,
        unitPrice: product.sellingPrice,
        costPrice: product.costPrice,
        total,
      });
    }

    const taxAmount = subtotal * 0.0825;
    const total = subtotal + taxAmount;

    await prisma.sale.create({
      data: {
        branchId: branch.id,
        userId: admin!.id,
        invoiceNumber: `INV-${date.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        status: 'COMPLETED',
        subtotal,
        taxAmount,
        total,
        amountPaid: total,
        createdAt: date,
        items: { create: items },
        payments: { create: [{ method: Math.random() > 0.5 ? 'CASH' : 'CARD', amount: total }] },
      },
    });
  }

  console.log('Seed completed successfully!');
  console.log(`Demo logins (password ${demoPassword} for all):`);
  console.log('  admin@demostore.com — Manager (billing owner)');
  console.log('  manager@demostore.com — Manager');
  console.log('  supervisor@demostore.com — Supervisor');
  console.log('  cashier@demostore.com — Cashier');
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@gorovian.com';
  console.log(`Platform admin: ${platformEmail} (password from PLATFORM_ADMIN_PASSWORD in .env)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
