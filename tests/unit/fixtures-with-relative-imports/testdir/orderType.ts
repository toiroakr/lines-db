// Type definition for Order
// This file is imported by the schema file using a relative path
// to test that relative imports work correctly on Windows

export interface OrderType {
  id: number;
  customerId: number;
  amount: number;
  status: 'pending' | 'completed' | 'cancelled';
}

export const ORDER_STATUSES = ['pending', 'completed', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
