import "dotenv/config";
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

// Database Path
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'sentinel_dr.json');

// Interface Declarations matching MySQL schema
export interface Region {
  id: number;
  name: string;
  status: 'Active' | 'Standby' | 'Degraded' | 'Critical';
  last_failover: string | null;
}

export interface HealthLog {
  id: number;
  region_id: number;
  cpu_usage: number;
  memory_usage: number;
  timestamp: string;
}

export interface Incident {
  id: number;
  region_id: number;
  cause: string;
  recovery_time: number | null; // in seconds, null if unresolved
  status: 'Investigating' | 'Mitigating' | 'Resolved';
  created_at: string;
}

export interface Alert {
  id: number;
  incident_id: number | null;
  type: 'Critical' | 'Warning' | 'Info';
  message: string;
  sent_at: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'Administrator' | 'Operator' | 'Read-Only';
  created_at: string;
}

export interface DatabaseState {
  regions: Region[];
  health_logs: HealthLog[];
  incidents: Incident[];
  alerts: Alert[];
  users: User[];
  simulation: {
    active: boolean;
    type: string | null;
    target_region_id: number | null;
    started_at: string | null;
    step: number; // 0: healthy, 1: incident_triggered, 2: failover_initiated, 3: failover_completed (resolved)
  };
}

// Initial Seed State
const INITIAL_STATE: DatabaseState = {
  regions: [
    { id: 1, name: 'Mumbai (ap-south-1)', status: 'Active', last_failover: null },
    { id: 2, name: 'Singapore (ap-southeast-1)', status: 'Standby', last_failover: null }
  ],
  health_logs: [],
  incidents: [
    { id: 1, region_id: 1, cause: 'EC2 Auto Scaling Spike - Peak Traffic', recovery_time: 180, status: 'Resolved', created_at: new Date(Date.now() - 48 * 3600000).toISOString() },
    { id: 2, region_id: 2, cause: 'Primary Database Replication Timeout', recovery_time: 45, status: 'Resolved', created_at: new Date(Date.now() - 24 * 3600000).toISOString() }
  ],
  alerts: [
    { id: 1, incident_id: 1, type: 'Critical', message: 'Region ap-south-1 reported EC2 termination spikes. Auto-scaling triggered backup instances.', sent_at: new Date(Date.now() - 48 * 3600000).toISOString() },
    { id: 2, incident_id: 2, type: 'Warning', message: 'Region ap-southeast-1 DB replication lagging by >10s. Forcing replication rebuild.', sent_at: new Date(Date.now() - 24 * 3600000).toISOString() }
  ],
  users: [
    { id: 1, name: 'Vedant Gajankar', email: 'vedantgajankar@gmail.com', role: 'Administrator', created_at: new Date(Date.now() - 100 * 24 * 3600000).toISOString() },
    { id: 2, name: 'Operations Lead', email: 'ops-lead@sentineldr.io', role: 'Operator', created_at: new Date(Date.now() - 50 * 24 * 3600000).toISOString() },
    { id: 3, name: 'Security Auditor', email: 'auditor@sentineldr.io', role: 'Read-Only', created_at: new Date(Date.now() - 10 * 24 * 3600000).toISOString() }
  ],
  simulation: {
    active: false,
    type: null,
    target_region_id: null,
    started_at: null,
    step: 0
  }
};

let mysqlPool: mysql.Pool | null = null;
let isMysqlEnabled = false;

async function initMysql() {
  if (!process.env.MYSQL_HOST) {
    console.log("[Database] No MYSQL_HOST configured. Running in JSON-only fallback mode.");
    return;
  }
  
  try {
    const config = {
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'sentinel_dr_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };

    console.log(`[Database] Attempting to connect to MySQL at ${config.host}:${config.port}...`);
    
    // First, let's connect without a database specified to make sure the database exists
    const tempConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    });
    
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
    await tempConnection.end();

    // Now connect to the actual database
    mysqlPool = mysql.createPool(config);
    isMysqlEnabled = true;
    console.log("[Database] Successfully connected to MySQL pool!");

    // Initialize tables
    await createTablesAndSeed();
  } catch (err) {
    console.error("[Database] Failed to initialize MySQL. Falling back to local JSON mode.", err);
    mysqlPool = null;
    isMysqlEnabled = false;
  }
}

