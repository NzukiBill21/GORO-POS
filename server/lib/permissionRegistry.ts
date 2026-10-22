/** Central permission registry — single source of truth for RBAC */

export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',

  POS_ACCESS: 'pos.access',
  POS_SELL: 'pos.sell',
  POS_REFUND: 'pos.refund',
  POS_DISCOUNT: 'pos.discount',
  POS_VOID: 'pos.void',

  SALES_VIEW: 'sales.view',
  SALES_CREATE: 'sales.create',
  SALES_EDIT: 'sales.edit',
  SALES_DELETE: 'sales.delete',
  SALES_REFUND: 'sales.refund',

  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_CREATE: 'inventory.create',
  INVENTORY_EDIT: 'inventory.edit',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_APPROVE: 'inventory.approve',

  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',

  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_APPROVE: 'purchases.approve',
  PURCHASES_EDIT: 'purchases.edit',

  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_CREDIT: 'customers.credit',
  CUSTOMERS_DELETE: 'customers.delete',

  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_CREATE: 'suppliers.create',
  SUPPLIERS_EDIT: 'suppliers.edit',

  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_CREATE: 'expenses.create',
  EXPENSES_APPROVE: 'expenses.approve',
  EXPENSES_EDIT: 'expenses.edit',

  REPORTS_VIEW: 'reports.view',
  REPORTS_FINANCIAL: 'reports.financial',
  REPORTS_PROFIT: 'reports.profit',
  REPORTS_CASHIER: 'reports.cashier',
  REPORTS_INVENTORY: 'reports.inventory',

  STAFF_VIEW: 'staff.view',
  STAFF_CREATE: 'staff.create',
  STAFF_EDIT: 'staff.edit',
  STAFF_DISABLE: 'staff.disable',

  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',

  BRANCHES_VIEW: 'branches.view',
  BRANCHES_MANAGE: 'branches.manage',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  AUDIT_VIEW: 'audit.view',

  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
  BILLING_PAY: 'billing.pay',
  BILLING_INVOICE_VIEW: 'billing.invoice.view',

  SUBSCRIPTION_VIEW: 'subscription.view',
  SUBSCRIPTION_MANAGE: 'subscription.manage',

  NOTIFICATIONS_VIEW: 'notifications.view',
  SECURITY_VIEW: 'security.view',
  SECURITY_MANAGE: 'security.manage',

  // Legacy aliases mapped in routes
  POS_VIEW: 'pos.view',
  POS_CREATE: 'pos.create',
  EMPLOYEES_VIEW: 'employees.view',
  EMPLOYEES_CREATE: 'employees.create',
  EMPLOYEES_EDIT: 'employees.edit',
  EMPLOYEES_DELETE: 'employees.delete',
  FINANCIALS_VIEW: 'financials.view',
  FINANCIALS_CREATE: 'financials.create',
  FINANCIALS_EDIT: 'financials.edit',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PLATFORM_PERMISSIONS = {
  ORGANIZATIONS_VIEW: 'platform.organizations.view',
  ORGANIZATIONS_MANAGE: 'platform.organizations.manage',
  BILLING_MANAGE: 'platform.billing.manage',
  AUDIT_VIEW: 'platform.audit.view',
  USERS_MANAGE: 'platform.users.manage',
  SETTINGS_MANAGE: 'platform.settings.manage',
} as const;

/** All tenant permissions for seeding */
export const ALL_TENANT_PERMISSIONS: Array<{ name: string; module: string; action: string }> = [
  ...Object.values(PERMISSIONS).map((name) => {
    const [module, ...rest] = name.split('.');
    return { name, module, action: rest.join('.') };
  }),
];

