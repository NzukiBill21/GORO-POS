import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { hashPasswordUnsafe } from '../lib/password.js';
import { seedPermissionsAndRoles } from '../../prisma/seedBilling.js';

export async function getDesktopSetupStatus() {
  const userCount = await prisma.user.count();
  return {
    needsSetup: userCount === 0,
    desktopMode: process.env.DESKTOP_MODE === 'true',
  };
}

export async function completeDesktopSetup(input: {
  businessName: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFirstName: string;
  ownerLastName: string;
  currency?: string;
}) {
  if (process.env.DESKTOP_MODE !== 'true') {
    throw new AppError('Setup is only available in desktop mode', 403);
  }
  const status = await getDesktopSetupStatus();
  if (!status.needsSetup) throw new AppError('Setup already completed', 409);

  if (input.ownerPassword.length < 10) {
    throw new AppError('Password must be at least 10 characters', 400);
  }

  const roleIds = await seedPermissionsAndRoles(prisma);

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: input.businessName.trim(),
        legalName: input.businessName.trim(),
        email: input.ownerEmail.trim().toLowerCase(),
        currency: input.currency ?? 'KES',
        country: 'Kenya',
        status: 'ACTIVE',
      },
    });

    const branch = await tx.branch.create({
      data: {
        businessId: business.id,
        name: 'Main',
        isDefault: true,
      },
    });

    await tx.warehouse.create({
      data: { businessId: business.id, name: 'Main Warehouse', isDefault: true },
    });

    await tx.tax.create({
      data: { businessId: business.id, name: 'VAT', rate: 16, isDefault: true },
    });

    const passwordHash = await hashPasswordUnsafe(input.ownerPassword);
    const owner = await tx.user.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        roleId: roleIds.manager,
        email: input.ownerEmail.trim().toLowerCase(),
        passwordHash,
        firstName: input.ownerFirstName.trim(),
        lastName: input.ownerLastName.trim(),
        isActive: true,
      },
    });

    return { businessId: business.id, ownerId: owner.id, email: owner.email };
  });
}
