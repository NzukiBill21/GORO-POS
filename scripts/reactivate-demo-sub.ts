import { prisma } from '../server/lib/prisma.js';

const business = await prisma.business.findFirst({ where: { name: 'Demo Store' } });
if (!business) throw new Error('Demo Store not found');

const periodEnd = new Date();
periodEnd.setMonth(periodEnd.getMonth() + 1);

await prisma.organizationSubscription.updateMany({
  where: { businessId: business.id },
  data: {
    status: 'ACTIVE',
    gracePeriodEndsAt: null,
    currentPeriodStart: new Date(),
    currentPeriodEnd: periodEnd,
  },
});
await prisma.business.update({
  where: { id: business.id },
  data: { status: 'ACTIVE' },
});

console.log('Demo Store subscription reactivated until', periodEnd.toISOString());
await prisma.$disconnect();
