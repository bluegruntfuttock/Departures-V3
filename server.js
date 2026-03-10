import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

console.log("--- SERVER BOOTING ---");
console.log("Time:", new Date().toISOString());
console.log("Process ID:", process.pid);
console.log("Node Version:", process.version);
console.log("Platform:", process.platform);
console.log("Environment:", process.env.NODE_ENV);
console.log("Port Env:", process.env.PORT);

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION at:", promise, "reason:", reason);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

console.log(`Attempting to bind to port: ${PORT}`);

// Bind port IMMEDIATELY to satisfy aggressive startup probes (1s timeout)
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`>>> SERVER BOUND TO PORT ${PORT} <<<`);
  console.log("Startup Time:", new Date().toISOString());
}).on('error', (err) => {
  console.error("FAILED TO BIND PORT:", err);
  process.exit(1);
});

// RTT API Credentials
const USERNAME = 'rttapi_bluegruntfuttock@gmail.com';
const PASSWORD = '7c5b8634ff592fe4969a2ae5f4f00303b1c7cc04';

const getAuthHeader = () => {
  return 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
};

// Health check endpoint - very first thing
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV, 
    port: PORT,
    version: "3.12",
    uptime: process.uptime()
  });
});

// API routes
app.get("/api/rtt/departures/:crs", async (req, res) => {
  const { crs } = req.params;
  const targetUrl = `https://api.rtt.io/api/v1/json/search/${crs}`;
  
  console.log(`[RTT] Fetching departures for ${crs}...`);
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': getAuthHeader()
      }
    });

    console.log(`[RTT] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[RTT] Error response body: ${errorText}`);
      return res.status(response.status).json({ error: `RTT API error: ${response.statusText}` });
    }

    const data = await response.json();
    console.log(`[RTT] Successfully fetched ${data.services?.length || 0} services`);
    res.json(data);
  } catch (error) {
    console.error("[RTT] Departures Error Details:", {
      message: error.message,
      stack: error.stack,
      crs
    });
    res.status(500).json({ error: `Backend Error: ${error.message}` });
  }
});

app.get("/api/rtt/service/:serviceUid/:date", async (req, res) => {
  const { serviceUid, date } = req.params;
  const formattedDate = date.replace(/-/g, '/');
  const targetUrl = `https://api.rtt.io/api/v1/json/service/${serviceUid}/${formattedDate}`;

  console.log(`[RTT] Fetching service details for ${serviceUid} on ${formattedDate}...`);
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': getAuthHeader()
      }
    });

    console.log(`[RTT] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[RTT] Error response body: ${errorText}`);
      return res.status(response.status).json({ error: `RTT API error: ${response.statusText}` });
    }

    const data = await response.json();
    console.log(`[RTT] Successfully fetched service details`);
    res.json(data);
  } catch (error) {
    console.error("[RTT] Service Details Error Details:", {
      message: error.message,
      stack: error.stack,
      serviceUid,
      formattedDate
    });
    res.status(500).json({ error: `Backend Error: ${error.message}` });
  }
});

// Setup environment
const isDev = process.env.NODE_ENV === "development";
const distPath = path.join(__dirname, "dist");

// Static serving logic
function serveStatic() {
  console.log(`Configuring static serving from: ${distPath}`);
  
  // Serve static assets
  app.use(express.static(distPath, { index: false }));
  
  // Fallback for SPA
  app.get("*", (req, res) => {
    const indexPath = path.join(distPath, "index.html");
    
    try {
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, "utf8");
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
        if (apiKey) {
          console.log("GEMINI_API_KEY injected into HTML (length: " + apiKey.length + ")");
        } else {
          console.warn("GEMINI_API_KEY NOT FOUND in server environment!");
        }
        const injection = `<script>window.GEMINI_API_KEY = "${apiKey}";</script>`;
        html = html.replace("<head>", `<head>${injection}`);
        res.send(html);
      } else {
        console.warn(`index.html not found at ${indexPath}`);
        res.status(404).send("Application not built. Please run 'npm run build' first.");
      }
    } catch (err) {
      console.error("Error serving index.html:", err);
      res.status(500).send("Internal Server Error");
    }
  });
}

// Initialize server
async function init() {
  console.log(`Initializing routes (NODE_ENV: ${process.env.NODE_ENV || 'not set'})`);
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  console.log("GEMINI_API_KEY present in server environment:", !!apiKey);

  if (isDev) {
    try {
      console.log("Loading Vite middleware...");
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware active");
    } catch (e) {
      console.error("Failed to load Vite, falling back to static:", e.message);
      serveStatic();
    }
  } else {
    serveStatic();
  }

  // Final catch-all for errors
  app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });
  
  console.log(">>> ROUTES INITIALIZED <<<");
}

init().catch(err => {
  console.error("FATAL INITIALIZATION ERROR:", err);
  process.exit(1);
});
