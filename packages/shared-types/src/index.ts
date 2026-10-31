export const roles = [
  "ADMIN",
  "SALES",
  "FINANCE",
  "SUPPORT",
  "CUSTOMER",
] as const;
export type Role = (typeof roles)[number];
export const intervals = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Interval = (typeof intervals)[number];
export type Actor = {
  id: string;
  role: Role;
  customerId: string | null;
  requestId?: string;
};
export type Money = string;
