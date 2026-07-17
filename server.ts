import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import { execSync } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { db } from "./server/db.js";
import {
  getEC2CPUUtilization,
  getEC2MemoryUtilization,
} from "./server/cloudwatch.js";
import { getEC2Status } from "./server/ec2";

const app = express();
const PORT = 3000;

// Body parsing middleware
app.use(express.json());

// Initialize Gemini API client gracefully (lazy / optional)
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// Background Interval for Telemetry & DR Simulation Progress
// Generate health logs every 5 seconds
setInterval(() => {
  try {
    db.tickHealthLogs();
  } catch (err) {
    console.error("Error ticking health logs", err);
  }
}, 5000);

// Process disaster recovery steps every 6 seconds if simulation is active
setInterval(async () => {
  try {
    const sim = db.getSimulationState();
    if (sim.active) {
      const result = await db.progressSimulation();
      if (result.logs && result.logs.length > 0) {
        console.log("ADR Progress logs:", result.logs);
      }
    }
  } catch (err) {
    console.error("Error progressing simulation steps", err);
  }
}, 6000);

// --- API ENDPOINTS ---

// TEST CLOUDWATCH CPU METRIC
app.get("/api/aws/cpu", async (req, res) => {
  try {
    const cpu = await getEC2CPUUtilization(
      "i-0ce94b29d921ddb19",
      "ap-south-1"
    );

    res.json({
      instance: "Mumbai",
      cpuUtilization: cpu,
    });
  } catch (error: any) {
    console.error(error);

    res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/api/aws/ec2-status", async (req, res) => {
  try {
    const mumbaiStatus = await getEC2Status(
      "i-0ce94b29d921ddb19",
      "ap-south-1"
    );

    const singaporeStatus = await getEC2Status(
      "i-057f9ddd076de9a79",
      "ap-southeast-1"
    );

    res.json({
      mumbai: {
        instanceId: "i-0ce94b29d921ddb19",
        state: mumbaiStatus,
      },
      singapore: {
        instanceId: "i-057f9ddd076de9a79",
        state: singaporeStatus,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/aws/metrics", async (req, res) => {
  try {
    const mumbaiCPU = await getEC2CPUUtilization(
      "i-0ce94b29d921ddb19",
      "ap-south-1"
    );

    const singaporeCPU = await getEC2CPUUtilization(
      "i-057f9ddd076de9a79",
      "ap-southeast-1"
    );

const mumbaiMemory = await getEC2MemoryUtilization(
  "i-0ce94b29d921ddb19",
  "ap-south-1"
);

const singaporeMemory = await getEC2MemoryUtilization(
  "i-057f9ddd076de9a79",
  "ap-southeast-1"
);

    res.json({
  mumbai: {
    cpu: Number(mumbaiCPU.toFixed(2)),
    memory: Number(mumbaiMemory.toFixed(2)),
  },
  singapore: {
    cpu: Number(singaporeCPU.toFixed(2)),
    memory: Number(singaporeMemory.toFixed(2)),
  },
});
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Unable to fetch CloudWatch metrics",
    });
  }
});

// 0. DATABASE STATUS
app.get("/api/db-status", (req, res) => {
  try {
    res.json(db.getDbStatus());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 1. REGIONS
app.get("/api/regions", (req, res) => {
  try {
    res.json(db.getRegions());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/regions/failover", (req, res) => {
  try {
    const { fromRegionId, toRegionId } = req.body;
    if (!fromRegionId || !toRegionId) {
      return res.status(400).json({ error: "fromRegionId and toRegionId are required." });
    }
    const result = db.manualFailover(Number(fromRegionId), Number(toRegionId));
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. HEALTH / TELEMETRY
app.get("/api/health", (req, res) => {
  try {
    const logs = db.getHealthLogs();
    const regions = db.getRegions();
    
    // Get latest metrics for each region
    const currentMetrics = regions.map(region => {
      const regionLogs = logs.filter(l => l.region_id === region.id);
      const latest = regionLogs[regionLogs.length - 1] || { 
        id: 0, 
        region_id: region.id, 
        cpu_usage: 0, 
        memory_usage: 0, 
        timestamp: new Date().toISOString() 
      };
      return {
        region_id: region.id,
        name: region.name,
        status: region.status,
        cpu: latest.cpu_usage,
        memory: latest.memory_usage,
        timestamp: latest.timestamp
      };
    });

    res.json({
      current: currentMetrics,
      history: logs.slice(-50), // Send last 50 data points for historical charts
      lastRefresh: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. INCIDENTS
app.get("/api/incidents", (req, res) => {
  try {
    // Return latest incidents first
    const incidents = [...db.getIncidents()].sort((a, b) => b.id - a.id);
    res.json(incidents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. DISASTER SIMULATION CONTROL
app.get("/api/simulation", async (req, res) => {
  try {
    const simulation = db.getSimulationState();

    // Automatically advance the disaster recovery workflow
    if (simulation.active) {
      await db.progressSimulation();
    }

    res.json(db.getSimulationState());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/simulation/trigger", (req, res) => {
  try {
    const { type } = req.body; // 'EC2' | 'Database' | 'High_CPU' | 'Network'
    if (!type || !['EC2', 'Database', 'High_CPU', 'Network'].includes(type)) {
      return res.status(400).json({ error: "Invalid simulation type requested." });
    }
    const result = db.triggerSimulation(type as any);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/simulation/reset", (req, res) => {
  try {
    db.resetSimulation();
    res.json({ success: true, message: "Resilience state sanitized and simulation parameters reset." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. ALERTS / NOTIFICATIONS
app.get("/api/alerts", (req, res) => {
  try {
    // Latest first
    const alerts = [...db.getAlerts()].sort((a, b) => b.id - a.id);
    res.json(alerts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. USER MANAGEMENT (CRUD)
app.get("/api/users", (req, res) => {
  try {
    res.json(db.getUsers());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/users", (req, res) => {
  try {
    const { name, email, role } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: "All user fields (name, email, role) are required." });
    }
    const newUser = db.addUser({ name, email, role });
    res.status(201).json(newUser);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/users/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = db.updateUser(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/users/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const success = db.deleteUser(id);
    if (!success) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ success: true, message: "User credentials deprovisioned successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. GEMINI AI ANALYSIS & PLAYBOOK GENERATION
app.post("/api/gemini/analyze", async (req, res) => {
  try {
    const { incidentId } = req.body;
    if (!incidentId) {
      return res.status(400).json({ error: "Incident ID is required for generating a resilience playbook." });
    }

    const incident = db.getIncidentById(Number(incidentId));
    if (!incident) {
      return res.status(404).json({ error: "Incident not found in active health index." });
    }

    const region = db.getRegionById(incident.region_id);
    const regionName = region ? region.name : "Unknown Region";

    const ai = getGeminiClient();

    if (!ai) {
      // Fallback response if GEMINI_API_KEY is not configured
      const fallbackPlaybook = `### SentinelDR Automated Playbook (Local Offline Engine)
**Incident Profile:** ${incident.cause}
**Target Region:** ${regionName}
**Status:** ${incident.status}

#### 1. Emergency Diagnostics
- Spikes detected on primary hypervisor status indices.
- Replication heartbeat failed to respond within SLA limit (10 seconds).

#### 2. Automated Action Items Executed
- Shunted incoming DNS entries via Route53 DNS Failover Routing policy.
- Triggered API-level de-registration of problematic nodes.
- Promoted standby database cluster to read-write operational master.

#### 3. Post-Recovery Recommendations
- Audit network route tables for package drop spikes.
- Increase auto-scaling warmth parameters to handle transition traffic.

*Note: Configure a Gemini API Key in Settings > Secrets to unlock AI-Powered Deep Resilience Analysis.*`;
      return res.json({ playbook: fallbackPlaybook, isFallback: true });
    }

    const prompt = `You are the SentinelDR AI Reliability Specialist. Create a professional, highly-structured Disaster Recovery Playbook and Incident Root-Cause Analysis for this active/resolved infrastructure event:

Incident Details:
- Cause of Disaster: ${incident.cause}
- Impacted Region: ${regionName}
- Status of Mitigation: ${incident.status}
- Resolution RTO (Recovery Time): ${incident.recovery_time ? incident.recovery_time + ' seconds' : 'In-Progress Failover Orchestration'}

Please format your response in professional Markdown. It must include:
1. **Threat Profile & Impact Assessment**: A short summary of why this happens (e.g. AWS hypervisor failure, corruption of WAL logs, BGP misconfiguration) and the direct business impact.
2. **Orchestrated Playbook Actions**: 3-4 specific sequential commands or automation steps SentinelDR executed to isolate the event and route traffic. Use standard AWS CLI / Kubernetes commands or technical steps.
3. **Resilience Engineering Enhancements**: Recommendations to prevent future events of this type in ${regionName}.

Keep your tone objective, professional, and clear. Avoid generic placeholder text. Do not write introductory conversational remarks, output only the Markdown content directly.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    res.json({ playbook: response.text || "Failed to generate AI recommendations.", isFallback: false });
  } catch (error: any) {
    console.error("Gemini AI API Error:", error);
    res.status(500).json({ error: "Failed to communicate with the server-side AI model.", details: error.message });
  }
});


// --- VITE DEVELOPMENT MIDDLEWARE OR STATIC PRODUCTION SERVING ---

function killPort(port: number): boolean {
  try {
    if (process.platform === "win32") {
      const stdout = execSync(`netstat -ano | findstr :${port}`).toString();
      const lines = stdout.split("\n");
      const pids = new Set<string>();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[4];
          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            pids.add(pid);
          }
        }
      }
      if (pids.size > 0) {
        console.log(`[Port Recovery] Found process(es) on port ${port}: ${Array.from(pids).join(", ")}. Terminating...`);
        for (const pid of pids) {
          try {
            execSync(`taskkill /F /PID ${pid}`);
          } catch (e) {
            // Ignore if taskkill fails for a specific PID
          }
        }
        // Give OS a moment to release the port
        try {
          execSync("choice /T 1 /D Y /N >nul 2>&1 || ping 127.0.0.1 -n 2 >nul");
        } catch (e) {
          // ignore delay helpers if choice/ping is unavailable
        }
        return true;
      }
    } else {
      try {
        execSync(`lsof -t -i:${port} | xargs kill -9`);
        console.log(`[Port Recovery] Successfully terminated processes on port ${port}.`);
        return true;
      } catch (e) {
        try {
          execSync(`fuser -k ${port}/tcp`);
          console.log(`[Port Recovery] Successfully terminated TCP processes on port ${port} using fuser.`);
          return true;
        } catch (err2) {
          // ignore
        }
      }
    }
  } catch (error) {
    console.error(`[Port Recovery] Failed to kill process on port ${port}:`, error);
  }
  return false;
}

function listenOnAvailablePort(app: any, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    let attemptKill = true;

    function tryListen() {
      const server = http.createServer(app);

      server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[Port Check] Port ${currentPort} is currently occupied.`);
          if (attemptKill) {
            console.log(`[Port Check] Attempting to free port ${currentPort} by terminating existing process...`);
            killPort(currentPort);
            attemptKill = false;
            // Retry on the same port after a short delay to let OS clean up
            setTimeout(tryListen, 500);
          } else {
            // If killing failed or we already tried, increment port
            const nextPort = currentPort + 1;
            console.log(`[Port Check] Dynamic fallback: Retrying on incremented port ${nextPort}...`);
            currentPort = nextPort;
            attemptKill = true; // reset kill attempt for the new port
            tryListen();
          }
        } else {
          reject(err);
        }
      });

      server.listen(currentPort, "0.0.0.0", () => {
        console.log(`SentinelDR Server listening on http://0.0.0.0:${currentPort}`);
        resolve(currentPort);
      });
    }

    tryListen();
  });
}

async function startServer() {
  const isBundled = typeof __filename !== "undefined" && __filename.includes("server.cjs");
  const isProduction = process.env.NODE_ENV === "production" || isBundled || !fs.existsSync(path.join(process.cwd(), "server.ts"));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  try {
    await listenOnAvailablePort(app, PORT);
  } catch (err) {
    console.error("Critical error starting server:", err);
    process.exit(1);
  }
}

startServer();
