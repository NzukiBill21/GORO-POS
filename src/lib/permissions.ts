/** Client-side permission checks — API-returned permissions are the source of truth. */

const PERMISSION_ALIASES: Record<string, string[]> = {
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

function permissionMatches(userPerms: string[], required: string): boolean {
  if (userPerms.includes('*')) return true;
  if (userPerms.includes(required)) return true;
  return (PERMISSION_ALIASES[required] ?? []).some((alias) => userPerms.includes(alias));
}

export function hasPermission(_role: string, permission: string, userPermissions?: string[]): boolean {
  if (!userPermissions?.length) return false;
  return permissionMatches(userPermissions, permission);
}

export function exportToCSV<T extends Record<string, unknown>>(data: T[], filename: string, columns?: { key: keyof T; label: string }[]) {
  if (!data.length) return;
  const cols = columns || Object.keys(data[0]).map((k) => ({ key: k as keyof T, label: String(k) }));
  const header = cols.map((c) => c.label).join(',');
  const rows = data.map((row) =>
    cols.map((c) => {
      const val = row[c.key];
      const str = val == null ? '' : String(val);
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToJSON<T>(data: T[], filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
