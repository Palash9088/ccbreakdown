export type ParsedTransactionRow = {
  date: string;
  serialNo: string;
  description: string;
  rewardPoints: string;
  amount: string;
  type: "Debit" | "Credit";
};

const DATE_SERNO_RE = /(\d{2}\/\d{2}\/\d{4})\s+(\d{8,})\s+/g;

function escapeCsvField(value: string): string {
  const v = value.trim();
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function parseTransactionTail(rest: string): Omit<ParsedTransactionRow, "date" | "serialNo"> | null {
  const cleaned = rest
    .replace(/\s+Page \d+ of \d+.*$/i, "")
    .replace(/#\s*International Spends.*$/i, "")
    .trim();

  const withPoints = cleaned.match(
    /^(.+?)\s+(-?\d+)\s+([\d,]+\.\d{2})(?:\s+CR)?\s*$/i
  );
  if (withPoints) {
    const isCredit = /CR\s*$/i.test(withPoints[0]);
    return {
      description: withPoints[1].trim(),
      rewardPoints: withPoints[2],
      amount: withPoints[3],
      type: isCredit ? "Credit" : "Debit",
    };
  }

  const amountOnly = cleaned.match(/^(.+?)\s+([\d,]+\.\d{2})(?:\s+CR)?\s*$/i);
  if (amountOnly) {
    const isCredit = /CR\s*$/i.test(amountOnly[0]);
    return {
      description: amountOnly[1].trim(),
      rewardPoints: "",
      amount: amountOnly[2],
      type: isCredit ? "Credit" : "Debit",
    };
  }

  return null;
}

/** Best-effort CSV from raw pdf.js statement text (no AI). */
export function parseTransactionsFromStatementText(
  text: string
): ParsedTransactionRow[] {
  const flat = text.replace(/---\s*Page\s+\d+\s*---/gi, " ");
  const rows: ParsedTransactionRow[] = [];
  const matches = [...flat.matchAll(DATE_SERNO_RE)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const date = match[1];
    const serialNo = match[2];
    const start = (match.index ?? 0) + match[0].length;
    const end =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? flat.length)
        : flat.length;
    const rest = flat.slice(start, end).trim();
    const parsed = parseTransactionTail(rest);
    if (!parsed) continue;

    rows.push({
      date,
      serialNo,
      ...parsed,
    });
  }

  return rows;
}

export function statementTextToCsv(text: string): {
  csv: string;
  rowCount: number;
} {
  const rows = parseTransactionsFromStatementText(text);
  const header =
    "Date,Serial No,Description,Reward Points,Amount,Type";

  if (rows.length === 0) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const fallbackHeader = "Line,Content";
    const fallbackRows = lines.map((line, i) =>
      [String(i + 1), escapeCsvField(line)].join(",")
    );
    return {
      csv: [fallbackHeader, ...fallbackRows].join("\n"),
      rowCount: 0,
    };
  }

  const body = rows.map((r) =>
    [
      escapeCsvField(r.date),
      escapeCsvField(r.serialNo),
      escapeCsvField(r.description),
      escapeCsvField(r.rewardPoints),
      escapeCsvField(r.amount),
      escapeCsvField(r.type),
    ].join(",")
  );

  return {
    csv: [header, ...body].join("\n"),
    rowCount: rows.length,
  };
}
