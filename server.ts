import express from "express";
import path from "path";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  
  // Determine the root directory of the project dynamically to be resilient to different runtime contexts (like Cloud Run)
  const currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const PROJECT_ROOT = path.basename(currentDir) === "dist" ? path.dirname(currentDir) : currentDir;
  
  // Use absolute path for assets
  const ASSETS_DIR = path.join(PROJECT_ROOT, "public", "assets");
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Logging first - GLOBAL
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} (IP: ${req.ip})`);
    next();
  });

  // Enable CORS
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "*");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // --- MIDDLEWARE ---
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  // Cache busting for ALL API routes
  app.use("/api", (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Minimal per-IP/per-route rate limiter (fixed 1-minute window, no dependency)
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  const rateLimit = (maxPerMinute: number) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const now = Date.now();
      if (rateBuckets.size > 10000) {
        for (const [key, bucket] of rateBuckets) {
          if (bucket.resetAt < now) rateBuckets.delete(key);
        }
      }
      const routePrefix = req.path.split("/").slice(0, 3).join("/");
      const key = `${req.ip}|${req.method} ${routePrefix}`;
      const bucket = rateBuckets.get(key);
      if (!bucket || bucket.resetAt < now) {
        rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
        return next();
      }
      if (bucket.count >= maxPerMinute) {
        res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000).toString());
        return res.status(429).json({ error: "Trop de requêtes, réessayez dans une minute." });
      }
      bucket.count++;
      next();
    };
  };

  // --- API ROUTES ---
  
  app.get("/api/health", (req, res) => {
    console.log(`[HEALTH] Ping at ${new Date().toISOString()}`);
    res.send("STABLE");
  });

  // The proxy exists only to fetch Firebase Storage images with CORS headers
  // for canvas compositing — restrict it to those hosts to prevent SSRF abuse
  // (fetching internal endpoints like the GCP metadata server through it).
  const PROXY_ALLOWED_HOSTS = new Set([
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
  ]);

  app.get("/api/proxy", rateLimit(60), async (req, res) => {
    try {
      const url = req.query.url;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "No URL provided" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return res.status(400).json({ error: "Invalid URL" });
      }
      if (parsedUrl.protocol !== "https:" || !PROXY_ALLOWED_HOSTS.has(parsedUrl.hostname)) {
        return res.status(403).json({ error: "Proxy restricted to Firebase/Google Cloud Storage URLs" });
      }

      console.log(`[Proxy] Fetching CORS-restricted resource: ${url}`);
      const response = await fetch(parsedUrl);
      if (!response.ok) {
        return res.status(response.status).json({ error: `Failed to fetch: ${response.statusText}` });
      }

      const contentType = response.headers.get("content-type") || "image/png";
      if (contentType && !contentType.startsWith("image/")) {
        console.warn(`[Proxy] Blocked non-image content-type: ${contentType}`);
        return res.status(415).json({ error: `Expected image content-type, but received: ${contentType}` });
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24h
      return res.send(buffer);
    } catch (error: any) {
      console.error("[Proxy] Critical proxy failure:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/upload-export-file", rateLimit(30), (req, res) => {
    try {
      const { jobId, type, dataUrl } = req.body;
      if (!jobId || !type || !dataUrl) {
        return res.status(400).json({ error: "Missing required fields (jobId, type, dataUrl)" });
      }

      // jobId is used to build a filename on disk: reject anything that could
      // escape the upload directory (e.g. "../../")
      if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) {
        return res.status(400).json({ error: "Invalid jobId format" });
      }

      const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: "Invalid data URL format" });
      }

      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, "base64");

      let subfolder = "";
      let filename = "";

      if (type === "vehicle") {
        subfolder = "vehicles";
        filename = `${jobId}_vehicle.png`;
      } else if (type === "reference") {
        subfolder = "references";
        filename = `${jobId}_ref.jpg`;
      } else if (type === "logo") {
        subfolder = "logos";
        filename = `${jobId}_logo.png`;
      } else {
        return res.status(400).json({ error: "Invalid upload type" });
      }

      const uploadDir = path.join(PROJECT_ROOT, "public", "exports", subfolder);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, filename);
      fs.writeFileSync(filePath, buffer);

      console.log(`[Upload API] Successfully wrote ${type} file: /exports/${subfolder}/${filename} (${buffer.length} bytes)`);
      
      return res.json({ 
        url: `/exports/${subfolder}/${filename}`,
        size: buffer.length 
      });
    } catch (error: any) {
      console.error("[Upload API] Critical error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/remove-background", rateLimit(10), async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "No image provided" });
      }

      // The API key must come from the environment (Secrets panel) — never
      // hardcode a key in a public repository, even a sandbox one.
      const apiKey = process.env.PHOTOROOM_API_KEY || process.env.CLIPDROP_API_KEY;

      if (!apiKey || apiKey.trim() === "" || apiKey === "MY_CLIPDROP_API_KEY" || apiKey === "MY_PHOTOROOM_API_KEY") {
        console.error("[Photoroom] No API key configured (PHOTOROOM_API_KEY).");
        return res.status(503).json({
          error: "Clé API Photoroom non configurée. Ajoutez PHOTOROOM_API_KEY dans le panneau Secrets (AI Studio) ou l'environnement du serveur."
        });
      }
      console.log("[Photoroom] Using configured API Key from environment.");
      const usingSandbox = apiKey.startsWith("sandbox_");

      // Convert base64 to Buffer
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // Construct standard multipart form body manually
      // Photoroom expects the image file in "image_file"
      const boundary = "----WebKitFormBoundaryPhotoroomUpload" + Date.now();
      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image_file"; filename="image.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payload = Buffer.concat([header, buffer, footer]);

      console.log(`[Photoroom] Sending manual multipart request to https://sdk.photoroom.com/v1/segment ... payload size: ${payload.length} bytes`);

      const response = await fetch("https://sdk.photoroom.com/v1/segment", {
        method: "POST",
        headers: {
          "x-api-key": apiKey.trim(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: payload,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Photoroom] Error response (status ${response.status}):`, errorText);
        
        // Handle common errors gracefully
        if (response.status === 401 || response.status === 403) {
          return res.status(response.status).json({ 
            error: usingSandbox 
              ? "Sandbox Photoroom API key error. Please double-check the sandbox key validity."
              : "Invalid Photoroom API Key. Please review the PHOTOROOM_API_KEY configured in your Secrets panel under Google AI Studio." 
          });
        }
        
        let errMsg = `Photoroom API returned status ${response.status}`;
        try {
          const errJSON = JSON.parse(errorText);
          if (errJSON.error) errMsg = errJSON.error;
          else if (errJSON.message) errMsg = errJSON.message;
        } catch (_) {}
        return res.status(response.status).json({ error: errMsg });
      }

      // Get binary response and convert to base64
      const arrayBuffer = await response.arrayBuffer();
      const outputBuffer = Buffer.from(arrayBuffer);
      const base64Output = outputBuffer.toString("base64");
      const dataUrl = `data:image/png;base64,${base64Output}`;

      console.log(`[Photoroom] Successfully isolated vehicle. Output size: ${outputBuffer.length} bytes`);
      return res.json({ image: dataUrl });
    } catch (error: any) {
      console.error("[Photoroom] Unexpected failure during background removal:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Simple in-memory database for jobs fallback
  const fallbackJobs = new Map<string, any>();

  // Prevent unbounded memory growth: evict the oldest jobs beyond the cap
  const pruneFallbackJobs = () => {
    const MAX_FALLBACK_JOBS = 200;
    while (fallbackJobs.size > MAX_FALLBACK_JOBS) {
      const oldestKey = fallbackJobs.keys().next().value;
      if (oldestKey === undefined) break;
      fallbackJobs.delete(oldestKey);
    }
  };

  app.post("/api/jobs", rateLimit(60), (req, res) => {
    try {
      const { jobId, jobData } = req.body;
      if (!jobId || !jobData) {
        return res.status(400).json({ error: "Missing jobId or jobData" });
      }
      fallbackJobs.set(jobId, {
        ...jobData,
        updatedAt: new Date().toISOString()
      });
      pruneFallbackJobs();
      console.log(`[Fallback DB] Saved job ${jobId}`);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/jobs/:jobId", rateLimit(120), (req, res) => {
    const { jobId } = req.params;
    const job = fallbackJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.json(job);
  });

  app.put("/api/jobs/:jobId", rateLimit(60), (req, res) => {
    try {
      const { jobId } = req.params;
      const updateData = req.body;
      const existing = fallbackJobs.get(jobId);
      if (!existing) {
        // Create new if doesn't exist
        fallbackJobs.set(jobId, {
          ...updateData,
          updatedAt: new Date().toISOString()
        });
        pruneFallbackJobs();
        return res.json({ success: true });
      }
      const updated = {
        ...existing,
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      fallbackJobs.set(jobId, updated);
      console.log(`[Fallback DB] Updated job ${jobId}`);
      return res.json({ success: true, job: updated });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Serve public folder as root static first
  app.use(express.static(path.join(PROJECT_ROOT, "public")));

  // Serve static assets with explicit route and robust path resolution
  app.use("/assets", (req, res, next) => {
    // If request has a slash at start, req.url in middleware is the rest
    // e.g. /assets/foo.png -> req.url is /foo.png
    const relativePath = req.url.startsWith('/') ? req.url : `/${req.url}`;
    const filePath = path.join(ASSETS_DIR, relativePath);
    
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
      console.log(`[ASSET SUCCESS] Serving: ${relativePath} -> ${filePath}`);
    } else {
      console.error(`[ASSET FAILURE] Not found: ${relativePath} -> Tried: ${filePath}`);
    }
    next();
  }, express.static(ASSETS_DIR));

  // --- Vite / Static ---
  
  let viteInstance: any = null;

  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Initializing Vite middleware...");
    try {
      // Imported lazily so the production bundle never loads Vite
      const { createServer: createViteServer } = await import("vite");
      viteInstance = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(viteInstance.middlewares);
      console.log("[Server] Vite middleware added.");
    } catch (e) {
      console.error("[Server] Failed to initialize Vite:", e);
    }
  } else {
    const distPath = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(distPath));
  }

  // Robust HTML Fallback handler for all frontend/SPA routes
  app.get("*", async (req, res, next) => {
    // If request has a file extension, don't serve index.html (it is a missing asset or static file)
    if (req.path.includes('.') && !req.path.endsWith('.html')) {
      return next();
    }

    try {
      if (viteInstance) {
        // Dev Mode: Read index.html, run Vite transformation, and send
        const templatePath = path.resolve(PROJECT_ROOT, "index.html");
        let html = fs.readFileSync(templatePath, "utf-8");
        html = await viteInstance.transformIndexHtml(req.originalUrl, html);
        return res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } else {
        // Prod Mode: Send simple compiled index.html
        const distIndexHTML = path.join(PROJECT_ROOT, "dist", "index.html");
        if (fs.existsSync(distIndexHTML)) {
          return res.sendFile(distIndexHTML);
        } else {
          // Absolute fallback if dist folder wasn't populated or was cleared
          const rootIndexHTML = path.join(PROJECT_ROOT, "index.html");
          return res.sendFile(rootIndexHTML);
        }
      }
    } catch (error) {
      console.error("[Server] Error serving index.html fallback:", error);
      next(error);
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n>>> SERVER READY AT http://0.0.0.0:${PORT}\n`);
  });
}

startServer().catch(err => {
  console.error("Critical server failure:", err);
  process.exit(1);
});
