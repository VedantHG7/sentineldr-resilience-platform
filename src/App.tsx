import React, { useState, useEffect } from 'react';
import { 
  Globe, ShieldAlert, Activity, Play, RefreshCw, Terminal, 
  Settings as SettingsIcon, AlertOctagon, UserCheck, ShieldAlert as ShieldIcon,
  Trash2, Plus, Edit2, Loader2, Sparkles, AlertTriangle, CheckCircle2,
  Lock, Check, Mail, Bell, Shield, ExternalLink, Download, ArrowLeftRight
} from 'lucide-react';
import { Region, CurrentHealthMetric, TelemetryData, Incident, Alert, User, SimulationState } from './types';
import DashboardView from './components/DashboardView';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [currentTime, setCurrentTime] = useState<string>('');
  
  // App data states
  const [regions, setRegions] = useState<Region[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [ec2Status, setEc2Status] = useState<any>(null);
  const [awsMetrics, setAwsMetrics] = useState<any>(null);  
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [simulation, setSimulation] = useState<SimulationState>({
    active: false,
    type: null,
    target_region_id: null,
    started_at: null,
    step: 0
  });

  // UI States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [userForm, setUserForm] = useState({ name: '', email: '', role: 'Operator' as any });
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [aiPlaybook, setAiPlaybook] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [isSimulatingTransition, setIsSimulatingTransition] = useState<boolean>(false);
  const [failoverMessage, setFailoverMessage] = useState<string>('');

  // Local Persistence Alerts Settings
  const [alertSettings, setAlertSettings] = useState(() => {
    const saved = localStorage.getItem('sentinel_alert_settings');
    return saved ? JSON.parse(saved) : {
      slack_webhook: true,
      pagerduty_sms: true,
      email_alerts: true,
      auto_rollback: true
    };
  });

  const [dbStatus, setDbStatus] = useState<{ mysqlEnabled: boolean; host: string; database: string } | null>(null);

  // Save alerts settings to local storage
  const handleAlertSettingsChange = (key: string, value: boolean) => {
    const updated = { ...alertSettings, [key]: value };
    setAlertSettings(updated);
    localStorage.setItem('sentinel_alert_settings', JSON.stringify(updated));
  };

  // Clock Update Effect (UTC timezone)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Primary Data Fetching
  const fetchData = async (silent = false) => {
    if (!silent) setIsLoading(true);

    const safeFetchJson = async (url: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`Fetch to ${url} failed with status: ${res.status}`);
          return null;
        }
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          console.warn(`Fetch to ${url} returned non-JSON content-type: ${contentType}`);
          return null;
        }
        return await res.json();
      } catch (err) {
        console.error(`Error fetching/parsing ${url}:`, err);
        return null;
      }
    };

    try {
      const [regionsData, healthData, incidentsData, alertsData, usersData, simData, dbStatusData,ec2StatusData,awsMetricsData] = await Promise.all([
        safeFetchJson('/api/regions'),
        safeFetchJson('/api/health'),
        safeFetchJson('/api/incidents'),
        safeFetchJson('/api/alerts'),
        safeFetchJson('/api/users'),
        safeFetchJson('/api/simulation'),
        safeFetchJson('/api/db-status'),
  	safeFetchJson('/api/aws/ec2-status'),
	safeFetchJson('/api/aws/metrics')
      ]);

      if (regionsData !== null) setRegions(regionsData);
      if (healthData !== null) setTelemetry(healthData);
      if (incidentsData !== null) setIncidents(incidentsData);
      if (alertsData !== null) setAlerts(alertsData);
      if (usersData !== null) setUsers(usersData);
      if (simData !== null) setSimulation(simData);
      if (dbStatusData !== null) setDbStatus(dbStatusData);
      if (ec2StatusData !== null) setEc2Status(ec2StatusData);
      if (awsMetricsData !== null) {
  console.log("AWS Metrics:", awsMetricsData);
  setAwsMetrics(awsMetricsData);
}
    } catch (err) {
      console.error("Failed to sync state from SentinelDR core APIs", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger Telemetry Sync on mount
  useEffect(() => {
    fetchData();
  }, []);

  // Multi-region Auto Polling
  useEffect(() => {
    const intervalTime = simulation.active ? 3000 : 10000; // Snappier 3s updates during active recovery
    const pollTimer = setInterval(() => {
      fetchData(true);
    }, intervalTime);
    return () => clearInterval(pollTimer);
  }, [simulation.active]);

  // Trigger Disaster Simulation Chaos Experiments
  const handleTriggerSimulation = async (type: 'EC2' | 'Database' | 'High_CPU' | 'Network') => {
    setIsSimulatingTransition(true);
    try {
      const response = await fetch('/api/simulation/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      if (response.ok) {
        await fetchData(true);
        // Switch to simulation dashboard view to let user watch the steps
        setActiveTab('simulation');
      }
    } catch (e) {
      console.error("Simulation trigger failed", e);
    } finally {
      setIsSimulatingTransition(false);
    }
  };

  // Reset Simulation
  const handleResetSimulation = async () => {
    setIsSimulatingTransition(true);
    try {
      const response = await fetch('/api/simulation/reset', { method: 'POST' });
      if (response.ok) {
        await fetchData(true);
      }
    } catch (e) {
      console.error("Simulation reset failed", e);
    } finally {
      setIsSimulatingTransition(false);
    }
  };

  // Manual DNS Reroute (Failover Override)
  const handleManualFailover = async (fromId: number, toId: number) => {
    setIsSimulatingTransition(true);
    setFailoverMessage('');
    try {
      const response = await fetch('/api/regions/failover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromRegionId: fromId, toRegionId: toId })
      });
      if (response.ok) {
        const data = await response.json();
        setFailoverMessage(data.message);
        await fetchData(true);
      }
    } catch (e) {
      console.error("Manual failover failed", e);
    } finally {
      setIsSimulatingTransition(false);
    }
  };

  // Fetch AI Resilience Analysis Playbook (Gemini API Integration)
  const handleFetchAiPlaybook = async (incident: Incident) => {
    setSelectedIncident(incident);
    setAiPlaybook('');
    setIsAiLoading(true);
    try {
      const response = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: incident.id })
      });
      if (response.ok) {
        const data = await response.json();
        setAiPlaybook(data.playbook);
      } else {
        setAiPlaybook("Error: Failed to orchestrate Gemini API to analyze current incident.");
      }
    } catch (err: any) {
      setAiPlaybook(`Network failure requesting AI analysis: ${err.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  // CRUD User Actions
  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.name || !userForm.email) return;

    try {
      if (editingUserId) {
        // UPDATE
        const res = await fetch(`/api/users/${editingUserId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userForm)
        });
        if (res.ok) {
          setEditingUserId(null);
          setUserForm({ name: '', email: '', role: 'Operator' });
          fetchData(true);
        }
      } else {
        // CREATE
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userForm)
        });
        if (res.ok) {
          setUserForm({ name: '', email: '', role: 'Operator' });
          fetchData(true);
        }
      }
    } catch (err) {
      console.error("User save error", err);
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUserId(user.id);
    setUserForm({ name: user.name, email: user.email, role: user.role });
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm("Are you sure you want to deprovision these operator credentials?")) return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData(true);
      }
    } catch (err) {
      console.error("User deletion error", err);
    }
  };

  // Helper for rendering simulation steps
  const getSimulationStepLabel = (step: number) => {
    switch(step) {
      case 1: return { label: 'ANOMALY DETECTED', desc: 'SentinelDR ADR daemon detected endpoint failure. Isolating region...' };
      case 2: return { label: 'REROUTING DNS RECORDS', desc: 'Triggering multi-zone health checks. Promoting failover target cluster...' };
      case 3: return { label: 'FAILOVER COMPLETED', desc: 'Active status transferred successfully. Operations stabilized.' };
      default: return { label: 'OPERATIONAL', desc: 'Continuous environment tracking' };
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-x-hidden selection:bg-blue-500/30 selection:text-white">
      
      {/* Top Elegant Dark Navigation Bar */}
      <nav className="flex items-center justify-between px-6 py-4 bg-slate-900/45 border-b border-slate-800 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          {/* Animated Sentinel Logo */}
          <div className="w-9 h-9 bg-blue-600 rounded flex items-center justify-center shadow-lg shadow-blue-500/20">
            <div className="w-4.5 h-4.5 border-2 border-white rotate-45 transition-transform duration-700 hover:rotate-[225deg]"></div>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <h1 className="text-lg font-extrabold tracking-tight text-white font-sans">Sentinel<span className="text-blue-400">DR</span></h1>
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest bg-slate-800 px-1 py-0.2 rounded">Edge v2.4</span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono">Disaster Recovery platform</p>
          </div>
          
          <span className={`ml-4 hidden sm:inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
            simulation.active
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse'
              : 'bg-green-500/10 text-green-400 border-green-500/20'
          }`}>
            {simulation.active ? 'FAILOVER DISPATCHED' : 'SYSTEM OPERATIONAL'}
          </span>

          {dbStatus && (
            <span className={`ml-2 hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
              dbStatus.mysqlEnabled
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`} title={dbStatus.mysqlEnabled ? `Connected to MySQL: ${dbStatus.host}/${dbStatus.database}` : 'Fallback to local JSON database storage'}>
              <span className={`w-1.5 h-1.5 rounded-full ${dbStatus.mysqlEnabled ? 'bg-blue-400 animate-pulse' : 'bg-amber-400'}`}></span>
              DB: {dbStatus.mysqlEnabled ? 'MySQL Connected' : 'Local JSON'}
            </span>
          )}
        </div>

        {/* Navigation Tabs (Elegant Dark Style) */}
        <div className="hidden lg:flex gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
          {[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'regions', label: 'Region Status' },
            { id: 'incidents', label: 'Incidents Center' },
            { id: 'simulation', label: 'Simulation Console', highlight: true },
            { id: 'settings', label: 'Settings & Users' }
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-1.5 text-xs font-mono font-medium rounded-md transition duration-200 cursor-pointer ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow' 
                    : tab.highlight 
                    ? 'text-orange-400 hover:bg-slate-900 hover:text-orange-300' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
                id={`nav-tab-${tab.id}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Live Clock / Operators State */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-mono">Sentinel-Edge-01</p>
            <p className="text-[11px] font-mono text-slate-300 tracking-wider font-semibold">{currentTime || 'Syncing UTC...'}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-400 via-slate-800 to-slate-950">
            <span className="text-[10px] font-mono font-bold text-white">PD</span>
          </div>
        </div>
      </nav>

      {/* Mobile navigation row */}
      <div className="lg:hidden flex bg-slate-900 border-b border-slate-800 overflow-x-auto py-2 px-4 gap-2 scrollbar-none">
        {[
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'regions', label: 'Regions' },
          { id: 'incidents', label: 'Incidents' },
          { id: 'simulation', label: 'Simulation' },
          { id: 'settings', label: 'Settings' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs font-mono shrink-0 rounded ${
              activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 bg-slate-950'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Grid Workspace */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto" id="main-content-layout">
        
        {/* Loading Spinner Overlays */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-xs font-mono text-slate-400">Synchronizing SentinelDR multi-region cloud topology...</p>
          </div>
        ) : (
          <>
            {/* 1. DASHBOARD VIEW */}
            {activeTab === 'dashboard' && (
              <DashboardView 
                telemetry={telemetry} 
                incidents={incidents} 
                alerts={alerts}
                onRefresh={() => fetchData(false)}
                isLoading={isLoading}
                onNavigate={(tab) => setActiveTab(tab)}
                onManualFailover={() => setActiveTab('regions')}
                simulation={simulation}
                onTriggerSimulation={handleTriggerSimulation}
                onResetSimulation={handleResetSimulation}
                isSimulatingTransition={isSimulatingTransition}
              />
            )}

            {/* 2. REGION STATUS VIEW */}
            {activeTab === 'regions' && (
              <div className="space-y-6 animate-fade-in" id="regions-status-view">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Multi-Region Cloud Topology</h2>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">DNS target mappings, active router nodes, and database log replication indices.</p>
                </div>

                {/* Failover Status Override Box */}
                {failoverMessage && (
                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-between animate-bounce">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-blue-400" />
                      <p className="text-xs text-slate-200 font-mono font-medium">{failoverMessage}</p>
                    </div>
                    <button onClick={() => setFailoverMessage('')} className="text-[10px] text-slate-400 hover:text-white font-mono uppercase font-bold underline">
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Regions Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="regions-cards-grid">
                  {regions.map(region => {
                    const isMumbai = region.id === 1;
                    const regionTelemetry = telemetry?.current.find(t => t.region_id === region.id);
                    
                    let bgBorder = 'border-slate-800 bg-slate-900';
                    let statusColor = 'text-green-400 bg-green-500/10 border-green-500/20';
                    
                    if (region.status === 'Critical') {
                      bgBorder = 'border-rose-900/40 bg-rose-950/5';
                      statusColor = 'text-rose-400 bg-rose-500/10 border-rose-500/20 animate-pulse';
                    } else if (region.status === 'Degraded') {
                      bgBorder = 'border-amber-900/40 bg-amber-950/5';
                      statusColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
                    } else if (region.status === 'Standby') {
                      statusColor = 'text-slate-400 bg-slate-800 border-slate-700';
                    }

                    return (
                      <div key={region.id} className={`border rounded-xl p-6 space-y-6 transition duration-300 hover:shadow-lg ${bgBorder}`} id={`region-detail-card-${region.id}`}>
                        
                        {/* Region Header */}
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                              {isMumbai ? 'ap-south-1 • Primary Area' : 'ap-southeast-1 • Standby Failover Target'}
                            </span>
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                              <Globe className={`w-5 h-5 ${isMumbai ? 'text-blue-400' : 'text-emerald-400'}`} />
                              {region.name}
                            </h3>
                          </div>
                          
                          <div className="flex flex-col items-end gap-1">
  <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold uppercase ${statusColor}`}>
    {region.status}
  </span>

  <span className="text-[11px] text-slate-400 font-mono">
    EC2: {
      isMumbai
        ? ec2Status?.mumbai?.state || "Loading..."
        : ec2Status?.singapore?.state || "Loading..."
    }
  </span>
</div>
                        </div>

                        {/* Realtime Metrics gauges */}
                        <div className="grid grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-lg border border-slate-800/80">
                          <div>
                            <div className="flex justify-between items-baseline mb-1">
                              <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">CPU CORES</span>
                              <span className="text-xs font-mono text-white font-bold">{
  isMumbai
    ? awsMetrics?.mumbai?.cpu ?? 0
    : awsMetrics?.singapore?.cpu ?? 0
}%%</span>
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all duration-500 ${
                                  (regionTelemetry?.cpu || 0) > 75 ? 'bg-rose-500' : 'bg-blue-500'
                                }`}
                                style={{
  width: `${
    isMumbai
      ? awsMetrics?.mumbai?.cpu ?? 0
      : awsMetrics?.singapore?.cpu ?? 0
  }%`
}}
                              ></div>
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between items-baseline mb-1">
                              <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">MEM RESIDENCY</span>
                            <span className="text-xs font-mono text-white font-bold">
  {isMumbai
    ? awsMetrics?.mumbai?.memory?.toFixed(2) ?? 0
    : awsMetrics?.singapore?.memory?.toFixed(2) ?? 0}%
</span>
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all duration-500 ${
                                  (isMumbai
                                    ? awsMetrics?.mumbai?.cpu ?? 0
                                    : awsMetrics?.singapore?.cpu ?? 0) > 75 ? 'bg-rose-500' : 'bg-green-500'
                                }`}
                                style={{
  width: `${
    isMumbai
      ? awsMetrics?.mumbai?.memory ?? 0
      : awsMetrics?.singapore?.memory ?? 0
  }%`
}}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* Regional Diagnostic Variables */}
                        <div className="space-y-3 text-xs font-mono divide-y divide-slate-800/60">
                          <div className="flex justify-between pt-2">
                            <span className="text-slate-500">DNS ROUTING ENDPOINT</span>
                            <span className="text-slate-300 truncate max-w-[200px]" title={isMumbai ? 'mumbai.gateway.sentineldr.io' : 'singapore.backup.sentineldr.io'}>
                              {isMumbai ? 'mumbai.gateway.sentineldr.io' : 'singapore.backup.sentineldr.io'}
                            </span>
                          </div>
                          <div className="flex justify-between pt-2">
                            <span className="text-slate-500">REPLICATION STATUS</span>
                            <span className="text-slate-300">
                              {region.status === 'Active' ? 'Master (R/W)' : 'Replica Lag (0.18s)'}
                            </span>
                          </div>
                          <div className="flex justify-between pt-2">
                            <span className="text-slate-500">LAST SYNCED HEARTBEAT</span>
                            <span className="text-slate-300">
                              {regionTelemetry ? new Date(regionTelemetry.timestamp).toLocaleTimeString() : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between pt-2">
                            <span className="text-slate-500">FAILOVER TIMESTAMP</span>
                            <span className="text-slate-300">
                              {region.last_failover ? new Date(region.last_failover).toLocaleString() : 'Never Triggered'}
                            </span>
                          </div>
                        </div>

                        {/* Route Overrides Action */}
                        <div className="pt-4 border-t border-slate-800 flex justify-end">
                          {region.status !== 'Active' ? (
                            <button
                              onClick={() => {
                                const fromId = regions.find(r => r.status === 'Active')?.id || 1;
                                handleManualFailover(fromId, region.id);
                              }}
                              disabled={isSimulatingTransition}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-mono font-medium flex items-center gap-2 cursor-pointer transition"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              Promote to Primary (Force DNS Swap)
                            </button>
                          ) : (
                            <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                              Handling active DNS load pools
                            </div>
                          )}
                        </div>

                      </div>
                    );
                  })}
                </div>

                {/* Reliability SLA Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <h3 className="text-sm font-semibold text-white mb-3">Multi-Region Replication Matrix</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs font-mono">
                    <div className="p-3 bg-slate-950 rounded border border-slate-800">
                      <p className="text-slate-500 uppercase font-bold text-[9px] tracking-wider mb-1">RPO SLA (Data Loss)</p>
                      <p className="text-base text-white font-semibold">0.5 seconds</p>
                      <span className="text-green-400">STATUS: MATCHED</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded border border-slate-800">
                      <p className="text-slate-500 uppercase font-bold text-[9px] tracking-wider mb-1">RTO SLA (Mitigation Time)</p>
                      <p className="text-base text-white font-semibold">30.0 seconds</p>
                      <span className="text-green-400">STATUS: MATCHED</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded border border-slate-800">
                      <p className="text-slate-500 uppercase font-bold text-[9px] tracking-wider mb-1">MySQL Database Cluster</p>
                      <p className="text-base text-white font-semibold">Dual Master Active-Standby</p>
                      <span className="text-blue-400">SYNC STATE: IDLE</span>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* 3. INCIDENT CENTER VIEW */}
            {activeTab === 'incidents' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in" id="incidents-center-view">
                
                {/* Incident List */}
                <div className="lg:col-span-8 space-y-6">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-white">Incident Center</h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">Automated audits of all security anomalies, simulated disaster events, and DNS failover triggers.</p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">Registered Incidents ({incidents.length})</span>
                      <button onClick={() => fetchData()} className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer">
                        <RefreshCw className="w-3 h-3" /> Sync Table
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-slate-500 text-xs uppercase tracking-widest border-b border-slate-800">
                            <th className="pb-3 font-medium font-mono">Incident ID</th>
                            <th className="pb-3 font-medium">Timestamp</th>
                            <th className="pb-3 font-medium">Impacted Region</th>
                            <th className="pb-3 font-medium">Root Cause Anomaly</th>
                            <th className="pb-3 font-medium text-right">RTO Time</th>
                            <th className="pb-3 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs divide-y divide-slate-800/50">
                          {incidents.map((incident) => {
                            const isSelected = selectedIncident?.id === incident.id;
                            const isResolved = incident.status === 'Resolved';
                            
                            return (
                              <tr 
                                key={incident.id} 
                                className={`transition duration-150 cursor-pointer ${
                                  isSelected 
                                    ? 'bg-blue-600/10' 
                                    : 'hover:bg-slate-800/30'
                                }`}
                                onClick={() => handleFetchAiPlaybook(incident)}
                              >
                                <td className="py-4 font-mono text-slate-400">#DR-{1000 + incident.id}</td>
                                <td className="py-4 text-slate-300">
                                  {new Date(incident.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                <td className="py-4 text-slate-300 font-mono">
                                  {incident.region_id === 1 ? 'Mumbai (ap-south-1)' : 'Singapore (ap-southeast-1)'}
                                </td>
                                <td className="py-4 text-white font-medium max-w-[180px] truncate" title={incident.cause}>
                                  {incident.cause}
                                </td>
                                <td className="py-4 text-right font-mono text-slate-300">
                                  {incident.recovery_time ? `${incident.recovery_time}s` : 'Active Failover'}
                                </td>
                                <td className="py-4 text-right">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleFetchAiPlaybook(incident);
                                    }}
                                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 rounded border border-slate-700 text-[10px] font-mono flex items-center gap-1 ml-auto cursor-pointer"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    AI Report
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {incidents.length === 0 && (
                            <tr>
                              <td colSpan={6} className="text-center py-12 text-slate-500 font-mono">
                                No incident reports exist on disk. Use the Simulation tab to trigger a resilience test.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* AI Resilience Assistant Drawer */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 min-h-[450px] flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-6 h-6 rounded bg-purple-600/20 flex items-center justify-center border border-purple-500/30">
                          <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                        </div>
                        <h3 className="text-sm font-semibold text-white">AI Resilience Specialist</h3>
                      </div>
                      
                      {selectedIncident ? (
                        <div className="space-y-4">
                          <div className="p-3 bg-slate-950 rounded border border-slate-800 text-xs">
                            <p className="text-slate-500 font-mono font-semibold uppercase text-[9px]">Analyzing Incident</p>
                            <h4 className="font-bold text-white mt-1">#DR-{1000 + selectedIncident.id}</h4>
                            <p className="text-slate-300 font-mono mt-1 text-[11px] leading-relaxed">{selectedIncident.cause}</p>
                          </div>

                          {isAiLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 space-y-2">
                              <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                              <p className="text-[11px] font-mono text-slate-500">Retrieving intelligence analysis...</p>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-300 space-y-3 font-sans leading-relaxed overflow-y-auto max-h-[350px] pr-1">
                              {aiPlaybook ? (
                                <div className="prose prose-invert prose-xs max-w-full">
                                  {/* Render formatting safely */}
                                  <div className="whitespace-pre-line bg-slate-950/40 p-3 rounded-lg border border-slate-800/80 font-sans text-slate-300 text-[11px] leading-relaxed">
                                    {aiPlaybook}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-slate-500 italic text-center py-12">Click "AI Report" on any incident row to generate recommendations using Google Gemini.</p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-16 text-xs text-slate-500 space-y-3 font-mono">
                          <AlertOctagon className="w-8 h-8 mx-auto text-slate-600" />
                          <p>Select an incident on the left to activate the server-side AI Resilience Specialist.</p>
                        </div>
                      )}
                    </div>

                    <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg text-[10px] text-slate-400 leading-normal">
                      <strong>Note:</strong> playbooks analyze real telemetry logs using the <code>gemini-3.5-flash</code> core node model.
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* 4. CHAOS SIMULATION CONSOLE VIEW */}
            {activeTab === 'simulation' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in" id="simulation-console-view">
                
                {/* Simulation Control Board */}
                <div className="lg:col-span-8 space-y-6">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-white">Disaster Simulation Console</h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">Inject high-fidelity fault patterns into ap-south-1 to evaluate automatic failover rules.</p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                    <div>
                      <h3 className="text-base font-semibold text-orange-400 mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-400" />
                        Chaos Injection Vectors
                      </h3>
                      <p className="text-xs text-slate-400">Trigger any of the automated failure blueprints below. Once triggered, the active region will fail, launching an immediate multi-region failover sequence.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      {/* Vector 1 */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                            EC2 Cluster Outage
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1 leading-normal">Simulates full hypervisor node termination, resulting in a sudden drop of standard server health ratings to Critical.</p>
                        </div>
                        <button
                          onClick={() => handleTriggerSimulation('EC2')}
                          disabled={simulation.active || isSimulatingTransition}
                          className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white rounded border border-slate-700 text-xs font-mono transition cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Play className="w-3 h-3 text-orange-400 fill-orange-400" /> Inject Terminate EC2
                        </button>
                      </div>

                      {/* Vector 2 */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
                            Database Master Loss
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1 leading-normal">Simulates transaction log corruption on the primary database engine, mimicking SQL connectivity timeout events.</p>
                        </div>
                        <button
                          onClick={() => handleTriggerSimulation('Database')}
                          disabled={simulation.active || isSimulatingTransition}
                          className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white rounded border border-slate-700 text-xs font-mono transition cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Play className="w-3 h-3 text-orange-400 fill-orange-400" /> Inject DB Corruption
                        </button>
                      </div>

                      {/* Vector 3 */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                            100% CPU Resource Spike
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1 leading-normal">Simulates massive DDoS traffic loading or infinite loop errors, causing CPU metrics to jump to 99% in ap-south-1.</p>
                        </div>
                        <button
                          onClick={() => handleTriggerSimulation('High_CPU')}
                          disabled={simulation.active || isSimulatingTransition}
                          className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white rounded border border-slate-700 text-xs font-mono transition cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Play className="w-3 h-3 text-orange-400 fill-orange-400" /> Inject CPU Overload
                        </button>
                      </div>

                      {/* Vector 4 */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                            DNS Partition Fault
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1 leading-normal">Simulates network BGP route failure causing full inter-region isolation and routing drops between edge sites.</p>
                        </div>
                        <button
                          onClick={() => handleTriggerSimulation('Network')}
                          disabled={simulation.active || isSimulatingTransition}
                          className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white rounded border border-slate-700 text-xs font-mono transition cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Play className="w-3 h-3 text-orange-400 fill-orange-400" /> Inject BGP Partition
                        </button>
                      </div>

                    </div>

                    {/* Reset State Action */}
                    <div className="pt-4 border-t border-slate-800 flex justify-between items-center bg-slate-950 p-4 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-400">
                        <strong className="text-slate-200">Safety Switch:</strong> Flush simulation logs to restore continuous baseline monitoring instantly.
                      </div>
                      <button
                        onClick={handleResetSimulation}
                        disabled={isSimulatingTransition}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-mono rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Teardown Experiment
                      </button>
                    </div>

                  </div>
                </div>

                {/* Simulated ADR Terminal Log */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between h-full min-h-[480px]">
                    <div className="space-y-4 flex-1 flex flex-col">
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-blue-400 animate-pulse" />
                        ADR Orchestration Agent
                      </h3>
                      
                      {/* Live Steps Console */}
                      <div className="bg-slate-950 rounded-lg p-4 font-mono text-[11px] text-blue-400 space-y-4 flex-1 overflow-y-auto max-h-[320px] border border-slate-800/80">
                        {simulation.active ? (
                          <>
                            <div className="space-y-1">
                              <p className="text-slate-500">[{new Date(simulation.started_at!).toLocaleTimeString()}] SENTINEL CORE DISPATCHED</p>
                              <p className="text-amber-400">⚡ Chaos Injector: Loaded {simulation.type} fault matrix</p>
                            </div>

                            {simulation.step >= 1 && (
                              <div className="space-y-1 pt-2 border-t border-slate-900">
                                <p className="text-rose-400">🚨 STEP 1: ANOMALY_HEALTH_ALERT</p>
                                <p className="text-slate-300">- Mumbai region health dropped below SLA</p>
                                <p className="text-slate-300">- Raised High alert in audit logs</p>
                              </div>
                            )}

                            {simulation.step >= 2 && (
  <div className="space-y-1 pt-2 border-t border-slate-900">
    <p className="text-amber-400">🔄 STEP 2: STANDBY_HEALTH_VERIFICATION</p>

    {ec2Status?.singapore?.state === "running" ? (
      <>
        <p className="text-green-400">
          ✓ Singapore standby EC2 verified healthy.
        </p>
        <p className="text-slate-300">
          - Promoting Singapore standby cluster to master
        </p>
      </>
    ) : (
      <>
        <p className="text-red-400">
          ✗ Singapore standby EC2 is OFFLINE.
        </p>
        <p className="text-red-400">
          - Automatic failover aborted.
        </p>
      </>
    )}
  </div>
)}

                            {simulation.step >= 3 && (
                              <div className="space-y-1 pt-2 border-t border-slate-900">
                                <p className="text-green-400">✅ STEP 3: RECOVERY_COMPLETED</p>
                                <p className="text-slate-300">- High availability routed successfully</p>
                                <p className="text-slate-300">- Active load: Singapore. Health: 100%</p>
                              </div>
                            )}

                            {/* Live progress loader */}
                            {simulation.step < 3 && (
                              <div className="flex items-center gap-2 text-slate-500 italic animate-pulse pt-2">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Processing ADR recovery routine...
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-slate-600 italic text-center py-20">
                            SYSTEM ACTIVE & IDLE<br/>
                            <span className="text-[10px] text-slate-700">Waiting for chaos triggers...</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 p-3 bg-orange-500/5 border border-orange-500/10 rounded-lg text-[10px] text-slate-400 leading-normal">
                      <strong>Automatic Rollback:</strong> SentinelDR automatically restores environment health states once manual experiments complete.
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* 5. SETTINGS & USER MANAGEMENT VIEW */}
            {activeTab === 'settings' && (
              <div className="space-y-6 animate-fade-in" id="settings-view">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Settings & Credentials</h2>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">Configure system alert endpoints, Slack hooks, and operator system roles.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Operator Management (CRUD) */}
                  <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                    <div>
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-blue-400" />
                        Operator Directory
                      </h3>
                      <p className="text-xs text-slate-400">CRUD settings for credentialed personnel allowed to trigger manual failover switches.</p>
                    </div>

                    {/* Add/Edit User Form */}
                    <form onSubmit={handleUserSubmit} className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-4">
                      <p className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wide">
                        {editingUserId ? 'Edit Operator Credentials' : 'Provision New Operator'}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <input
                          type="text"
                          placeholder="Human Name"
                          value={userForm.name}
                          onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-200 placeholder-slate-600 focus:border-blue-500 outline-none"
                          required
                        />
                        <input
                          type="email"
                          placeholder="user@sentineldr.io"
                          value={userForm.email}
                          onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-200 placeholder-slate-600 focus:border-blue-500 outline-none"
                          required
                        />
                        <select
                          value={userForm.role}
                          onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}
                          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-300 focus:border-blue-500 outline-none"
                        >
                          <option value="Administrator">Administrator</option>
                          <option value="Operator">Operator</option>
                          <option value="Read-Only">Read-Only</option>
                        </select>
                      </div>
                      <div className="flex justify-end gap-2">
                        {editingUserId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUserId(null);
                              setUserForm({ name: '', email: '', role: 'Operator' });
                            }}
                            className="px-3 py-1.5 bg-slate-800 text-slate-400 hover:text-white rounded text-xs font-mono"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="submit"
                          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-mono rounded text-xs font-semibold cursor-pointer transition flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {editingUserId ? 'Update Personnel' : 'Provision User'}
                        </button>
                      </div>
                    </form>

                    {/* Registered Operators List */}
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">Active Operator Sessions ({users.length})</p>
                      
                      <div className="divide-y divide-slate-800/60 bg-slate-950/40 rounded-lg border border-slate-800">
                        {users.map(user => (
                          <div key={user.id} className="p-3.5 flex justify-between items-center text-xs">
                            <div className="space-y-0.5">
                              <p className="font-semibold text-white flex items-center gap-2">
                                {user.name}
                                <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded font-mono uppercase tracking-wider">
                                  {user.role}
                                </span>
                              </p>
                              <p className="text-[11px] text-slate-400 font-mono">{user.email}</p>
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={() => handleEditUser(user)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="p-1.5 bg-slate-800 hover:bg-rose-950/50 text-rose-400 hover:text-rose-300 rounded border border-slate-700 hover:border-rose-900 transition"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>

                  {/* Notification Channels & Preferences */}
                  <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-base font-semibold text-white flex items-center gap-2">
                          <Bell className="w-5 h-5 text-amber-400" />
                          Alert Preferences
                        </h3>
                        <p className="text-xs text-slate-400">Configure continuous health anomaly broadcasting pathways.</p>
                      </div>

                      <div className="space-y-4">
                        
                        <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-white">Slack Webhook Broadcasts</p>
                            <p className="text-[10px] text-slate-500 font-mono">Send JSON payloads to #reliability-ops</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={alertSettings.slack_webhook}
                            onChange={(e) => handleAlertSettingsChange('slack_webhook', e.target.checked)}
                            className="w-4 h-4 rounded text-blue-500 bg-slate-800 border-slate-700 outline-none focus:ring-0 cursor-pointer"
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-white">PagerDuty Callouts</p>
                            <p className="text-[10px] text-slate-500 font-mono">Dial SMS streams for operator escalations</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={alertSettings.pagerduty_sms}
                            onChange={(e) => handleAlertSettingsChange('pagerduty_sms', e.target.checked)}
                            className="w-4 h-4 rounded text-blue-500 bg-slate-800 border-slate-700 outline-none focus:ring-0 cursor-pointer"
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-white">SMTP Email Backplane</p>
                            <p className="text-[10px] text-slate-500 font-mono">Dispatch incident logs to admins</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={alertSettings.email_alerts}
                            onChange={(e) => handleAlertSettingsChange('email_alerts', e.target.checked)}
                            className="w-4 h-4 rounded text-blue-500 bg-slate-800 border-slate-700 outline-none focus:ring-0 cursor-pointer"
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-white">Automatic Chaos Rollback</p>
                            <p className="text-[10px] text-slate-500 font-mono">Roll back simulation states after 5 minutes</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={alertSettings.auto_rollback}
                            onChange={(e) => handleAlertSettingsChange('auto_rollback', e.target.checked)}
                            className="w-4 h-4 rounded text-blue-500 bg-slate-800 border-slate-700 outline-none focus:ring-0 cursor-pointer"
                          />
                        </div>

                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 text-xs text-slate-400 space-y-2 mt-6">
                      <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold">
                        <Lock className="w-3 h-3 text-amber-500" />
                        Credentials Vault
                      </div>
                      <p className="text-[11px] leading-relaxed">System keys and MySQL auth hashes are configured server-side inside secure environment parameters.</p>
                    </div>

                  </div>

                </div>

                {/* MySQL Connection Diagnostics & Local Setup Guide */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mt-6 space-y-4" id="mysql-diagnostics-panel">
                  <div>
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-blue-400" />
                      Local MySQL Integration Diagnostics
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Status details and instructions to connect your PC's MySQL server to this application.</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide font-mono">Current Engine Status</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-500">Active Storage:</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${dbStatus?.mysqlEnabled ? 'bg-blue-500/10 text-blue-400 border border-blue-500/25' : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'}`}>
                            {dbStatus?.mysqlEnabled ? 'REAL MYSQL ENGINE' : 'LOCAL JSON FILE'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-500">Database Server Host:</span>
                          <span className="text-slate-300">{dbStatus?.host || 'none'}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-500">Database Name:</span>
                          <span className="text-slate-300">{dbStatus?.database || 'none'}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-500">Port Mapped:</span>
                          <span className="text-slate-300">{dbStatus?.mysqlEnabled ? '3306' : 'N/A'}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60">
                        {dbStatus?.mysqlEnabled ? (
                          <div className="flex items-start gap-2 bg-blue-500/5 p-3 rounded-md border border-blue-500/10">
                            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <p className="text-[11px] font-bold text-slate-300">MySQL Connection Established!</p>
                              <p className="text-[10px] text-slate-400">The server successfully connected to the database. All CRUD operations (Regions, Users, Incidents, Alerts) are now reading and writing directly to your local MySQL database.</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 bg-amber-500/5 p-3 rounded-md border border-amber-500/10">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <p className="text-[11px] font-bold text-slate-300">Using Local JSON Fallback</p>
                              <p className="text-[10px] text-slate-400">The application couldn't connect to a MySQL database, so it is using the local JSON backup server inside the `/data` directory. All changes are saved to file.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide font-mono">How to Configure Local MySQL (3 Steps)</p>
                      <div className="space-y-2 text-xs text-slate-400">
                        <div className="flex gap-2">
                          <span className="font-mono text-blue-400 font-bold">1.</span>
                          <p>
                            <strong>Create Schema:</strong> Execute the queries inside the <code>db_schema.sql</code> file in your local MySQL instance (using MySQL Workbench, CLI, or phpMyAdmin) to establish tables and seed initial data.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <span className="font-mono text-blue-400 font-bold">2.</span>
                          <p>
                            <strong>Set Environment:</strong> Create or update your <code>.env</code> file on your PC (or configure variables in VS Code environment settings) and provide your real MySQL connection credentials:
                          </p>
                        </div>
                        <pre className="bg-slate-950 p-2.5 rounded border border-slate-800 text-[10px] font-mono text-slate-300 leading-tight select-all">
{`MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_real_mysql_password
MYSQL_DATABASE=sentinel_dr_db`}
                        </pre>
                        <div className="flex gap-2">
                          <span className="font-mono text-blue-400 font-bold">3.</span>
                          <p>
                            <strong>Boot the App:</strong> Run <code>npm run dev</code> in your terminal. The server will boot, find the configurations, connect automatically, and output <i>"[Database] Successfully connected to MySQL pool!"</i>.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </>
        )}

      </main>

      {/* Elegant Dark Footer */}
      <footer className="px-6 py-4 bg-slate-900/50 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-slate-500 font-mono">
        <div>
          {dbStatus?.mysqlEnabled 
            ? `CONNECTED TO MYSQL: ${dbStatus.host.toUpperCase()} (${dbStatus.database.toUpperCase()})` 
            : `RUNNING IN LOCAL STORAGE FALLBACK MODE (JSON DATABASE)`}
        </div>
        <div className="flex gap-4">
          <span>SECURED BACKPLANE: AES-256</span>
          <span className="text-blue-400/60 font-bold">SENTINEL DAEMON V2.4.0-STABLE</span>
        </div>
      </footer>

    </div>
  );
}
