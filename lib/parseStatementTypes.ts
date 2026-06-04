export type ApiErrorBody = {
  error: string;
  message: string;
};

export type ParseStatementSuccess = {
  ok: true;
  data: unknown;
};

export type ParseStatementFailure = {
  ok: false;
  status: number;
  body: ApiErrorBody;
};

export type ParseStatementResult = ParseStatementSuccess | ParseStatementFailure;

export type ParseStatementInput = {
  file?: string;
  text?: string;
  password?: string;
  apiKey?: string;
};
