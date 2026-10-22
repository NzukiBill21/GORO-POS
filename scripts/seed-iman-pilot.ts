/**
 * Provisions Iman High Street (founder pilot) without modifying Demo Store data.
 * Run: npx tsx scripts/seed-iman-pilot.ts
 */
import { PrismaClient } from '@prisma/client';
import { hashPasswordUnsafe } from '../server/lib/password.js';
import { seedPermissionsAndRoles, seedPlans } from '../prisma/seedBilling.js';
import { grantPilotEntitlement } from '../server/services/pilotService.js';

const IMAN_BUSINESS_ID = 'iman-highstreet-business';
const IMAN_BRANCH_ID = 'iman-highstreet-branch';

async function main() {
  const prisma = new PrismaClient();
  const roles = await seedPermissionsAndRoles(prisma);
  await seedPlans(prisma);

  const platformAdmin = await prisma.platformUser.findFirst({ where: { isActive: true } });
  if (!platformAdmin) {
    console.error('No platform admin — run npm run db:seed first.');
    process.exit(1);
  }

  const business = await prisma.business.upsert({
    where: { id: IMAN_BUSINESS_ID },
    update: { name: 'Iman High Street', currency: 'KES' },
    create: {
      id: IMAN_BUSINESS_ID,
      name: 'Iman High Street',
      legalName: 'Iman High Street',
      email: 'shop@imanhighstreet.local',
      phone: '+254700000001',
      address: 'High Street',
      city: 'Nairobi',
      country: 'Kenya',
      currency: 'KES',
    },
  });

  await prisma.branch.upsert({
    where: { id: IMAN_BRANCH_ID },
    update: {},
    create: {
      id: IMAN_BRANCH_ID,
      businessId: business.id,
      name: 'Shop Floor',
      isDefault: true,
    },
  });

  await prisma.warehouse.upsert({
    where: { id: 'iman-warehouse' },
    update: {},
    create: {
      id: 'iman-warehouse',
      businessId: business.id,
      name: 'Store Stock',
      isDefault: true,
    },
  });

  const passwordHash = await hashPasswordUnsafe('ImanShop123!');
  const owner = await prisma.user.upsert({
    where: { email: 'owner@imanhighstreet.local' },
    update: { passwordHash, roleId: roles.manager },
    create: {
      businessId: business.id,
      branchId: IMAN_BRANCH_ID,
      roleId: roles.manager,
      email: 'owner@imanhighstreet.local',
      passwordHash,
      firstName: 'Iman',
      lastName: 'Owner',
      pin: '9999',
    },
  });

  await prisma.tax.upsert({
    where: { id: 'iman-tax' },
    update: { rate: 16, name: 'VAT', isDefault: true },
    create: {
      id: 'iman-tax',
      businessId: business.id,
      name: 'VAT',
      rate: 16,
      isDefault: true,
    },
  });

  const plan = await prisma.plan.findUnique({ where: { code: 'PRO' } });
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 10);

  await prisma.organizationSubscription.upsert({
    where: { id: `sub-${IMAN_BUSINESS_ID}` },
    update: {
      planId: plan!.id,
      status: 'ACTIVE',
      autoRenew: false,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    create: {
      id: `sub-${IMAN_BUSINESS_ID}`,
      businessId: business.id,
      planId: plan!.id,
      billingInterval: 'MONTHLY',
      status: 'ACTIVE',
      autoRenew: false,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: { billingOwnerUserId: owner.id, billingPhone: '254712345678' },
  });

  await grantPilotEntitlement({
    businessId: business.id,
    planCode: 'PRO',
    platformUserId: platformAdmin.id,
    notes: 'Founder-sponsored pilot — no recurring GOROVIAN billing',
  });

  console.log('Iman High Street pilot ready.');
  console.log('  Login: owner@imanhighstreet.local / ImanShop123!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
