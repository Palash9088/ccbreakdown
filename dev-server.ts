import express from "express";
import path from "path";
import dotenv from "dotenv";
import { parseStatement } from "./lib/parseStatement.js";
import { parseStatementFromText } from "./lib/parseStatementText.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "25mb" }));

app.post("/api/parse-text", async (req, res) => {
  const result = await parseStatementFromText(req.body ?? {});
  if (result.ok === false) {
    return res.status(result.status).json(result.body);
  }
  return res.json(result.data);
});

app.post("/api/parse-statement", async (req, res) => {
  const result = await parseStatement(req.body ?? {});
  if (result.ok === false) {
    return res.status(result.status).json(result.body);
  }
  return res.json(result.data);
});

app.post("/api/extract-text", async (req, res) => {
  const { extractPdfText } = await import("./lib/extractPdfText.js");
  const result = await extractPdfText(req.body ?? {});
  if (result.ok === false) {
    return res.status(result.status).json(result.body);
  }
  return res.json({
    text: result.text,
    pageCount: result.pageCount,
    charCount: result.charCount,
  });
});

async function startServer() {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  const PORT = process.env.PORT || 3000;
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== "production") {
  void startServer();
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
  const PORT = process.env.PORT || 3000;
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}
