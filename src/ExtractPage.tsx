import React, { useState } from "react";
import { FileText, Lock, UploadCloud, Copy, Check, AlertCircle } from "lucide-react";
import { extractPdfInBrowser } from "./lib/extractPdfInBrowser";

export default function ExtractPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ fileName: string; charCount: number } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const extractFromBase64 = async (base64: string, fileName: string, pwd?: string) => {
    setLoading(true);
    setError(null);
    setText(null);
    setMeta(null);

    const result = await extractPdfInBrowser(base64, pwd);
    setLoading(false);

    if (result.ok === false) {
      setError(result.message);
      return;
    }

    setText(result.text);
    setMeta({ fileName, charCount: result.text.length });
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      void extractFromBase64(base64, file.name, password.trim() || undefined);
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsDataURL(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const copyText = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
            <Lock className="h-4 w-4" />
            PDF password (if encrypted)
          </label>
          <div className="flex gap-2">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="e.g. pala0609"
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

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/30 p-10 text-center hover:border-indigo-500/50"
        >
          <UploadCloud className="mx-auto mb-3 h-10 w-10 text-slate-500" />
          <p className="mb-4 text-slate-400">
            Drop a PDF here or click to browse
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

        {loading && (
          <p className="text-center text-sm text-indigo-400">Extracting text…</p>
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
              <p className="text-sm text-slate-400">
                {meta.fileName} — {meta.charCount.toLocaleString()} characters
              </p>
              <div className="flex gap-2">
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
                  Copy
                </button>
                <button
                  type="button"
                  onClick={downloadText}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                >
                  Download .txt
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={text}
              className="h-[min(60vh,520px)] w-full resize-y rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300 outline-none"
            />
          </div>
        )}

        <p className="text-center text-xs text-slate-600">
          API: <code className="text-slate-500">POST /api/extract-text</code> with{" "}
          <code className="text-slate-500">{"{ file, password }"}</code> — CLI:{" "}
          <code className="text-slate-500">npm run extract-pdf -- --pdf path --password pwd</code>
        </p>
      </main>
    </div>
  );
}
