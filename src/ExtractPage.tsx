import React, { useState } from "react";
import {
  FileText,
  Lock,
  UploadCloud,
  Copy,
  Check,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { extractPdfInBrowser } from "./lib/extractPdfInBrowser";
import { statementTextToCsv } from "../lib/statementTextToCsv";

type PendingFile = {
  base64: string;
  fileName: string;
  fileSize: string;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function ExtractPage() {
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ fileName: string; charCount: number } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [viewMode, setViewMode] = useState<"raw" | "csv">("raw");

  const csvOutput = text ? statementTextToCsv(text) : null;
  const displayText =
    viewMode === "csv" && csvOutput ? csvOutput.csv : (text ?? "");

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (!reader.result) return;
      const base64 = (reader.result as string).split(",")[1];
      setPendingFile({
        base64,
        fileName: file.name,
        fileSize: formatBytes(file.size),
      });
      setPassword("");
      setError(null);
      setText(null);
      setMeta(null);
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsDataURL(file);
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFile) return;

    setLoading(true);
    setError(null);
    setText(null);
    setMeta(null);

    const result = await extractPdfInBrowser(
      pendingFile.base64,
      password.trim() || undefined
    );
    setLoading(false);

    if (result.ok === false) {
      setError(result.message);
      return;
    }

    setText(result.text);
    setMeta({ fileName: pendingFile.fileName, charCount: result.text.length });
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const copyText = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCsv = async () => {
    if (!text) return;
    const { csv } = statementTextToCsv(text);
    await navigator.clipboard.writeText(csv);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  const downloadText = () => {
    if (!text || !meta) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.fileName.replace(/\.pdf$/i, ".txt") || "extracted.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = () => {
    if (!text || !meta) return;
    const { csv } = statementTextToCsv(text);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.fileName.replace(/\.pdf$/i, ".csv") || "extracted.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFile = () => {
    setPendingFile(null);
    setPassword("");
    setError(null);
    setText(null);
    setMeta(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">PDF Text Extractor</h1>
            <p className="text-sm text-slate-400">
              No AI — pdf.js only. PDF stays in your browser.
            </p>
          </div>
          <a
            href="/"
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            ← Full statement parser
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {!pendingFile ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/30 p-10 text-center hover:border-indigo-500/50"
          >
            <UploadCloud className="mx-auto mb-3 h-10 w-10 text-slate-500" />
            <p className="mb-1 text-slate-300 font-medium">Step 1 — Select your PDF</p>
            <p className="mb-4 text-sm text-slate-500">
              Drop a file here or browse. You will enter the password next.
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
              <FileText className="h-4 w-4" />
              Select PDF
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={onFileChange}
                disabled={loading}
              />
            </label>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="rounded-lg bg-indigo-950 p-2 text-indigo-400 shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {pendingFile.fileName}
                  </p>
                  <p className="text-xs text-slate-500">{pendingFile.fileSize}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearFile}
                disabled={loading}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                Choose another file
              </button>
            </div>

            <form onSubmit={handleExtract} className="space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Lock className="h-4 w-4" />
                  Step 2 — PDF password
                </label>
                <p className="mb-2 text-xs text-slate-500">
                  Leave blank if the PDF is not encrypted.
                </p>
                <div className="flex gap-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter statement password"
                    autoComplete="off"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="rounded-lg border border-slate-700 px-3 text-sm text-slate-400 hover:bg-slate-800"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60"
              >
                {loading ? (
                  "Extracting text…"
                ) : (
                  <>
                    Extract text
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-red-300">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {text && meta && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-slate-400">
                  {meta.fileName} — {meta.charCount.toLocaleString()} characters
                  {csvOutput && csvOutput.rowCount > 0 && (
                    <span className="text-slate-500">
                      {" "}
                      · {csvOutput.rowCount} transaction rows in CSV
                    </span>
                  )}
                </p>
                <div className="mt-2 flex gap-1 rounded-lg border border-slate-800 p-0.5 w-fit">
                  <button
                    type="button"
                    onClick={() => setViewMode("raw")}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      viewMode === "raw"
                        ? "bg-slate-700 text-slate-100"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    Raw text
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("csv")}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      viewMode === "csv"
                        ? "bg-slate-700 text-slate-100"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    CSV preview
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyText}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy raw
                </button>
                <button
                  type="button"
                  onClick={copyCsv}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                >
                  {copiedCsv ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy CSV
                </button>
                <button
                  type="button"
                  onClick={downloadText}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                >
                  Download .csv
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={displayText}
              className="h-[min(60vh,520px)] w-full resize-y rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300 outline-none"
            />
          </div>
        )}

        <p className="text-center text-xs text-slate-600">
          API: <code className="text-slate-500">POST /api/extract-text</code> — CLI:{" "}
          <code className="text-slate-500">npm run extract-pdf</code>
        </p>
      </main>
    </div>
  );
}
