export interface Transaction {
  id?: string; // Optional local ID for editing/filtering operations
  date: string;
  vendor: string;
  category: string;
  subCategory: string;
  amount: string;
  isCredit: boolean;
}

export interface StatementSummary {
  totalPaymentDue: string;
  minimumPaymentDue: string;
  paymentDueDate: string; // Added payment due date field
  totalPurchases: string;
  totalPayments: string;
  topSpendingCategory: string;
  keyInsight: string;
}

export interface ParsedStatementResponse {
  rawReport: string;
  transactions: Transaction[];
  summary: StatementSummary;
}
