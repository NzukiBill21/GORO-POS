import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { employeeService } from '../server/services/employeeService.js';
import { login, changePassword } from '../server/services/authService.js';
import { authenticate } from '../server/middleware/auth.js';

describe('local account provisioning', () => {
  const businessId = 'demo-business';
  let managerId: string;
  let createdUserId: string | undefined;
  const tempPassword = 'LocalStaffTemp1!';
  const newPassword = 'LocalStaffFinal1!';
  const email = `local-staff-${Date.now()}@example.com`;

  afterAll(async () => {
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
    }
  });

  it('creates a user with mustChangePassword and allows login', async () => {
    const manager = await prisma.user.findFirst({
      where: { businessId, email: 'manager@demostore.com' },
    });
    expect(manager).toBeTruthy();
    managerId = manager!.id;

    const role = await prisma.role.findFirst({ where: { name: 'cashier' } });
    expect(role).toBeTruthy();

    const created = await employeeService.create(businessId, managerId, {
      email,
      password: tempPassword,
      firstName: 'Local',
      lastName: 'Staff',
      roleId: role!.id,
    });
    createdUserId = created.id;

    const row = await prisma.user.findUnique({ where: { id: created.id } });
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.mustSetPassword).toBe(false);
    expect(row?.emailVerifiedAt).toBeTruthy();

    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    const session = await login(email, tempPassword, fakeReq);
    expect(session.user.mustChangePassword).toBe(true);
    expect(session.accessToken).toBeTruthy();
  });

  it('blocks protected API until password is changed', async () => {
    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    const session = await login(email, tempPassword, fakeReq);

    const req = {
      headers: { authorization: `Bearer ${session.accessToken}` },
      user: undefined,
    } as import('express').Request;
    const res = {
      statusCode: 200,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    } as import('express').Response & { statusCode: number; body: unknown };

    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('clears mustChangePassword after change and allows API access', async () => {
    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    const session = await login(email, tempPassword, fakeReq);
    await changePassword(session.user.id, tempPassword, newPassword, fakeReq);

    const row = await prisma.user.findUnique({ where: { id: session.user.id } });
    expect(row?.mustChangePassword).toBe(false);

    const session2 = await login(email, newPassword, fakeReq);
    const req = {
      headers: { authorization: `Bearer ${session2.accessToken}` },
      user: undefined,
    } as import('express').Request;
    const res = {
      statusCode: 200,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    } as import('express').Response & { statusCode: number; body: unknown };

    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
