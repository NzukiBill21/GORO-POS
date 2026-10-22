import { prisma } from './prisma.js';

type UserSetupFields = {
  id: string;
  mustSetPassword: boolean;
  passwordChangedAt: Date | null;
};

/** Owner completed password via invite/reset but flag was left set — unblock login/API. */
export async function reconcileMustSetPassword(user: UserSetupFields): Promise<boolean> {
  if (!user.mustSetPassword) return false;
  if (!user.passwordChangedAt) return false;
  await prisma.user.update({
    where: { id: user.id },
    data: { mustSetPassword: false },
  });
  return true;
}
