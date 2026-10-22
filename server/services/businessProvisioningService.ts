import type { PrismaClient } from '@prisma/client';
import { seedPermissionsAndRoles } from '../../prisma/seedBilling.js';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface ProvisionBusinessInput {
  businessName: string;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerPasswordHash: string;
  planCode?: string;
  emailVerified?: boolean;
  mustSetPassword?: boolean;
}

export async function provisionBusinessWithOwner(
  tx: Tx,
  input: ProvisionBusinessInput
): Promise<{ businessId: string; ownerId: string; branchId: string }> {
  const email = input.ownerEmail.trim().toLowerCase();
  const roleIds = await seedPermissionsAndRoles(tx as unknown as PrismaClient);

  const planCode = input.planCode ?? 'REGULAR';
  const plan = await tx.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new Error(`Plan not found: ${planCode}`);

  const business = await tx.business.create({
    data: {
      name: input.businessName.trim(),
      legalName: input.businessName.trim(),
      email,
      currency: 'KES',
      country: 'Kenya',
      status: 'ACTIVE',
    },
  });

  const branch = await tx.branch.create({
    data: { businessId: business.id, name: 'Main', isDefault: true },
  });

  await tx.warehouse.create({
    data: { businessId: business.id, name: 'Main Warehouse', isDefault: true },
  });

  await tx.tax.create({
    data: { businessId: business.id, name: 'VAT', rate: 16, isDefault: true },
  });

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);

  await tx.organizationSubscription.create({
    data: {
      businessId: business.id,
      planId: plan.id,
      billingInterval: 'MONTHLY',
      status: 'TRIALING',
      trialEndsAt: trialEnd,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnd,
      autoRenew: true,
    },
  });

  const owner = await tx.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      roleId: roleIds.manager,
      email,
      passwordHash: input.ownerPasswordHash,
      firstName: input.ownerFirstName.trim(),
      lastName: input.ownerLastName.trim(),
      isActive: true,
      emailVerifiedAt: input.emailVerified ? new Date() : null,
      mustSetPassword: input.mustSetPassword ?? false,
    },
  });

  await tx.business.update({
    where: { id: business.id },
    data: { billingOwnerUserId: owner.id },
  });

  return { businessId: business.id, ownerId: owner.id, branchId: branch.id };
}