async function createTablesAndSeed() {
  if (!mysqlPool) return;
  
  // 1. Regions table
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS regions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      status VARCHAR(50) NOT NULL DEFAULT 'Active',
      last_failover DATETIME DEFAULT NULL
    )
  `);

  // 2. Users table
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      role VARCHAR(50) NOT NULL DEFAULT 'Operator',
      created_at VARCHAR(100) NOT NULL
    )
  `);

  // 3. Incidents table
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      region_id INT NOT NULL,
      cause VARCHAR(255) NOT NULL,
      recovery_time INT DEFAULT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Investigating',
      created_at VARCHAR(100) NOT NULL,
      FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
    )
  `);

  // 4. Health Logs table
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS health_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      region_id INT NOT NULL,
      cpu_usage FLOAT NOT NULL,
      memory_usage FLOAT NOT NULL,
      timestamp VARCHAR(100) NOT NULL,
      FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
    )
  `);

  // 5. Alerts table
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      incident_id INT DEFAULT NULL,
      type VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      sent_at VARCHAR(100) NOT NULL,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL
    )
  `);

  // 6. Simulation state table
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS simulation_state (
      id INT PRIMARY KEY,
      active TINYINT NOT NULL DEFAULT 0,
      type VARCHAR(50) DEFAULT NULL,
      target_region_id INT DEFAULT NULL,
      started_at VARCHAR(100) DEFAULT NULL,
      step INT NOT NULL DEFAULT 0
    )
  `);

  // Now seed initial values if empty
  const [regionsCount] = await mysqlPool.query<any[]>('SELECT COUNT(*) as count FROM regions');
  if (regionsCount[0].count === 0) {
    console.log("[Database] Seeding regions table...");
    await mysqlPool.query('INSERT INTO regions (id, name, status, last_failover) VALUES (?, ?, ?, ?)', [1, 'Mumbai (ap-south-1)', 'Active', null]);
    await mysqlPool.query('INSERT INTO regions (id, name, status, last_failover) VALUES (?, ?, ?, ?)', [2, 'Singapore (ap-southeast-1)', 'Standby', null]);
  }

  const [usersCount] = await mysqlPool.query<any[]>('SELECT COUNT(*) as count FROM users');
  if (usersCount[0].count === 0) {
    console.log("[Database] Seeding users table...");
    await mysqlPool.query('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)', [1, 'Vedant Gajankar', 'vedantgajankar@gmail.com', 'Administrator', new Date(Date.now() - 100 * 24 * 3600000).toISOString()]);
    await mysqlPool.query('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)', [2, 'Operations Lead', 'ops-lead@sentineldr.io', 'Operator', new Date(Date.now() - 50 * 24 * 3600000).toISOString()]);
    await mysqlPool.query('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)', [3, 'Security Auditor', 'auditor@sentineldr.io', 'Read-Only', new Date(Date.now() - 10 * 24 * 3600000).toISOString()]);
  }

  const [incidentsCount] = await mysqlPool.query<any[]>('SELECT COUNT(*) as count FROM incidents');
  if (incidentsCount[0].count === 0) {
    console.log("[Database] Seeding incidents table...");
    await mysqlPool.query('INSERT INTO incidents (id, region_id, cause, recovery_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [1, 1, 'EC2 Auto Scaling Spike - Peak Traffic', 180, 'Resolved', new Date(Date.now() - 48 * 3600000).toISOString()]);
    await mysqlPool.query('INSERT INTO incidents (id, region_id, cause, recovery_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [2, 2, 'Primary Database Replication Timeout', 45, 'Resolved', new Date(Date.now() - 24 * 3600000).toISOString()]);
  }

  const [alertsCount] = await mysqlPool.query<any[]>('SELECT COUNT(*) as count FROM alerts');
  if (alertsCount[0].count === 0) {
    console.log("[Database] Seeding alerts table...");
    await mysqlPool.query('INSERT INTO alerts (id, incident_id, type, message, sent_at) VALUES (?, ?, ?, ?, ?)', [1, 1, 'Critical', 'Region ap-south-1 reported EC2 termination spikes. Auto-scaling triggered backup instances.', new Date(Date.now() - 48 * 3600000).toISOString()]);
    await mysqlPool.query('INSERT INTO alerts (id, incident_id, type, message, sent_at) VALUES (?, ?, ?, ?, ?)', [2, 2, 'Warning', 'Region ap-southeast-1 DB replication lagging by >10s. Forcing replication rebuild.', new Date(Date.now() - 24 * 3600000).toISOString()]);
  }

  const [simCount] = await mysqlPool.query<any[]>('SELECT COUNT(*) as count FROM simulation_state');
  if (simCount[0].count === 0) {
    console.log("[Database] Seeding simulation state...");
    await mysqlPool.query('INSERT INTO simulation_state (id, active, type, target_region_id, started_at, step) VALUES (?, ?, ?, ?, ?, ?)', [1, 0, null, null, null, 0]);
  }
}

async function loadStateFromMysql(): Promise<DatabaseState | null> {
  if (!mysqlPool || !isMysqlEnabled) return null;

  try {
    const [regions] = await mysqlPool.query<any[]>('SELECT * FROM regions');
    const [users] = await mysqlPool.query<any[]>('SELECT * FROM users');
    const [incidents] = await mysqlPool.query<any[]>('SELECT * FROM incidents');
    const [health_logs] = await mysqlPool.query<any[]>('SELECT * FROM health_logs ORDER BY id DESC LIMIT 100');
    const [alerts] = await mysqlPool.query<any[]>('SELECT * FROM alerts ORDER BY id DESC LIMIT 50');
    const [simRows] = await mysqlPool.query<any[]>('SELECT * FROM simulation_state WHERE id = 1');

    const mappedRegions = regions.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      last_failover: r.last_failover ? new Date(r.last_failover).toISOString() : null
    }));

    const mappedUsers = users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      created_at: u.created_at
    }));

    const mappedIncidents = incidents.map((i: any) => ({
      id: i.id,
      region_id: i.region_id,
      cause: i.cause,
      recovery_time: i.recovery_time,
      status: i.status,
      created_at: i.created_at
    }));

    const mappedHealthLogs = health_logs.reverse().map((h: any) => ({
      id: h.id,
      region_id: h.region_id,
      cpu_usage: h.cpu_usage,
      memory_usage: h.memory_usage,
      timestamp: h.timestamp
    }));

    const mappedAlerts = alerts.reverse().map((a: any) => ({
      id: a.id,
      incident_id: a.incident_id,
      type: a.type,
      message: a.message,
      sent_at: a.sent_at
    }));

    const sim = simRows[0] || { active: 0, type: null, target_region_id: null, started_at: null, step: 0 };
    const mappedSimulation = {
      active: sim.active === 1,
      type: sim.type,
      target_region_id: sim.target_region_id,
      started_at: sim.started_at,
      step: sim.step
    };

    return {
      regions: mappedRegions,
      users: mappedUsers,
      incidents: mappedIncidents,
      health_logs: mappedHealthLogs,
      alerts: mappedAlerts,
      simulation: mappedSimulation
    };
  } catch (err) {
    console.error("[Database] Error loading state from MySQL:", err);
    return null;
  }
}

