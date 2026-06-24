import React, { useState, useMemo } from "react";
import {
  FileText,
  Lock,
  UploadCloud,
  Download,
  Copy,
  Check,
  Search,
  Filter,
  Eye,
  EyeOff,
  AlertCircle,
  TrendingUp,
  RotateCcw,
  Sparkles,
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  FileSpreadsheet,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Transaction, StatementSummary, ParsedStatementResponse } from "./types";
import { extractPdfInBrowser } from "./lib/extractPdfInBrowser";
import { parseStatementWithClientKey } from "./lib/parseWithGeminiClient";
import { fetchParseApi, getApiErrorMessage } from "./lib/parseApiResponse";
import type { ParseStatementResult } from "../lib/parseStatementTypes";

const LOADING_STEPS = [
  { title: "Decrypt & Load", desc: "Opening your PDF securely in the browser" },
  { title: "Extract Text", desc: "Reading statement pages locally (not sent as PDF to server)" },
  { title: "AI Categorization", desc: "Structuring transactions with Gemini (browser or server)" },
];

export default function App() {
  // App states
  const [fileBase64, setFileBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [passwordRequired, setPasswordRequired] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem("gemini_api_key") || "");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const [loadingStep, setLoadingStep] = useState<number>(0);

  React.useEffect(() => {
    let interval: any;
    if (loading) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev < 2 ? prev + 1 : prev));
      }, 2500);
    }
    return () => {
      clearInterval(interval);
    };
  }, [loading]);

  // Parse result states
  const [report, setReport] = useState<ParsedStatementResponse | null>(null);
  
  // Edited state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [isEditingSummary, setIsEditingSummary] = useState<boolean>(false);

  // Helper to change summary statistics values
  const handleSummaryChange = (field: keyof StatementSummary, value: string) => {
    if (!summary) return;
    setSummary({
      ...summary,
      [field]: value,
    });
  };

  // Filters & Interactivity
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [typeFilter, setTypeFilter] = useState<string>("All"); // 'All', 'Debit', 'Credit'

  // Inline Editing states
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editedRowData, setEditedRowData] = useState<Transaction | null>(null);

  // Copy Feedback
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false);
  const [copiedState, setCopiedState] = useState<boolean>(false);
  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // Trigger Toast Alert
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  // Helper to standard format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Process File upload and read base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
  };

  const processSelectedFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError({
        message: "Invalid file type",
        detail: "Only credit card statement PDF documents are supported for parsing.",
      });
      return;
    }

    setFileName(file.name);
    setFileSize(formatBytes(file.size));
    setError(null);
    setPasswordRequired(false);
    setPassword("");
    setReport(null);

    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        const base64Str = (reader.result as string).split(",")[1];
        setFileBase64(base64Str);
      }
    };
    reader.onerror = () => {
      setError({ message: "File Reading Failed", detail: "Could not read bytes of the uploaded PDF statement." });
    };
    reader.readAsDataURL(file);
  };

  // Handle drag over
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const applyParseSuccess = (parsed: ParsedStatementResponse) => {
    setReport(parsed);
    const processedTransactions = (parsed.transactions || []).map((t, index: number) => ({
      ...t,
      id: `txn-${Date.now()}-${index}`,
    }));
    setTransactions(processedTransactions);
    setSummary(parsed.summary);
    setPasswordRequired(false);
    triggerToast("Statement successfully parsed and categorized!");
  };

  const applyParseFailure = (
    result: Extract<ParseStatementResult, { ok: false }>,
    filePassword?: string
  ): boolean => {
    const handled = getApiErrorMessage(result.status, result.body, filePassword);
    if (handled?.passwordRequired) {
      setPasswordRequired(true);
      setError({ message: handled.message, detail: handled.detail });
      return true;
    }
    if (handled) {
      setError({ message: handled.message, detail: handled.detail });
      return true;
    }
    setError({
      message: "Parsing failed",
      detail: result.body.message,
    });
    return true;
  };

  const runGeminiParse = async (
    statementText: string,
    filePassword?: string
  ): Promise<boolean> => {
    setLoadingStep(2);

    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      const clientResult = await parseStatementWithClientKey(
        statementText,
        trimmedKey
      );
      if (clientResult.ok) {
        applyParseSuccess(clientResult.data as ParsedStatementResponse);
        return true;
      }
      if (clientResult.ok === false && applyParseFailure(clientResult, filePassword)) {
        return false;
      }
      // Fall through to server with the same key if client parse failed unexpectedly
    }

    try {
      const { ok, status, data } = await fetchParseApi("/api/parse-text", {
        text: statementText,
        apiKey: trimmedKey || undefined,
      });

      if (!ok) {
        const handled = getApiErrorMessage(
          status,
          data as { error?: string; message?: string },
          filePassword
        );
        if (handled?.passwordRequired) {
          setPasswordRequired(true);
          setError({ message: handled.message, detail: handled.detail });
          return false;
        }
        if (handled) {
          setError({ message: handled.message, detail: handled.detail });
          if (
            (status === 504 || /timeout/i.test(handled.detail)) &&
            !trimmedKey
          ) {
            setError({
              message: "Processing timed out",
              detail:
                handled.detail +
                " Enter your Gemini API key above to parse in the browser and avoid Vercel timeouts.",
            });
          }
          return false;
        }
        throw new Error(
          (typeof data.message === "string" && data.message) ||
            "An error occurred while parsing the credit card statement."
        );
      }

      applyParseSuccess(data as unknown as ParsedStatementResponse);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|timed out/i.test(msg) && !trimmedKey) {
        setError({
          message: "Processing timed out",
          detail:
            msg +
            " Enter your Gemini API key above to parse in the browser (skips Vercel).",
        });
        return false;
      }
      throw err;
    }
  };

  const parsePDF = async (base64Payload: string, filePassword?: string) => {
    setLoading(true);
    setError(null);
    setLoadingStep(0);

    try {
      setLoadingStep(1);
      const extractResult = await extractPdfInBrowser(
        base64Payload,
        filePassword
      );

      if (extractResult.ok === false) {
        if (extractResult.error === "PASSWORD_REQUIRED") {
          setPasswordRequired(true);
          setError({
            message: filePassword ? "Incorrect PDF Password" : "Password Required",
            detail: extractResult.message,
          });
          return;
        }
        setError({
          message:
            extractResult.error === "PDF_EMPTY"
              ? "No readable text"
              : "Could not read PDF",
          detail: extractResult.message,
        });
        return;
      }

      await runGeminiParse(extractResult.text, filePassword);
    } catch (err: unknown) {
      console.error(err);
      setError({
        message: "Extraction Failure",
        detail:
          err instanceof Error
            ? err.message
            : "System encountered issues trying to parse transactions out of this document.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileBase64) return;
    parsePDF(fileBase64, password.trim() || undefined);
  };

  // Unique categories list for filters
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    transactions.forEach((t) => {
      if (t.category) cats.add(t.category);
    });
    return ["All", ...Array.from(cats)];
  }, [transactions]);

  // Filtered transactions computed safely
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Search matches
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        t.vendor.toLowerCase().includes(searchLower) ||
        t.category.toLowerCase().includes(searchLower) ||
        (t.subCategory && t.subCategory.toLowerCase().includes(searchLower)) ||
        t.date.toLowerCase().includes(searchLower);

      // Category matches
      const matchesCategory = categoryFilter === "All" || t.category === categoryFilter;

      // Type matcher
      const matchesType =
        typeFilter === "All" ||
        (typeFilter === "Credit" && t.isCredit) ||
        (typeFilter === "Debit" && !t.isCredit);

      return matchesSearch && matchesCategory && matchesType;
    });
  }, [transactions, searchTerm, categoryFilter, typeFilter]);

  // Format to print amount nicely or format raw strings
  const formatAmount = (amt: string, isCr: boolean) => {
    let clean = amt.toUpperCase();
    if (isCr && !clean.includes("CR")) {
      // Check if negative
      if (clean.includes("-") || parseFloat(clean.replace(/[^\d.]/g, "")) < 0) {
        return clean; // Already structured negative
      }
      return `${clean} (CR)`;
    }
    return clean;
  };

  // Clipboard Copiers
  const copyRawMarkdown = () => {
    if (!report?.rawReport) return;
    navigator.clipboard.writeText(report.rawReport);
    setCopiedRaw(true);
    triggerToast("Formatted Markdown report copied to clipboard!");
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  // Re-generate markdown on user transactions edits
  const currentModifiedMarkdown = useMemo(() => {
    if (!summary) return "";
    
    // Generate Table
    let tbl = "Date | Vendor | Category | Sub-Category | Amount (Rs)\n";
    tbl += "--- | --- | --- | --- | ---\n";
    transactions.forEach((t) => {
      tbl += `${t.date} | ${t.vendor} | ${t.category} | ${t.subCategory || "N/A"} | ${t.amount}\n`;
    });

    // Generate list including paymentDueDate
    const bulletList = `Total Payment Due: ${summary.totalPaymentDue}
Minimum Payment Due: ${summary.minimumPaymentDue}
Payment Due Date: ${summary.paymentDueDate || "N/A"}
Total Purchases/Debits: ${summary.totalPurchases}
Total Payments/Credits: ${summary.totalPayments}
Top Spending Category: ${summary.topSpendingCategory}
Key Insight: ${summary.keyInsight}`;

    return `The Transaction Table\n\n${tbl}\n\nSummary Statistics\n\n${bulletList}`;
  }, [transactions, summary]);

  const copyModifiedMarkdown = () => {
    navigator.clipboard.writeText(currentModifiedMarkdown);
    setCopiedState(true);
    triggerToast("Updated Markdown report copied to clipboard!");
    setTimeout(() => setCopiedState(false), 2000);
  };

  // Export as standard CSV including full summary data
  const exportToCSV = () => {
    if (transactions.length === 0) return;
    
    let csvContent = "Date,Vendor,Category,Sub-Category,Amount,Type\n";
    
    // Append each transaction row
    transactions.forEach((t) => {
      const csvRow = [
        `"${t.date.replace(/"/g, '""')}"`,
        `"${t.vendor.replace(/"/g, '""')}"`,
        `"${t.category.replace(/"/g, '""')}"`,
        `"${t.subCategory.replace(/"/g, '""')}"`,
        `"${t.amount.replace(/"/g, '""')}"`,
        t.isCredit ? "Credit" : "Debit"
      ].join(",");
      csvContent += csvRow + "\n";
    });

    // Append Summary Statistics Section to the bottom of the CSV
    if (summary) {
      csvContent += "\n";
      csvContent += "Summary Statistics\n";
      csvContent += "Metric,Value\n";
      csvContent += `Total Payment Due,"${summary.totalPaymentDue.replace(/"/g, '""')}"\n`;
      csvContent += `Minimum Payment Due,"${summary.minimumPaymentDue.replace(/"/g, '""')}"\n`;
      csvContent += `Payment Due Date,"${(summary.paymentDueDate || "N/A").replace(/"/g, '""')}"\n`;
      csvContent += `Total Purchases/Debits,"${summary.totalPurchases.replace(/"/g, '""')}"\n`;
      csvContent += `Total Payments/Credits,"${summary.totalPayments.replace(/"/g, '""')}"\n`;
      csvContent += `Top Spending Category,"${summary.topSpendingCategory.replace(/"/g, '""')}"\n`;
      csvContent += `Key Insight,"${summary.keyInsight.replace(/"/g, '""')}"\n`;
    }

    // High performance Blob URI delivery
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const reportName = fileName ? fileName.replace(".pdf", "") : "statement_report";
    link.setAttribute("download", `${reportName}_categorized.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    triggerToast("CSV statement with summary data downloaded successfully!");
  };

  // Resets parsing
  const resetAll = () => {
    setFileBase64("");
    setFileName("");
    setFileSize("");
    setPassword("");
    setPasswordRequired(false);
    setError(null);
    setReport(null);
    setTransactions([]);
    setSummary(null);
    setSearchTerm("");
    setCategoryFilter("All");
    setTypeFilter("All");
    setEditingRowIndex(null);
    setEditedRowData(null);
  };

  // CRUD modifications
  const startEditing = (index: number, txn: Transaction) => {
    setEditingRowIndex(index);
    setEditedRowData({ ...txn });
  };

  const cancelEditing = () => {
    setEditingRowIndex(null);
    setEditedRowData(null);
  };

  const saveEditedRow = (index: number) => {
    if (!editedRowData) return;
    const items = [...transactions];
    items[index] = editedRowData;
    setTransactions(items);
    setEditingRowIndex(null);
    setEditedRowData(null);
    triggerToast("Transaction updated successfully!");
  };

  const deleteRow = (index: number) => {
    const items = transactions.filter((_, i) => i !== index);
    setTransactions(items);
    triggerToast("Transaction row removed from temporary sheet.");
  };

  const addEmptyRow = () => {
    const newTxn: Transaction = {
      id: `txn-added-${Date.now()}`,
      date: new Date().toLocaleDateString("en-IN"),
      vendor: "New Vendor",
      category: "Miscellaneous",
      subCategory: "General Goods",
      amount: "₹0.00",
      isCredit: false,
    };
    setTransactions([newTxn, ...transactions]);
    startEditing(0, newTxn);
    triggerToast("Empty transaction row appended!");
  };

  return (
    <div className="relative min-h-screen bg-[#FAF9F5] pb-24 text-[#202020]">
      {/* Dynamic Toast Feedback Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed top-6 right-6 z-50 flex items-center gap-2.5 rounded-full bg-neutral-900 px-5 py-3 text-xs tracking-wide text-white font-medium shadow-2xl shadow-neutral-900/30 border border-neutral-800"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header section */}
      <header className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[#B58A3D] uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Statement Parser Workflow</span>
            </div>
            <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-neutral-900 font-sans sm:text-4xl">
              Financial Statement Parser
            </h1>
            <p className="mt-1 text-sm text-neutral-500 max-w-lg font-sans">
              Convert raw PDF credit card statement billing documents into fully formatted, searchable, and structured parsed sheet reports.{" "}
              <a href="/extract" className="text-[#B58A3D] underline hover:text-[#9a7432]">
                Text-only extract (no AI)
              </a>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full md:w-auto">
            <div className="flex flex-col gap-1 min-w-[260px]">
              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Gemini API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    localStorage.setItem("gemini_api_key", e.target.value);
                  }}
                  placeholder="Gemini key — parses in browser (recommended on Vercel)"
                  className="w-full rounded-lg border border-neutral-200 bg-white pl-3 pr-9 py-2 text-xs shadow-sm focus:border-[#B58A3D] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-600"
                >
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {report && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={resetAll}
                className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-neutral-600 shadow-sm transition hover:bg-neutral-50 h-[34px] mt-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Statement
              </motion.button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        {!report ? (
          /* Landing Zone for File Uploads */
          <div className="mx-auto max-w-2xl">
            {loading ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-2xl border border-[#E9E4DF] bg-white p-10 shadow-sm flex flex-col items-center justify-center min-h-[360px]"
              >
                <div className="w-full max-w-md">
                  <h3 className="text-lg font-bold text-neutral-900 text-center mb-8">Processing Statement</h3>
                  <div className="space-y-6">
                    {LOADING_STEPS.map((step, idx) => {
                      const isCompleted = loadingStep > idx;
                      const isActive = loadingStep === idx;
                      return (
                        <div key={idx} className="flex gap-4 items-start">
                          <div className="relative flex items-center justify-center shrink-0 mt-0.5">
                            {isCompleted ? (
                              <div className="h-6 w-6 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                                <Check className="h-3.5 w-3.5 font-bold" />
                              </div>
                            ) : isActive ? (
                              <div className="h-6 w-6 rounded-full border-2 border-[#B58A3D] border-t-transparent animate-spin" />
                            ) : (
                              <div className="h-6 w-6 rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400 flex items-center justify-center text-xs font-semibold">
                                {idx + 1}
                              </div>
                            )}
                          </div>
                          <div>
                            <h4 className={`text-sm font-bold ${isActive ? "text-[#B58A3D]" : isCompleted ? "text-neutral-800" : "text-neutral-400"}`}>
                              {step.title}
                            </h4>
                            <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                              {step.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center shadow-sm"
                  style={{
                    borderColor: isDragOver ? "#B58A3D" : undefined,
                    backgroundColor: isDragOver ? "#FCFAF2" : undefined,
                    transition: "border-color 0.2s, background-color 0.2s"
                  }}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="flex justify-center">
                    <div className="rounded-2xl bg-[#FCFAF2] p-4 text-[#B58A3D] ring-8 ring-neutral-50">
                      <UploadCloud className="h-8 w-8" />
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-bold text-neutral-900">Upload credit card statement</h3>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-neutral-500">
                    Drag and drop your credit card billing `.pdf` file here, or click to browse. You will enter the password and parse on the next step.
                  </p>

                  <div className="mt-6 flex items-center justify-center gap-3">
                    <label className="relative cursor-pointer rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-semibold tracking-wide text-white shadow hover:bg-neutral-800 focus-within:outline-none">
                      Select Billing PDF
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf"
                        onChange={handleFileChange}
                        disabled={loading}
                      />
                    </label>
                  </div>

                  {fileName && (
                    <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-1.5 w-fit mx-auto text-xs font-medium text-neutral-600">
                      <FileText className="h-3.5 w-3.5 text-[#B58A3D]" />
                      <span>{fileName}</span>
                      <span className="text-neutral-400">({fileSize})</span>
                    </div>
                  )}
                </motion.div>

                {/* Error messaging block */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 flex gap-3 rounded-xl border border-red-100 bg-red-50 p-4"
                  >
                    <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
                    <div>
                      <h4 className="text-sm font-bold text-red-800">{error.message}</h4>
                      {error.detail && <p className="mt-1 text-xs text-red-700 leading-relaxed">{error.detail}</p>}
                      <button
                        onClick={() => setError(null)}
                        className="mt-2 text-xs font-bold text-red-800 underline hover:text-red-900"
                      >
                        Dismiss error
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Password + parse CTA (after PDF selected) */}
                <AnimatePresence>
                  {fileBase64 && !report && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-6 overflow-hidden rounded-2xl border border-[#E9E4DF] bg-[#FCFAF2] p-6 shadow-sm"
                    >
                      <form onSubmit={handlePasswordSubmit}>
                        <div className="flex gap-3">
                          <div className="rounded-lg bg-orange-100 p-2 text-orange-700 shrink-0 h-fit">
                            <Lock className="h-4.5 w-4.5" />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-sm font-bold text-neutral-900">
                              {passwordRequired ? "Incorrect password — try again" : "Enter PDF password"}
                            </h4>
                            <p className="mt-1 text-xs text-neutral-600 leading-relaxed">
                              {passwordRequired
                                ? "The password did not unlock this PDF. Check your statement password and click Parse statement again."
                                : "If your PDF is encrypted, enter the password below (leave blank if not). Then click Parse statement to extract and categorize transactions."}
                            </p>

                            <div className="mt-4 flex flex-col sm:flex-row gap-2 max-w-lg">
                              <div className="relative flex-1">
                                <input
                                  type={showPassword ? "text" : "password"}
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  placeholder="Statement PDF password (if required)"
                                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs placeholder-neutral-400 shadow-sm focus:border-[#B58A3D] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-600"
                                >
                                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                                </button>
                              </div>
                              <button
                                type="submit"
                                disabled={loading}
                                className="rounded-lg bg-neutral-900 px-5 py-2.5 text-xs font-semibold tracking-wide text-white shadow hover:bg-neutral-800 disabled:bg-neutral-400 shrink-0"
                              >
                                {loading ? "Processing…" : "Parse statement"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        ) : (
          /* Processed Dashboard Workstation */
          <div className="space-y-8">
            {/* Bento Box Stats Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Due Card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">Total Bill Due</span>
                  <div className="rounded-lg bg-red-50 p-1.5 text-red-600">
                    <ClockIcon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  {isEditingSummary ? (
                    <input
                      type="text"
                      value={summary?.totalPaymentDue || ""}
                      onChange={(e) => handleSummaryChange("totalPaymentDue", e.target.value)}
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-sm font-bold text-neutral-900 focus:outline-[#B58A3D]"
                      placeholder="Total due"
                    />
                  ) : (
                    <span className="text-2xl font-bold tracking-tight text-neutral-900">
                      {summary?.totalPaymentDue || "₹0.00"}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex flex-col gap-1.5 text-xs text-neutral-500">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-400 font-mono">Minimum:</span>
                    {isEditingSummary ? (
                      <input
                        type="text"
                        value={summary?.minimumPaymentDue || ""}
                        onChange={(e) => handleSummaryChange("minimumPaymentDue", e.target.value)}
                        className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] w-24 text-right focus:outline-[#B58A3D]"
                      />
                    ) : (
                      <span className="font-semibold text-neutral-800">{summary?.minimumPaymentDue || "₹0.00"}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-dashed border-neutral-100 pt-1.5">
                    <span className="font-medium text-neutral-400 font-mono">Bill Due Date:</span>
                    {isEditingSummary ? (
                      <input
                        type="text"
                        value={summary?.paymentDueDate || ""}
                        onChange={(e) => handleSummaryChange("paymentDueDate", e.target.value)}
                        className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] w-24 text-right text-red-600 font-semibold focus:outline-[#B58A3D]"
                      />
                    ) : (
                      <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded text-[11px]">
                        {summary?.paymentDueDate || "N/A"}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>

              {/* Total Spending */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase font-sans">Purchases & Debits</span>
                  <div className="rounded-lg bg-[#FCFAF2] p-1.5 text-[#B58A3D]">
                    <CreditCard className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  {isEditingSummary ? (
                    <input
                      type="text"
                      value={summary?.totalPurchases || ""}
                      onChange={(e) => handleSummaryChange("totalPurchases", e.target.value)}
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-sm font-bold text-neutral-900 focus:outline-[#B58A3D]"
                      placeholder="Total purchases"
                    />
                  ) : (
                    <span className="text-2xl font-bold tracking-tight text-neutral-900">
                      {summary?.totalPurchases || "₹0.00"}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-1 text-xs text-indigo-600 font-medium">
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                  <span>Outgoing billing amount</span>
                </div>
              </motion.div>

              {/* Total Payments */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">Payments & Credits</span>
                  <div className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  {isEditingSummary ? (
                    <input
                      type="text"
                      value={summary?.totalPayments || ""}
                      onChange={(e) => handleSummaryChange("totalPayments", e.target.value)}
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-sm font-bold text-neutral-900 focus:outline-[#B58A3D]"
                      placeholder="Total payments"
                    />
                  ) : (
                    <span className="text-2xl font-bold tracking-tight text-neutral-900">
                      {summary?.totalPayments || "₹0.00"}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />
                  <span>Clears balances / refunds</span>
                </div>
              </motion.div>

              {/* Top Category */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">Top category</span>
                  <div className="rounded-lg bg-neutral-50 p-1.5 text-neutral-500">
                    <Sparkles className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5">
                  {isEditingSummary ? (
                    <input
                      type="text"
                      value={summary?.topSpendingCategory || ""}
                      onChange={(e) => handleSummaryChange("topSpendingCategory", e.target.value)}
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-xs font-bold text-neutral-900 focus:outline-[#B58A3D]"
                      placeholder="Top Category"
                    />
                  ) : (
                    <span className="text-base font-bold tracking-tight text-neutral-900 line-clamp-1">
                      {summary?.topSpendingCategory || "N/A"}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 text-xs text-neutral-500">
                  <span>Incurred highest expenditure share</span>
                </div>
              </motion.div>
            </div>

            {/* Smart Summary Insight Banner */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="rounded-xl border border-[#E9E4DF] bg-[#FCFAF2] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3 flex-1">
                <div className="rounded-lg bg-[#F3ECE0] p-2 text-[#9E732D] shrink-0">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Statement Smart Insight</h4>
                  {isEditingSummary ? (
                    <textarea
                      rows={2}
                      value={summary?.keyInsight || ""}
                      onChange={(e) => handleSummaryChange("keyInsight", e.target.value)}
                      className="mt-1 w-full rounded border border-neutral-300 bg-white p-2 text-xs font-sans text-neutral-800 focus:outline-[#B58A3D] resize-none"
                      placeholder="Modify key intelligence findings or remarks..."
                    />
                  ) : (
                    <p className="mt-0.5 text-sm font-medium text-neutral-800 leading-relaxed">
                      {summary?.keyInsight || "Credit card analysis yielded no unusual active rewards points or anomalies during this statement cycle."}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end md:self-auto shrink-0 select-none">
                <button
                  onClick={() => setIsEditingSummary(!isEditingSummary)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition shadow-sm ${
                    isEditingSummary
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  {isEditingSummary ? "Done Editing" : "Edit Summary stats"}
                </button>
                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 transition shadow-sm"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  Export CSV Sheet
                </button>
              </div>
            </motion.div>

            {/* Workspace sections with split columns (Table workspace & Raw Copy columns) */}
            <div className="grid gap-8 lg:grid-cols-3">
              
              {/* Left Column (2 cols): Interactive Workspace Sheet */}
              <div className="space-y-6 lg:col-span-2">
                <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                  
                  {/* Table Header Controls */}
                  <div className="border-b border-neutral-100 bg-neutral-50/50 p-5 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-neutral-900">Extracted Statement Transactions</h2>
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-bold text-neutral-600 font-mono">
                          {filteredTransactions.length} of {transactions.length} lists
                        </span>
                      </div>
                      
                      <button
                        onClick={addEmptyRow}
                        className="flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-[11px] font-bold tracking-wide text-white hover:bg-neutral-800 shadow-sm transition"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Txn Row
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-4 select-none">
                      {/* Text Search input */}
                      <div className="relative sm:col-span-2">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search vendor or category..."
                          className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-xs focus:border-[#B58A3D] focus:outline-none placeholder-neutral-400"
                        />
                      </div>

                      {/* Filter by Category selection */}
                      <div className="relative">
                        <Filter className="absolute left-2.5 top-3 h-3 w-3 text-neutral-400" />
                        <select
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-7 pr-3 text-xs font-semibold text-neutral-600 focus:border-[#B58A3D] focus:outline-none appearance-none"
                        >
                          {uniqueCategories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat === "All" ? "All Categories" : cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Filter by Credit / Debit type */}
                      <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 bg-white py-2 px-3 text-xs font-semibold text-neutral-600 focus:border-[#B58A3D] focus:outline-none appearance-none"
                      >
                        <option value="All">All Types</option>
                        <option value="Debit">Debits (Purchases)</option>
                        <option value="Credit">Credits (Refunds/CR)</option>
                      </select>
                    </div>
                  </div>

                  {/* Transactions Data Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50/50 text-[10px] uppercase font-bold tracking-wider text-neutral-500">
                          <th className="px-5 py-3 font-semibold">Date</th>
                          <th className="px-5 py-3 font-semibold">Vendor</th>
                          <th className="px-5 py-3 font-semibold">Category</th>
                          <th className="px-5 py-3 font-semibold">Sub-Category</th>
                          <th className="px-5 py-3 font-semibold text-right">Amount</th>
                          <th className="px-5 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 font-sans">
                        {filteredTransactions.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-5 py-10 text-center text-neutral-400">
                              No statement transactions matched your active searches or filters.
                            </td>
                          </tr>
                        ) : (
                          filteredTransactions.map((txn, index) => {
                            // Find corresponding true index in original list
                            const originalIndex = transactions.findIndex((t) => t.id === txn.id);
                            const isCurrentlyEditing = editingRowIndex === originalIndex;

                            return (
                              <tr key={txn.id} className="hover:bg-neutral-50/50 transition">
                                {/* Date Cell */}
                                <td className="px-5 py-3 font-medium text-neutral-600 font-mono whitespace-nowrap">
                                  {isCurrentlyEditing && editedRowData ? (
                                    <input
                                      type="text"
                                      value={editedRowData.date}
                                      onChange={(e) =>
                                        setEditedRowData({ ...editedRowData, date: e.target.value })
                                      }
                                      className="rounded border border-neutral-300 px-2 py-1 text-xs w-20 focus:outline-[#B58A3D]"
                                    />
                                  ) : (
                                    txn.date
                                  )}
                                </td>

                                {/* Vendor Cell */}
                                <td className="px-5 py-3">
                                  {isCurrentlyEditing && editedRowData ? (
                                    <input
                                      type="text"
                                      value={editedRowData.vendor}
                                      onChange={(e) =>
                                        setEditedRowData({ ...editedRowData, vendor: e.target.value })
                                      }
                                      className="rounded border border-neutral-300 px-2 py-1 text-xs w-32 font-medium focus:outline-[#B58A3D]"
                                    />
                                  ) : (
                                    <div className="font-bold text-neutral-900">{txn.vendor}</div>
                                  )}
                                </td>

                                {/* Primary Category Cell */}
                                <td className="px-5 py-3 whitespace-nowrap">
                                  {isCurrentlyEditing && editedRowData ? (
                                    <input
                                      type="text"
                                      value={editedRowData.category}
                                      onChange={(e) =>
                                        setEditedRowData({ ...editedRowData, category: e.target.value })
                                      }
                                      className="rounded border border-neutral-300 px-2 py-1 text-xs w-28 focus:outline-[#B58A3D]"
                                    />
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                                      {txn.category || "Unspecified"}
                                    </span>
                                  )}
                                </td>

                                {/* Sub-Category Cell */}
                                <td className="px-5 py-3 whitespace-nowrap">
                                  {isCurrentlyEditing && editedRowData ? (
                                    <input
                                      type="text"
                                      value={editedRowData.subCategory}
                                      onChange={(e) =>
                                        setEditedRowData({ ...editedRowData, subCategory: e.target.value })
                                      }
                                      className="rounded border border-neutral-300 px-2 py-1 text-xs w-28 focus:outline-[#B58A3D]"
                                    />
                                  ) : (
                                    <span className="text-neutral-500 font-medium">
                                      {txn.subCategory || "N/A"}
                                    </span>
                                  )}
                                </td>

                                {/* Amount Cell */}
                                <td className="px-5 py-3 text-right font-semibold font-mono whitespace-nowrap">
                                  {isCurrentlyEditing && editedRowData ? (
                                    <div className="flex flex-col items-end gap-1">
                                      <input
                                        type="text"
                                        value={editedRowData.amount}
                                        onChange={(e) =>
                                          setEditedRowData({ ...editedRowData, amount: e.target.value })
                                        }
                                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-right w-24 focus:outline-[#B58A3D]"
                                      />
                                      <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={editedRowData.isCredit}
                                          onChange={(e) =>
                                            setEditedRowData({ ...editedRowData, isCredit: e.target.checked })
                                          }
                                          className="rounded text-[#B58A3D] focus:ring-0 scale-75 cursor-pointer"
                                        />
                                        <span className="text-[10px] text-neutral-500 font-sans">Is Refund/Credit</span>
                                      </label>
                                    </div>
                                  ) : (
                                    <span className={txn.isCredit ? "text-emerald-600" : "text-neutral-800"}>
                                      {formatAmount(txn.amount, txn.isCredit)}
                                    </span>
                                  )}
                                </td>

                                {/* Action Cell */}
                                <td className="px-5 py-3 text-center whitespace-nowrap">
                                  {isCurrentlyEditing ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        onClick={() => saveEditedRow(originalIndex)}
                                        className="rounded-md bg-neutral-900 border border-neutral-900 p-1 text-white hover:bg-neutral-800"
                                        title="Save edits"
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={cancelEditing}
                                        className="rounded-md border border-neutral-200 bg-white p-1 text-neutral-500 hover:bg-neutral-50"
                                        title="Cancel edits"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={() => startEditing(originalIndex, txn)}
                                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                        title="Edit cell transaction"
                                      >
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={() => deleteRow(originalIndex)}
                                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                                        title="Delete transaction line"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right Column (1 col): Statement Presentation & Copiers */}
              <div className="space-y-6">
                
                {/* 1. Verified Output View exactly of system instructions */}
                <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900">Final Markdown Report</h3>
                      <p className="text-[11px] text-neutral-400 font-medium">Auto-generated format for standard financial summaries.</p>
                    </div>
                    
                    <button
                      onClick={copyModifiedMarkdown}
                      className="flex items-center gap-1.5 rounded-lg bg-neutral-950 px-2.5 py-1.5 text-[11px] font-bold text-white tracking-wide hover:bg-neutral-800 shadow-sm transition shrink-0"
                    >
                      {copiedState ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedState ? "Copied" : "Copy Report"}
                    </button>
                  </div>

                  {/* Complete markdown area conforming strictly to the requested Transaction Table and Summary list */}
                  <div className="rounded-xl bg-neutral-50 p-4 border border-neutral-200 text-xs font-mono text-neutral-700 whitespace-pre scroll-smooth max-h-[420px] overflow-y-auto">
                    {currentModifiedMarkdown}
                  </div>
                </div>

                {/* 2. Original OCR RAW Output extracted from files */}
                {report?.rawReport && (
                  <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-neutral-950">Original Extraction Reference</h4>
                        <p className="text-[10px] text-neutral-400 font-medium">Immutable copy returned initially from PDF OCR checks.</p>
                      </div>

                      <button
                        onClick={copyRawMarkdown}
                        className="text-neutral-400 hover:text-neutral-800 transition"
                        title="Copy original raw compilation"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="rounded-xl bg-neutral-50/50 p-3.5 border border-neutral-100 max-h-[180px] overflow-y-auto">
                      <p className="text-[11px] leading-relaxed text-neutral-500 select-all font-mono whitespace-pre-wrap">
                        {report.rawReport}
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Light human icons mapped directly to replace custom Lucide packages
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
