import { prisma } from '../server/lib/prisma.js';

const subs = await prisma.organizationSubscription.findMany({
  include: { business: { select: { name: true, status: true } } },
});
console.log(JSON.stringify(subs.map((x) => ({
  org: x.business.name,
  businessStatus: x.business.status,
  subStatus: x.status,
  periodEnd: x.currentPeriodEnd,
})), null, 2));
await prisma.$disconnect();