function runQuery(sql: string, params: any[] = []) {
  if (!isMysqlEnabled || !mysqlPool) return;
  mysqlPool.query(sql, params).catch(err => {
    console.error(`[Database] Background query error: ${sql}`, err);
  });
}

class DatabaseManager {
  private state: DatabaseState;

  constructor() {
    this.state = { ...INITIAL_STATE };
    this.initDb();
  }

  private initDb() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        this.state = JSON.parse(fileContent);
        // Basic schema validations
        if (!this.state.regions || !this.state.health_logs || !this.state.users) {
          throw new Error("Invalid schema");
        }
      } else {
        // Pre-fill health logs with some baseline history
        this.generateBaselineHealthLogs();
        this.save();
      }
    } catch (e) {
      console.error("Failed to load DB file, resetting to initial state", e);
      this.state = { ...INITIAL_STATE };
      this.generateBaselineHealthLogs();
      this.save();
    }

    // Attempt to connect to MySQL and load state asynchronously
    initMysql().then(async () => {
      if (isMysqlEnabled) {
        const mysqlState = await loadStateFromMysql();
        if (mysqlState) {
          this.state = mysqlState;
          console.log("[Database] Internal state swapped successfully with MySQL database data!");
        }
      }
    });
  }

  private generateBaselineHealthLogs() {
    const now = Date.now();
    // Mumbai (id 1) baseline (active, normal metrics)
    for (let i = 24; i >= 0; i--) {
      const ts = new Date(now - i * 3600000).toISOString();
      this.state.health_logs.push({
        id: this.state.health_logs.length + 1,
        region_id: 1,
        cpu_usage: Math.round(25 + Math.random() * 15),
        memory_usage: Math.round(40 + Math.random() * 10),
        timestamp: ts
      });
      // Singapore (id 2) baseline (standby, lower metrics)
      this.state.health_logs.push({
        id: this.state.health_logs.length + 1,
        region_id: 2,
        cpu_usage: Math.round(5 + Math.random() * 5),
        memory_usage: Math.round(20 + Math.random() * 5),
        timestamp: ts
      });
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error("Error saving database state to disk", err);
    }

    // Synchronize simulation state to MySQL on every write/save
    if (isMysqlEnabled) {
      const sim = this.state.simulation;
      runQuery(
        'UPDATE simulation_state SET active = ?, type = ?, target_region_id = ?, started_at = ?, step = ? WHERE id = 1',
        [sim.active ? 1 : 0, sim.type, sim.target_region_id, sim.started_at, sim.step]
      );
    }
  }

  // --- CRUD API Implementation ---

  // REGIONS
  getRegions(): Region[] {
    return this.state.regions;
  }

  getRegionById(id: number): Region | undefined {
    return this.state.regions.find(r => r.id === id);
  }

  updateRegion(id: number, updates: Partial<Region>): Region | undefined {
    const rIndex = this.state.regions.findIndex(r => r.id === id);
    if (rIndex === -1) return undefined;
    this.state.regions[rIndex] = { ...this.state.regions[rIndex], ...updates };
    this.save();

    // MySQL sync
    const r = this.state.regions[rIndex];
    runQuery(
      'UPDATE regions SET status = ?, last_failover = ? WHERE id = ?',
      [r.status, r.last_failover ? new Date(r.last_failover) : null, id]
    );

    return r;
  }

  // HEALTH LOGS
  getHealthLogs(): HealthLog[] {
    return this.state.health_logs;
  }

  addHealthLog(log: Omit<HealthLog, 'id'>): HealthLog {
    const newLog = {
      id: this.state.health_logs.length > 0 ? Math.max(...this.state.health_logs.map(l => l.id)) + 1 : 1,
      ...log
    };
    this.state.health_logs.push(newLog);
    // Limit health logs to last 100 entries to prevent memory leak/file bloat
    if (this.state.health_logs.length > 100) {
      this.state.health_logs.shift();
    }
    this.save();

    // MySQL sync
    runQuery(
      'INSERT INTO health_logs (id, region_id, cpu_usage, memory_usage, timestamp) VALUES (?, ?, ?, ?, ?)',
      [newLog.id, newLog.region_id, newLog.cpu_usage, newLog.memory_usage, newLog.timestamp]
    );

    return newLog;
  }

  // INCIDENTS
  getIncidents(): Incident[] {
    return this.state.incidents;
  }

  getIncidentById(id: number): Incident | undefined {
    return this.state.incidents.find(i => i.id === id);
  }

  addIncident(incident: Omit<Incident, 'id' | 'created_at'>): Incident {
    const newIncident = {
      id: this.state.incidents.length > 0 ? Math.max(...this.state.incidents.map(i => i.id)) + 1 : 1,
      ...incident,
      created_at: new Date().toISOString()
    };
    this.state.incidents.push(newIncident);
    this.save();

    // MySQL sync
    runQuery(
      'INSERT INTO incidents (id, region_id, cause, recovery_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [newIncident.id, newIncident.region_id, newIncident.cause, newIncident.recovery_time, newIncident.status, newIncident.created_at]
    );

    return newIncident;
  }

  updateIncident(id: number, updates: Partial<Incident>): Incident | undefined {
    const iIndex = this.state.incidents.findIndex(i => i.id === id);
    if (iIndex === -1) return undefined;
    this.state.incidents[iIndex] = { ...this.state.incidents[iIndex], ...updates };
    this.save();

    // MySQL sync
    const inc = this.state.incidents[iIndex];
    runQuery(
      'UPDATE incidents SET status = ?, recovery_time = ? WHERE id = ?',
      [inc.status, inc.recovery_time, id]
    );

    return this.state.incidents[iIndex];
  }

  // ALERTS
  getAlerts(): Alert[] {
    return this.state.alerts;
  }

  addAlert(alert: Omit<Alert, 'id' | 'sent_at'>): Alert {
    const newAlert = {
      id: this.state.alerts.length > 0 ? Math.max(...this.state.alerts.map(a => a.id)) + 1 : 1,
      ...alert,
      sent_at: new Date().toISOString()
    };
    this.state.alerts.push(newAlert);
    if (this.state.alerts.length > 50) {
      this.state.alerts.shift();
    }
    this.save();

    // MySQL sync
    runQuery(
      'INSERT INTO alerts (id, incident_id, type, message, sent_at) VALUES (?, ?, ?, ?, ?)',
      [newAlert.id, newAlert.incident_id, newAlert.type, newAlert.message, newAlert.sent_at]
    );

    return newAlert;
  }

  // USERS
  getUsers(): User[] {
    return this.state.users;
  }

  addUser(user: Omit<User, 'id' | 'created_at'>): User {
    const newUser = {
      id: this.state.users.length > 0 ? Math.max(...this.state.users.map(u => u.id)) + 1 : 1,
      ...user,
      created_at: new Date().toISOString()
    };
    this.state.users.push(newUser);
    this.save();

    // MySQL sync
    runQuery(
      'INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [newUser.id, newUser.name, newUser.email, newUser.role, newUser.created_at]
    );

    return newUser;
  }

  updateUser(id: number, updates: Partial<User>): User | undefined {
    const uIndex = this.state.users.findIndex(u => u.id === id);
    if (uIndex === -1) return undefined;
    this.state.users[uIndex] = { ...this.state.users[uIndex], ...updates };
    this.save();

    // MySQL sync
    const u = this.state.users[uIndex];
    runQuery(
      'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?',
      [u.name, u.email, u.role, id]
    );

    return this.state.users[uIndex];
  }

  deleteUser(id: number): boolean {
    const uIndex = this.state.users.findIndex(u => u.id === id);
    if (uIndex === -1) return false;
    this.state.users.splice(uIndex, 1);
    this.save();

    // MySQL sync
    runQuery('DELETE FROM users WHERE id = ?', [id]);

    return true;
  }

  // --- SIMULATION MANAGEMENT ---

  getSimulationState() {
    return this.state.simulation;
  }

  triggerSimulation(type: 'EC2' | 'Database' | 'High_CPU' | 'Network'): { success: boolean; incident: Incident; alert: Alert } {
    // End any active simulation first
    this.resetSimulation();

    const activeRegion = this.state.regions.find(r => r.status === 'Active') || this.state.regions[0];
    const causeMap = {
      EC2: 'EC2 Instance Cluster Termination - Hardware Fault',
      Database: 'Database Master Loss - Corrupted WAL Logs',
      High_CPU: 'High CPU Core Utilization Alert (Load Spikes)',
      Network: 'BGP Routing Hijack / Inter-Region Packet Drop'
    };

    const cause = causeMap[type];

    // 1. Create incident
    const incident = this.addIncident({
      region_id: activeRegion.id,
      cause,
      recovery_time: null,
      status: 'Investigating'
    });

    // 2. Create alarm alert
    const alert = this.addAlert({
      incident_id: incident.id,
      type: 'Critical',
      message: `ALERT: Disaster simulation '${type}' activated in ${activeRegion.name}. Status: Investigating.`
    });

    // 3. Set region health metrics to abnormal range
    this.updateRegion(activeRegion.id, {
      status: type === 'High_CPU' ? 'Degraded' : 'Critical'
    });

    // 4. Update simulation state
    this.state.simulation = {
      active: true,
      type,
      target_region_id: activeRegion.id,
      started_at: new Date().toISOString(),
      step: 1 // Triggered
    };
    this.save();

    return { success: true, incident, alert };
  }

  progressSimulation(): { step: number; logs: string[] } {
    const logs: string[] = [];
    if (!this.state.simulation.active) return { step: 0, logs };

    const sim = this.state.simulation;
    const targetRegion = this.getRegionById(sim.target_region_id!);
    const standbyRegion = this.state.regions.find(r => r.id !== sim.target_region_id);

    if (!targetRegion || !standbyRegion) return { step: 0, logs };

    const activeIncident = this.state.incidents.find(i => i.region_id === targetRegion.id && i.status !== 'Resolved');

    if (sim.step === 1) {
      // Step 1 -> 2: Initiate automated failover
      sim.step = 2;
      logs.push(`SentinelDR ADR Agent triggered: Initiating automated failover from ${targetRegion.name} to ${standbyRegion.name}.`);

      if (activeIncident) {
        this.updateIncident(activeIncident.id, { status: 'Mitigating' });
        this.addAlert({
          incident_id: activeIncident.id,
          type: 'Warning',
          message: `ADR (Automated Disaster Recovery) initiated: Diverting traffic from degraded ${targetRegion.name}. Promoting standby ${standbyRegion.name}.`
        });
      }

      this.save();
    } else if (sim.step === 2) {
      // Step 2 -> 3: Failover completed, standby promoted, target marked healthy or Standby
      sim.step = 3;
      const recoveryTime = Math.round((Date.now() - new Date(sim.started_at!).getTime()) / 1000);

      logs.push(`Failover complete: Traffic successfully routed to ${standbyRegion.name}. ${targetRegion.name} is now quarantined.`);

      // Swap active states
      this.updateRegion(standbyRegion.id, { status: 'Active', last_failover: new Date().toISOString() });
      this.updateRegion(targetRegion.id, { status: 'Standby' });

      if (activeIncident) {
        this.updateIncident(activeIncident.id, {
          status: 'Resolved',
          recovery_time: recoveryTime
        });
        this.addAlert({
          incident_id: activeIncident.id,
          type: 'Info',
          message: `Mitigation successful. Primary endpoints relocated to ${standbyRegion.name}. RTO: ${recoveryTime}s. RPO: 0.2s.`
        });
      }

      // Deactivate simulation flag
      sim.active = false;
      sim.step = 0;
      sim.type = null;
      sim.started_at = null;
      sim.target_region_id = null;

      this.save();
    }

    return { step: sim.step, logs };
  }

  manualFailover(fromRegionId: number, toRegionId: number): { success: boolean; message: string } {
    const fromRegion = this.getRegionById(fromRegionId);
    const toRegion = this.getRegionById(toRegionId);

    if (!fromRegion || !toRegion) {
      return { success: false, message: 'Invalid regions selected.' };
    }

    // Perform manual swap
    this.updateRegion(fromRegionId, { status: 'Standby' });
    this.updateRegion(toRegionId, { status: 'Active', last_failover: new Date().toISOString() });

    // Log incident & alert for records
    const incident = this.addIncident({
      region_id: fromRegionId,
      cause: `Operator Manual Failover Switch (Initiated by User)`,
      recovery_time: 12,
      status: 'Resolved'
    });

    this.addAlert({
      incident_id: incident.id,
      type: 'Info',
      message: `Manual Failover triggered: Switched primary route from ${fromRegion.name} to ${toRegion.name} smoothly.`
    });

    return { success: true, message: `Successfully shifted operational master to ${toRegion.name}.` };
  }

  resetSimulation() {
    this.state.simulation = {
      active: false,
      type: null,
      target_region_id: null,
      started_at: null,
      step: 0
    };
    // Force active regions to normal statuses if corrupted
    const activeExists = this.state.regions.some(r => r.status === 'Active');
    if (!activeExists) {
      this.state.regions[0].status = 'Active';
      this.state.regions[1].status = 'Standby';
    } else {
      this.state.regions.forEach(r => {
        if (r.status === 'Critical' || r.status === 'Degraded') {
          r.status = 'Standby';
        }
      });
    }
    this.save();
  }

  tickHealthLogs() {
    const now = new Date().toISOString();
    const sim = this.state.simulation;

    this.state.regions.forEach(region => {
      let cpu = 0;
      let memory = 0;

      if (sim.active && sim.target_region_id === region.id) {
        // Degraded metrics for target
        if (sim.type === 'High_CPU') {
          cpu = Math.round(92 + Math.random() * 7);
          memory = Math.round(55 + Math.random() * 10);
        } else if (sim.type === 'Database') {
          cpu = Math.round(15 + Math.random() * 10);
          memory = Math.round(89 + Math.random() * 8);
        } else if (sim.type === 'EC2') {
          cpu = 0; // Offline
          memory = 0;
        } else {
          // Network failure
          cpu = Math.round(45 + Math.random() * 10);
          memory = Math.round(45 + Math.random() * 10);
        }
      } else if (region.status === 'Active') {
        cpu = Math.round(20 + Math.random() * 15);
        memory = Math.round(35 + Math.random() * 15);
      } else {
        // Standby
        cpu = Math.round(2 + Math.random() * 5);
        memory = Math.round(15 + Math.random() * 5);
      }

      this.addHealthLog({
        region_id: region.id,
        cpu_usage: cpu,
        memory_usage: memory,
        timestamp: now
      });
    });
  }

  getDbStatus() {
    return {
      mysqlEnabled: isMysqlEnabled,
      host: process.env.MYSQL_HOST || 'none',
      database: process.env.MYSQL_DATABASE || 'none',
    };
  }
}

export const db = new DatabaseManager();
