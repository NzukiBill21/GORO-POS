import { prisma } from './prisma.js';
import { AppError } from './errors.js';

/** Resolve a branch for POS/sales when the user has none assigned. */
export async function resolveBranchIdForBusiness(
  businessId: string,
  preferredBranchId?: string | null
): Promise<string> {
  if (preferredBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: preferredBranchId, businessId, isActive: true },
    });
    if (branch) return branch.id;
  }

  const defaultBranch =
    (await prisma.branch.findFirst({
      where: { businessId, isActive: true, isDefault: true },
    })) ??
    (await prisma.branch.findFirst({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    }));

  if (!defaultBranch) {
    throw new AppError('No store branch is configured for this business. Contact your administrator.', 400);
  }

  return defaultBranch.id;
}

/** Ensure user has a branch; backfill default on the user record when missing. */
export async function ensureUserBranchId(userId: string, businessId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { branchId: true, businessId: true },
  });
  if (!user || user.businessId !== businessId) return undefined;
  if (user.branchId) return user.branchId;

  const branchId = await resolveBranchIdForBusiness(businessId);
  await prisma.user.update({
    where: { id: userId },
    data: { branchId },
  });
  return branchId;
}