export const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.POS_ACCESS, PERMISSIONS.POS_SELL, PERMISSIONS.POS_REFUND, PERMISSIONS.POS_DISCOUNT, PERMISSIONS.POS_VOID,
    PERMISSIONS.POS_VIEW, PERMISSIONS.POS_CREATE,
    PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_EDIT, PERMISSIONS.SALES_REFUND,
    PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CREATE, PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.INVENTORY_TRANSFER, PERMISSIONS.INVENTORY_APPROVE,
    PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.PRODUCTS_EDIT, PERMISSIONS.PRODUCTS_DELETE,
    PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_CREATE, PERMISSIONS.PURCHASES_EDIT, PERMISSIONS.PURCHASES_APPROVE,
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT, PERMISSIONS.CUSTOMERS_CREDIT, PERMISSIONS.CUSTOMERS_DELETE,
    PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_CREATE, PERMISSIONS.SUPPLIERS_EDIT,
    PERMISSIONS.EXPENSES_VIEW, PERMISSIONS.EXPENSES_CREATE, PERMISSIONS.EXPENSES_EDIT, PERMISSIONS.EXPENSES_APPROVE,
    PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_FINANCIAL, PERMISSIONS.REPORTS_PROFIT, PERMISSIONS.REPORTS_CASHIER, PERMISSIONS.REPORTS_INVENTORY,
    PERMISSIONS.STAFF_VIEW, PERMISSIONS.STAFF_CREATE, PERMISSIONS.STAFF_EDIT, PERMISSIONS.STAFF_DISABLE,
    PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_CREATE, PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.EMPLOYEES_DELETE,
    PERMISSIONS.ROLES_VIEW, PERMISSIONS.ROLES_MANAGE,
    PERMISSIONS.BRANCHES_VIEW, PERMISSIONS.BRANCHES_MANAGE,
    PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_MANAGE, PERMISSIONS.BILLING_PAY, PERMISSIONS.BILLING_INVOICE_VIEW,
    PERMISSIONS.SUBSCRIPTION_VIEW, PERMISSIONS.SUBSCRIPTION_MANAGE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.SECURITY_VIEW, PERMISSIONS.SECURITY_MANAGE,
    PERMISSIONS.FINANCIALS_VIEW, PERMISSIONS.FINANCIALS_CREATE, PERMISSIONS.FINANCIALS_EDIT,
  ],
  supervisor: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.POS_ACCESS, PERMISSIONS.POS_SELL, PERMISSIONS.POS_REFUND, PERMISSIONS.POS_VIEW, PERMISSIONS.POS_CREATE,
    PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_EDIT, PERMISSIONS.SALES_REFUND,
    PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_EDIT, PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.INVENTORY_APPROVE,
    PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_EDIT,
    PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_CREATE,
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT,
    PERMISSIONS.SUPPLIERS_VIEW,
    PERMISSIONS.EXPENSES_VIEW, PERMISSIONS.EXPENSES_CREATE,
    PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_CASHIER, PERMISSIONS.REPORTS_INVENTORY,
    PERMISSIONS.STAFF_VIEW,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.FINANCIALS_VIEW, PERMISSIONS.FINANCIALS_CREATE,
  ],
  cashier: [
    PERMISSIONS.POS_ACCESS, PERMISSIONS.POS_SELL, PERMISSIONS.POS_VIEW, PERMISSIONS.POS_CREATE,
    PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_CREATE,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_CREATE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ],
  // Legacy tenant admin — migrate to manager permissions
  administrator: [] as string[],
};

ROLE_PERMISSION_MAP.administrator = ROLE_PERMISSION_MAP.manager;

export const PLATFORM_ADMIN_PERMISSIONS = Object.values(PLATFORM_PERMISSIONS);

/** Legacy ↔ canonical permission aliases (either satisfies a check) */
export const PERMISSION_ALIASES: Record<string, string[]> = {
  'pos.view': ['pos.access'],
  'pos.access': ['pos.view'],
  'pos.create': ['pos.sell'],
  'pos.sell': ['pos.create'],
  'employees.view': ['staff.view'],
  'staff.view': ['employees.view'],
  'employees.create': ['staff.create'],
  'staff.create': ['employees.create'],
  'employees.edit': ['staff.edit'],
  'staff.edit': ['employees.edit'],
  'employees.delete': ['staff.disable'],
  'staff.disable': ['employees.delete'],
};

export function permissionMatches(userPerms: string[], required: string): boolean {
  if (userPerms.includes('*')) return true;
  if (userPerms.includes(required)) return true;
  return (PERMISSION_ALIASES[required] ?? []).some((alias) => userPerms.includes(alias));
}

/** Roles a tenant user can be assigned — never platform_admin */
export const ASSIGNABLE_TENANT_ROLES = ['manager', 'supervisor', 'cashier'] as const;

/** Forbidden role assignments */
export const FORBIDDEN_TENANT_ROLES = ['platform_admin', 'admin', 'administrator'] as const;
