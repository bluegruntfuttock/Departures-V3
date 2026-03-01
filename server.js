import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// RTT API Credentials
const USERNAME = 'rttapi_bluegruntfuttock@gmail.com';
const PASSWORD = '7c5b8634ff592fe4969a2ae5f4f00303b1c7cc04';

const getAuthHeader = () => {
  return 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
};

// Health check endpoint - very first thing
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, port: PORT });
});

// API routes
app.get("/api/rtt/departures/:crs", async (req, res) => {
  const { crs } = req.params;
  const targetUrl = `https://api.rtt.io/api/v1/json/search/${crs}`;
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': getAuthHeader()
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `RTT API error: ${response.statusText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("RTT Departures Error:", error);
    res.status(500).json({ error: "Failed to fetch departures from RTT" });
  }
});

app.get("/api/rtt/service/:serviceUid/:date", async (req, res) => {
  const { serviceUid, date } = req.params;
  const formattedDate = date.replace(/-/g, '/');
  const targetUrl = `https://api.rtt.io/api/v1/json/service/${serviceUid}/${formattedDate}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': getAuthHeader()
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `RTT API error: ${response.statusText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("RTT Service Details Error:", error);
    res.status(500).json({ error: "Failed to fetch service details from RTT" });
  }
});

// Vite middleware for development
async function setupVite() {
  const isProd = process.env.NODE_ENV === "production";
  console.log(`Starting server in ${isProd ? 'production' : 'development'} mode...`);
  console.log(`Target Port: ${PORT}`);

  if (!isProd) {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware loaded");
    } catch (e) {
      console.warn("Vite not found or failed to load, falling back to static serving");
      serveStatic();
    }
  } else {
    serveStatic();
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} (NODE_ENV: ${process.env.NODE_ENV})`);
  });
}

function serveStatic() {
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

setupVite();
