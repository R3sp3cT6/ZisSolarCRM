export type Role = 'admin' | 'viewer';
export const roleLabels: Record<Role, string> = {admin: 'Администратор', viewer: 'Само преглед'};
export function isAdmin(user: {role: Role} | null | undefined) {return user?.role === 'admin';}
