/**
 * Fix owner email before accept-invite, then send a fresh invitation.
 * Usage: npx tsx scripts/repoint-owner-invite.ts <businessId> <newEmail>
 */
import { prisma } from '../server/lib/prisma.js';
import { createOwnerInvitationForUser } from '../server/services/onboardingService.js';

const businessId = process.argv[2]?.trim();
const newEmail = process.argv[3]?.trim().toLowerCase();

async function main() {
  if (!businessId || !newEmail) {
    console.error('Usage: npx tsx scripts/repoint-owner-invite.ts <businessId> <newEmail>');
    process.exit(1);
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, billingOwnerUserId: true },
  });
  if (!business?.billingOwnerUserId) throw new Error('Business or billing owner not found');

  const owner = await prisma.user.findUnique({
    where: { id: business.billingOwnerUserId },
    select: { id: true, email: true, mustSetPassword: true },
  });
  if (!owner) throw new Error('Owner user not found');
  if (!owner.mustSetPassword) {
    throw new Error('Owner already completed setup — change email in tenant settings instead');
  }

  const clash = await prisma.user.findFirst({
    where: { email: newEmail, id: { not: owner.id } },
  });
  if (clash) throw new Error(`Email already used by another user (${clash.id})`);

  await prisma.user.update({
    where: { id: owner.id },
    data: { email: newEmail },
  });

  const platform = await prisma.platformUser.findFirst({ where: { isActive: true } });
  const delivery = await createOwnerInvitationForUser({
    userId: owner.id,
    businessId: business.id,
    email: newEmail,
    invitedByPlatformUserId: platform?.id,
  });

  console.log(`Owner for "${business.name}" updated to ${newEmail}`);
  console.log('Delivery:', delivery.deliveryStatus, delivery.emailDeliveryError ?? '');
  if (delivery.devHint) console.log(delivery.devHint);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
