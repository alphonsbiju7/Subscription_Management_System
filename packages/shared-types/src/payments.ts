export type DemoMethod = "UPI" | "CARD" | "NET_BANKING";
export type DemoOutcome = "SUCCESS" | "FAILURE";
export type RecoveryStatus = "PENDING" | "RECOVERED" | "EXHAUSTED";
export type CheckoutInvoice = {
  id: string;
  number: string;
  customer: { id: string; name: string };
  subscriptionId: string;
  currency: string;
  total: string;
  dueAt: string;
  outstanding: string;
  paymentStatus: string;
};
export type RecoveryCase = {
  id: string;
  invoiceId: string;
  status: RecoveryStatus;
  method: DemoMethod;
  retryOutcome: DemoOutcome;
  retryCount: number;
  retryDays: number[];
  nextRetryAt: string | null;
  lastFailure: string;
  resolvedAt: string | null;
  createdAt: string;
  invoice: CheckoutInvoice;
};
export type DemoAttempt = {
  id: string;
  invoiceId: string;
  recoveryId: string | null;
  transactionReference: string;
  method: DemoMethod;
  outcome: DemoOutcome;
  amount: string;
  failureReason: string | null;
  retryNumber: number;
  createdAt: string;
  invoice: CheckoutInvoice;
  recovery: Omit<RecoveryCase, "invoice"> | null;
  payment: {
    id: string;
    reference: string;
    receivedAt: string;
    notes: string;
  } | null;
};
export type RecoverySummary = {
  failedPayments: number;
  pendingRetries: number;
  recoveredPayments: number;
  exhaustedCases: number;
};
