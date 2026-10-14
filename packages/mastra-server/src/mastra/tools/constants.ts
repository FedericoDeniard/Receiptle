export const CATEGORY_VALUES = [
  "salary",
  "entertainment",
  "investment",
  "food",
  "transport",
  "services",
  "health",
  "education",
  "housing",
  "clothing",
  "taxes",
  "other",
] as const;

export const TRANSACTION_TYPE_VALUES = ["income", "expense"] as const;

export const REPORT_STATUS_VALUES = ["active", "archived"] as const;
export const REPORT_LIST_STATUS_VALUES = [
  ...REPORT_STATUS_VALUES,
  "all",
] as const;
