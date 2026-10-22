import { prisma } from './prisma.js';

/** Invalidate all JWTs by bumping tokenVersion (password change, role change). */
export async function bumpUserTokenVersion(userId: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 }, forceLogoutAt: new Date() },
    select: { tokenVersion: true },
  });
  return user.tokenVersion;
}
