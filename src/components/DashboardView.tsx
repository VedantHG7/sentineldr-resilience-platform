import React, { useState } from 'react';
import { 
  Server, Activity, Clock, ShieldAlert, AlertTriangle, 
  TrendingUp, Globe, CheckCircle2, RefreshCw, ArrowLeftRight,
  Zap, Play, Flame, CornerDownRight, AlertOctagon, ShieldCheck,
  ChevronRight, ArrowRight, Terminal, Cpu, Database, Network
} from 'lucide-react';
import { CurrentHealthMetric, TelemetryData, Incident, Alert, SimulationState } from '../types';

interface DashboardViewProps {
  telemetry: TelemetryData | null;
  incidents: Incident[];
  alerts: Alert[];
  onRefresh: () => void;
  isLoading: boolean;
  onNavigate: (tab: string) => void;
  onManualFailover: () => void;
  // Dynamic Chaos simulation controls passed from App.tsx
  simulation: SimulationState;
  onTriggerSimulation?: (type: 'EC2' | 'Database' | 'High_CPU' | 'Network') => Promise<void>;
  onResetSimulation?: () => Promise<void>;
  isSimulatingTransition?: boolean;
}

export default function DashboardView({ 
  telemetry, 
  incidents, 
  alerts, 
  onRefresh, 
  isLoading, 
  onNavigate,
  onManualFailover,
  simulation,
  onTriggerSimulation,
  onResetSimulation,
  isSimulatingTransition = false
}: DashboardViewProps) {
  // Metric display selector for sparklines
  const [selectedMetric, setSelectedMetric] = useState<'cpu' | 'memory'>('cpu');

  // Aggregate stats
  const activeRegion = telemetry?.current.find(r => r.status === 'Active');
  const standbyRegion = telemetry?.current.find(r => r.status === 'Standby');
  const degradedRegions = telemetry?.current.filter(r => r.status === 'Degraded' || r.status === 'Critical') || [];
  
  const totalIncidents = incidents.length;
  const unresolvedIncidents = incidents.filter(i => i.status !== 'Resolved').length;

  // Find last failover time from incidents
  const lastFailoverIncident = incidents.find(i => i.cause.includes('Failover') || i.cause.includes('Disaster') || i.cause.includes('Simulation'));
  const lastFailoverStr = lastFailoverIncident 
    ? new Date(lastFailoverIncident.created_at).toLocaleTimeString() + ' UTC'
    : 'None (Stable)';

  // Compute average CPU/Memory from currently active metrics
  const avgCpu = telemetry?.current.reduce((acc, c) => acc + c.cpu, 0) || 0;
  const avgMem = telemetry?.current.reduce((acc, c) => acc + c.memory, 0) || 0;
  const currentAvgCpu = telemetry?.current.length ? Math.round(avgCpu / telemetry.current.length) : 0;
  const currentAvgMem = telemetry?.current.length ? Math.round(avgMem / telemetry.current.length) : 0;

  // Determine global health rating
  let globalHealthStatus = 'Optimal';
  let globalHealthColor = 'from-emerald-500/10 to-emerald-500/0 border-emerald-500/20 text-emerald-400';
  let globalHealthText = 'All edge routers and microservice clusters reporting optimal status. Replication lag is minimal (0.18s).';

  if (degradedRegions.length > 0) {
    const isCritical = degradedRegions.some(r => r.status === 'Critical');
    globalHealthStatus = isCritical ? 'Failover In Progress' : 'Degraded Performance';
    globalHealthColor = isCritical 
      ? 'from-rose-500/20 to-rose-500/5 border-rose-500/30 text-rose-400 animate-pulse' 
      : 'from-amber-500/15 to-amber-500/5 border-amber-500/20 text-amber-400';
    globalHealthText = isCritical 
      ? 'CRITICAL EXPT DETECTED: Automated failover sequence shunting DNS records away from ap-south-1.' 
      : 'Resource usage threshold exceeded. Scaling primary Kubernetes pods and warm standby buffers.';
  }

  // Generate beautiful custom responsive SVG line graphs with highlight point
  const renderSparkline = (regionId: number, metricType: 'cpu' | 'memory') => {
    if (!telemetry || !telemetry.history || telemetry.history.length === 0) {
      return (
        <div className="h-16 flex items-center justify-center text-[10px] text-slate-600 font-mono animate-pulse">
          Retrieving real-time telemetry packets...
        </div>
      );
    }

    const logs = telemetry.history.filter(l => l.region_id === regionId).slice(-15);
    if (logs.length < 2) {
      return (
        <div className="h-16 flex items-center justify-center text-[10px] text-slate-600 font-mono animate-pulse">
          Buffering telemetry stream...
        </div>
      );
    }

    const values = logs.map(l => metricType === 'cpu' ? l.cpu_usage : l.memory_usage);
    const maxVal = 100;
    const width = 360;
    const height = 64;

    const points = values.map((val, idx) => {
      const x = (idx / (values.length - 1)) * width;
      const y = height - (val / maxVal) * height;
      return `${x},${y}`;
    }).join(' ');

    const strokeColor = regionId === 1 ? '#3b82f6' : '#10b981'; // Blue for Mumbai, Green for Singapore
    const latestVal = values[values.length - 1];
    const peakVal = Math.max(...values);
    const peakIdx = values.indexOf(peakVal);
    const peakX = (peakIdx / (values.length - 1)) * width;
    const peakY = height - (peakVal / maxVal) * height;

    return (
      <div className="relative">
        <svg className="w-full h-16 overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`grad-${regionId}-${metricType}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Shaded Area */}
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill={`url(#grad-${regionId}-${metricType})`}
          />
          {/* Grid lines */}
          <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="#334155" strokeWidth="0.5" strokeDasharray="2,2" />
          <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="#334155" strokeWidth="0.5" strokeDasharray="2,2" />
          <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="#334155" strokeWidth="0.5" strokeDasharray="2,2" />
          
          {/* Trendline */}
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            points={points}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Highlight Points */}
          <circle cx={width} cy={height - (latestVal / maxVal) * height} r="4" fill={strokeColor} className="animate-ping" />
          <circle cx={width} cy={height - (latestVal / maxVal) * height} r="3.5" fill={strokeColor} stroke="#ffffff" strokeWidth="1" />
          
          {/* Peak point indicator */}
          <circle cx={peakX} cy={peakY} r="2.5" fill="#f59e0b" />
        </svg>

        {/* Dynamic graph overlay labels */}
        <div className="absolute top-1 left-2 flex gap-3 text-[9px] font-mono text-slate-500">
          <span>PEAK: <strong className="text-amber-500">{peakVal}%</strong></span>
          <span>AVG: <strong className="text-slate-300">{Math.round(values.reduce((a,b)=>a+b,0)/values.length)}%</strong></span>
        </div>
      </div>
    );
  };

  // Radial Progress Ring values
  const systemHealthPercentage = degradedRegions.length > 0 ? (degradedRegions.some(r => r.status === 'Critical') ? 33 : 75) : 100;
  const radius = 24;
  const strokeWidth = 3.5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (systemHealthPercentage / 100) * circumference;

  return (
    <div className="space-y-6 animate-fade-in" id="dashboard-view-panel">
      
      {/* Dynamic Embedded CSS Stylesheet for High-Fidelity SVG Line Animations */}
      <style>{`
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -40;
          }
        }
        @keyframes pulse-signal {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); filter: drop-shadow(0 0 10px rgba(59, 130, 246, 0.5)); }
        }
        @keyframes pulse-signal-alert {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.15); filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.7)); }
        }
        .anim-dash-flow-active {
          stroke-dasharray: 6, 4;
          animation: dash-flow 1.5s linear infinite;
        }
        .anim-dash-flow-fast {
          stroke-dasharray: 5, 3;
          animation: dash-flow 0.8s linear infinite;
        }
      `}</style>

      {/* 1. TOP HEADER: Status with live operational badges */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/30 p-4 rounded-xl border border-slate-800/65 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]"></span>
            <h2 className="text-xl font-bold tracking-tight text-white font-sans">Reliability Operations Command Center</h2>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">Continuous telemetry ingestion, active route status, and real-time AWS chaos triggers.</p>
        </div>
        
        <div className="flex items-center gap-3 self-stretch md:self-auto justify-between">
          <div className="text-left font-mono pr-3 border-r border-slate-800">
            <p className="text-[10px] text-slate-500">DNS ROUTER STATE</p>
            <p className="text-xs font-semibold text-white uppercase tracking-wider">
              {simulation.active ? 'Rerouting (Route53)' : 'Anycast Routing'}
            </p>
          </div>
          
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-medium rounded-lg border border-slate-700 bg-slate-800/90 hover:bg-slate-700 hover:text-white text-slate-300 transition-all duration-150 active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm shadow-black"
            id="force-telemetry-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            Sync Metrics
          </button>
        </div>
      </div>

      {/* 2. LIVE ROUTE TOPOLOGY MAP: High-Fidelity SVG Diagram showing physical Traffic Routing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Dynamic Interactive Flow Schematic Card */}
        <div className="lg:col-span-8 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 border border-slate-800/95 rounded-2xl p-6 flex flex-col justify-between relative shadow-2xl overflow-hidden" id="dashboard-dynamic-router-card">
          
          {/* Glass background mesh */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.06),transparent_40%)]"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(16,185,129,0.05),transparent_40%)]"></div>

          {/* Map Header */}
          <div className="flex justify-between items-start z-10 mb-6">
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest bg-slate-900 px-2 py-0.5 rounded border border-slate-800/80">
                ACTIVE INGRESS FLUX
              </span>
              <h3 className="text-base font-bold text-white flex items-center gap-2 mt-1.5">
                <Network className="w-4.5 h-4.5 text-blue-400" />
                Real-Time DNS Traffic Routing Blueprint
              </h3>
            </div>
            
            <div className="text-right">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border uppercase tracking-wider ${
                simulation.active 
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.15)]' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                {simulation.active ? `FAILOVER STAGE: ${simulation.step}/3` : 'DNS STEADY STATE'}
              </span>
            </div>
          </div>

          {/* Interactive Flow Schematic Canvas */}
          <div className="relative h-64 border border-slate-800/40 bg-slate-950/40 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between z-10 mb-4 gap-6">
            
            {/* INPUT NODE: Client Traffic Ingress */}
            <div className="flex flex-col items-center justify-center text-center w-28 shrink-0 relative">
              <div className="w-11 h-11 bg-slate-900 rounded-full border border-slate-700/80 flex items-center justify-center shadow-lg relative">
                <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-ping opacity-60"></div>
                <Globe className="w-5 h-5 text-slate-300" />
              </div>
              <div className="mt-2.5">
                <h4 className="text-xs font-semibold text-white">Client Requests</h4>
                <p className="text-[9px] text-slate-500 font-mono mt-0.5">Anycast DNS Gateway</p>
              </div>
            </div>

            {/* ROUTE 53 LOGICAL SWITCH NODE (CENTER) */}
            <div className="flex flex-col items-center justify-center text-center relative z-20">
              {/* Pulsing signal background indicator */}
              <div className="absolute w-24 h-24 rounded-full border border-dashed border-slate-800/60 flex items-center justify-center -translate-y-4">
                <div className={`w-16 h-16 rounded-full border border-dashed ${simulation.active ? 'border-rose-500/30 animate-pulse' : 'border-blue-500/20'} absolute`}></div>
              </div>
              
              <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center relative shadow-2xl transition-all duration-500 -translate-y-4 ${
                simulation.active 
                  ? 'bg-rose-950/20 border-rose-500/40 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                  : 'bg-blue-950/10 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.25)]'
              }`}>
                <ArrowLeftRight className={`w-6 h-6 ${simulation.active ? 'text-rose-400 animate-spin' : 'text-blue-400'}`} />
                <span className="absolute -bottom-1 bg-slate-900 px-1.5 py-0.2 rounded text-[8px] font-mono border border-slate-800 text-slate-400">
                  ROUTE 53
                </span>
              </div>
              
              <div className="-translate-y-1">
                <p className="text-[10px] font-mono font-bold text-slate-300 uppercase">
                  {simulation.active ? 'FAILOVER TRIPPED' : 'RESOLVING PRIMARY'}
                </p>
                <p className="text-[9px] text-slate-500 font-mono mt-0.5">SLA response: 12ms</p>
              </div>
            </div>

            {/* FAILOVER TARGET REGIONS BLOCK (RIGHT SIDE) */}
            <div className="flex flex-col gap-6 justify-center w-40 shrink-0 relative">
              
              {/* PRIMARY GATEWAY (MUMBAI) */}
              <div className={`p-2.5 rounded-lg border transition-all duration-300 flex items-center gap-2.5 relative ${
                telemetry?.current.find(r => r.region_id === 1)?.status === 'Critical'
                  ? 'bg-rose-950/10 border-rose-500/30 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
                  : telemetry?.current.find(r => r.region_id === 1)?.status === 'Active'
                  ? 'bg-blue-950/10 border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                  : 'bg-slate-900/40 border-slate-800'
              }`}>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 border ${
                  telemetry?.current.find(r => r.region_id === 1)?.status === 'Critical'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 animate-bounce'
                    : telemetry?.current.find(r => r.region_id === 1)?.status === 'Active'
                    ? 'bg-blue-500/10 border-blue-500/25 text-blue-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  <Server className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h5 className="text-[11px] font-bold text-white truncate">ap-south-1</h5>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      telemetry?.current.find(r => r.region_id === 1)?.status === 'Critical'
                        ? 'bg-rose-500 animate-ping'
                        : telemetry?.current.find(r => r.region_id === 1)?.status === 'Active'
                        ? 'bg-blue-500'
                        : 'bg-slate-600'
                    }`}></span>
                  </div>
                  <p className="text-[9px] text-slate-500 truncate">Mumbai (Primary)</p>
                </div>
                {telemetry?.current.find(r => r.region_id === 1)?.status === 'Active' && (
                  <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full border-2 border-slate-950"></div>
                )}
              </div>

              {/* FAILOVER SECONDARY (SINGAPORE) */}
              <div className={`p-2.5 rounded-lg border transition-all duration-300 flex items-center gap-2.5 relative ${
                telemetry?.current.find(r => r.region_id === 2)?.status === 'Active'
                  ? 'bg-emerald-950/10 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                  : 'bg-slate-900/40 border-slate-800'
              }`}>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 border ${
                  telemetry?.current.find(r => r.region_id === 2)?.status === 'Active'
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  <Server className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h5 className="text-[11px] font-bold text-white truncate">ap-southeast-1</h5>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      telemetry?.current.find(r => r.region_id === 2)?.status === 'Active'
                        ? 'bg-emerald-500'
                        : 'bg-slate-600'
                    }`}></span>
                  </div>
                  <p className="text-[9px] text-slate-500 truncate">Singapore (Standby)</p>
                </div>
                {telemetry?.current.find(r => r.region_id === 2)?.status === 'Active' && (
                  <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950"></div>
                )}
              </div>

            </div>

            {/* SVG FLOW ARCHES (Absolutely layered) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none hidden md:block" style={{ zIndex: 5 }}>
              <defs>
                <linearGradient id="blueGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.9" />
                </linearGradient>
                <linearGradient id="emeraldGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              
              {/* Traffic Ingress to Route53 Swtich */}
              <path 
                d="M 112,128 L 240,112" 
                fill="none" 
                stroke="#475569" 
                strokeWidth="1.5" 
                strokeDasharray="4,4" 
              />
              <path 
                d="M 112,128 L 240,112" 
                fill="none" 
                stroke="#3b82f6" 
                strokeWidth="2" 
                className="anim-dash-flow-active"
              />

              {/* Route53 to ap-south-1 (Mumbai) */}
              <path 
                d="M 296,112 Q 350,90 410,95" 
                fill="none" 
                stroke={telemetry?.current.find(r => r.region_id === 1)?.status === 'Critical' ? '#ef4444' : '#475569'} 
                strokeWidth="1.5" 
                strokeDasharray={telemetry?.current.find(r => r.region_id === 1)?.status === 'Critical' ? '0' : '4,4'}
              />
              {telemetry?.current.find(r => r.region_id === 1)?.status === 'Active' && (
                <path 
                  d="M 296,112 Q 350,90 410,95" 
                  fill="none" 
                  stroke="url(#blueGlow)" 
                  strokeWidth="2.5" 
                  className="anim-dash-flow-active"
                />
              )}

              {/* Route53 to ap-southeast-1 (Singapore) */}
              <path 
                d="M 296,112 Q 350,140 410,165" 
                fill="none" 
                stroke="#475569" 
                strokeWidth="1.5" 
                strokeDasharray="4,4" 
              />
              {telemetry?.current.find(r => r.region_id === 2)?.status === 'Active' && (
                <path 
                  d="M 296,112 Q 350,140 410,165" 
                  fill="none" 
                  stroke="url(#emeraldGlow)" 
                  strokeWidth="2.5" 
                  className={simulation.active ? 'anim-dash-flow-fast' : 'anim-dash-flow-active'}
                />
              )}
            </svg>

          </div>

          {/* Map Footer status feed */}
          <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 font-mono">
              <Clock className="w-4.5 h-4.5 text-slate-500" />
              <span className="text-slate-500">DNS LOGICAL STATE:</span>
              <span className="text-slate-300 font-bold">
                {simulation.active 
                  ? `AUTOMATIC FAILOVER TO ap-southeast-1 ACTIVE` 
                  : `ROUTING 100% TRAFFIC TO MUMBAI`
                }
              </span>
            </div>
            
            <button
              onClick={() => onNavigate('regions')}
              className="px-3 py-1 bg-slate-900 border border-slate-700/80 hover:bg-slate-800 hover:text-white rounded text-[11px] font-mono font-medium text-slate-300 flex items-center gap-1 transition self-start md:self-auto cursor-pointer"
            >
              Verify VPC Peerings <ArrowRight className="w-3 h-3" />
            </button>
          </div>

        </div>

        {/* CHAOS VECTOR DIRECT CONTROL SIDE PANEL */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl" id="dashboard-chaos-mini-deck">
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-800/80">
              <div className="w-7 h-7 bg-orange-500/10 rounded flex items-center justify-center border border-orange-500/20 text-orange-400">
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Disaster Injector Board</h3>
                <p className="text-[10px] text-slate-500 font-mono">Simulate real-world cloud failures</p>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Inject failure variables into the Mumbai Primary endpoint. SentinelDR's daemon will audit the fault metrics and execute Route53 failover immediately.
            </p>

            {/* Quick-action disaster buttons */}
            <div className="space-y-2">
              {[
                { type: 'EC2', label: 'Hypervisor Node Drop', icon: Server, desc: 'Simulate full EC2 hypervisor failure' },
                { type: 'Database', label: 'DB Master Log Corruption', icon: Database, desc: 'Induce relational replica sync faults' },
                { type: 'High_CPU', label: '100% Core Load Spike', icon: Cpu, desc: 'Simulate intensive high-volume traffic' },
                { type: 'Network', label: 'Route53 BGP Partition', icon: Network, desc: 'Sever inter-region connectivity' }
              ].map((vector) => {
                const isSelected = simulation.type === vector.type;
                const Icon = vector.icon;
                
                return (
                  <button
                    key={vector.type}
                    disabled={simulation.active || isSimulatingTransition}
                    onClick={() => onTriggerSimulation && onTriggerSimulation(vector.type as any)}
                    className={`w-full p-2.5 rounded-lg border text-left flex items-start gap-2.5 transition duration-150 ${
                      simulation.active
                        ? 'bg-slate-950/20 border-slate-900 text-slate-600 cursor-not-allowed opacity-50'
                        : 'bg-slate-950 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700 text-slate-300 hover:text-white cursor-pointer active:scale-98'
                    }`}
                  >
                    <div className="mt-0.5 p-1 rounded bg-slate-900 border border-slate-800 text-orange-400">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold truncate">{vector.label}</span>
                        <Play className="w-2.5 h-2.5 text-orange-500/70" />
                      </div>
                      <p className="text-[9px] text-slate-500 font-mono mt-0.5">{vector.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset Switch & Step Summary */}
          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-3 bg-slate-950 p-3 rounded-xl border border-slate-800/60">
            {simulation.active ? (
              <div className="space-y-3">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-orange-400 font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-ping"></span>
                    ACTIVE FAULT: {simulation.type}
                  </span>
                  <span className="text-slate-400">Step {simulation.step}/3</span>
                </div>
                
                <button
                  onClick={() => onResetSimulation && onResetSimulation()}
                  disabled={isSimulatingTransition}
                  className="w-full py-2 bg-rose-600/90 hover:bg-rose-500 text-white font-mono rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-rose-950/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Flush Chaos Logs
                </button>
              </div>
            ) : (
              <div className="text-center py-2">
                <span className="text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/10">
                  SYSTEM GREEN • EXPERIMENTS IDLE
                </span>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* 3. RADIAL DIALS & HIGH-LEVEL TELEMETRY STATS: Bento-grid widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" id="metrics-summary-row">
        
        {/* WIDGET 1: Radial Integrity dial */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between hover:border-slate-700/80 transition-all duration-200 shadow-lg" id="card-integrity-dial">
          <div className="space-y-1.5">
            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest font-mono">System Integrity</span>
            <h3 className="text-2xl font-light text-white font-mono">
              {systemHealthPercentage}%
            </h3>
            <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
              {systemHealthPercentage === 100 ? 'Continuous healthy status' : 'Failover mitigation active'}
            </p>
          </div>
          
          {/* Circular SVG gauge */}
          <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="32"
                cy="32"
                r={radius}
                className="stroke-slate-800 fill-none"
                strokeWidth={strokeWidth}
              />
              <circle
                cx="32"
                cy="32"
                r={radius}
                className={`fill-none transition-all duration-500 ${
                  systemHealthPercentage === 100 
                    ? 'stroke-emerald-500' 
                    : systemHealthPercentage > 50 
                    ? 'stroke-amber-500' 
                    : 'stroke-rose-500 animate-pulse'
                }`}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute font-mono text-[9px] font-bold text-slate-300">
              {systemHealthPercentage === 100 ? 'OK' : 'FAIL'}
            </div>
          </div>
        </div>

        {/* WIDGET 2: Multi-Region Data Replication Sync Latency */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between h-32 hover:border-slate-700/80 transition-all duration-200 shadow-lg" id="card-replication-sync">
          <div className="flex justify-between items-start">
            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest font-mono">Replication Lag</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-light text-white font-mono">
              0.18s
            </h3>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/10">
              IN SYNC
            </span>
          </div>
          <p className="text-[10px] text-slate-400 font-sans">MySQL Dual Master binlog state replica latency</p>
        </div>

        {/* WIDGET 3: Dynamic Cluster CPU load status */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between h-32 hover:border-slate-700/80 transition-all duration-200 shadow-lg" id="card-dynamic-cpu-gauge">
          <div className="flex justify-between items-start">
            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest font-mono">Mean Load Allocation</span>
            <Cpu className="w-4 h-4 text-blue-400" />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <h3 className="text-2xl font-light text-white font-mono">
                {currentAvgCpu}%
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">Mem: {currentAvgMem}%</span>
            </div>
            
            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/50">
              <div 
                className={`h-full transition-all duration-500 ${
                  currentAvgCpu > 80 
                    ? 'bg-rose-500 animate-pulse' 
                    : currentAvgCpu > 60 
                    ? 'bg-amber-500' 
                    : 'bg-blue-500'
                }`}
                style={{ width: `${currentAvgCpu}%` }}
              ></div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 font-sans">Combined hypervisor pool capacity indexes</p>
        </div>

        {/* WIDGET 4: SLA Commitment Tracker */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between h-32 hover:border-slate-700/80 transition-all duration-200 shadow-lg" id="card-sla-commitment">
          <div className="flex justify-between items-start">
            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest font-mono">SLA Guarantee</span>
            <ShieldCheck className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-light text-white font-mono">
              99.98%
            </h3>
            <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-1 py-0.2 rounded border border-blue-500/10">
              OPTIMAL
            </span>
          </div>
          <p className="text-[10px] text-slate-400 font-sans">Multi-Region disaster recovery commitment threshold</p>
        </div>

      </div>

      {/* 4. REAL-TIME AUDITED TELEMETRY: Continuous streaming sparkline panels */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl" id="telemetry-timelines-row">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-800/80">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-4.5 h-4.5 text-blue-400" />
              Continuous Microservice Node Telemetry
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">Real-time CPU and memory residency index streamed directly from EC2 hypervisors.</p>
          </div>
          
          {/* Switch metrics filter tabs */}
          <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {[
              { id: 'cpu', label: 'CPU Usage Pools' },
              { id: 'memory', label: 'Memory residency' }
            ].map((metric) => (
              <button
                key={metric.id}
                onClick={() => setSelectedMetric(metric.id as any)}
                className={`px-3 py-1 text-[11px] font-mono font-bold rounded transition cursor-pointer ${
                  selectedMetric === metric.id 
                    ? 'bg-blue-600 text-white shadow' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {metric.label}
              </button>
            ))}
          </div>
        </div>

        {/* Real-time sparkline streams grids */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {telemetry?.current.map(region => {
            const isMumbai = region.region_id === 1;
            const strokeColor = isMumbai ? 'text-blue-400' : 'text-emerald-400';
            const progressBg = isMumbai ? 'bg-blue-500' : 'bg-emerald-500';
            const regionStatus = region.status;
            
            let badgeStyle = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15';
            if (regionStatus === 'Critical') {
              badgeStyle = 'bg-rose-500/10 text-rose-400 border border-rose-500/15 animate-pulse';
            } else if (regionStatus === 'Degraded') {
              badgeStyle = 'bg-amber-500/10 text-amber-400 border border-amber-500/15';
            } else if (regionStatus === 'Standby') {
              badgeStyle = 'bg-slate-800 text-slate-400 border border-slate-700';
            }

            return (
              <div key={region.region_id} className="p-4.5 rounded-xl border border-slate-800/90 bg-slate-950/20 space-y-4 hover:border-slate-700/60 transition duration-150">
                
                {/* Microservice Header */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-white uppercase bg-slate-900 px-2 py-0.5 rounded border border-slate-800/80">
                      {isMumbai ? 'ap-south-1' : 'ap-southeast-1'}
                    </span>
                    <span className="text-xs text-slate-400 font-sans">({region.name.split(' ')[0]})</span>
                  </div>
                  
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${badgeStyle}`}>
                    {regionStatus}
                  </span>
                </div>

                {/* Main Graph Stream area */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>Real-time {selectedMetric.toUpperCase()} allocation log</span>
                      <span className="animate-pulse">● Ingesting</span>
                    </div>
                    <div className="bg-slate-950/90 border border-slate-800/80 p-3 rounded-lg shadow-inner">
                      {renderSparkline(region.region_id, selectedMetric)}
                    </div>
                  </div>
                </div>

                {/* Sub regional diagnostic stats */}
                <div className="grid grid-cols-2 gap-4 pt-2 text-[11px] font-mono text-slate-500 border-t border-slate-900">
                  <div>
                    <span className="block text-[9px] text-slate-600 font-bold uppercase tracking-wider">Gateway Port Endpoint</span>
                    <span className="text-slate-300 mt-0.5 block truncate">
                      {isMumbai ? 'gw-mumbai-01.aws' : 'gw-singapore-01.aws'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-slate-600 font-bold uppercase tracking-wider">VPC Link Health</span>
                    <span className="text-emerald-400 mt-0.5 block">100% ONLINE</span>
                  </div>
                </div>

              </div>
            );
          })}
        </div>

      </div>

      {/* 5. INCIDENT TABLE & LOG AUDIT STREAMS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="dashboard-details-grid">
        
        {/* Recent Resilience Incidents Logs */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-6 shadow-xl" id="incident-logs-chart-panel">
          <div>
            <div className="flex items-center justify-between mb-4.5 pb-2 border-b border-slate-800/60">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Audit Logs: Active Mitigation History
              </h3>
              <button 
                onClick={() => onNavigate('incidents')} 
                className="text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-0.5 font-mono cursor-pointer"
              >
                Access Incident Center <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-800 font-mono">
                    <th className="pb-3 font-bold">DR Incident ID</th>
                    <th className="pb-3 font-bold">Time (UTC)</th>
                    <th className="pb-3 font-bold">Impact Region</th>
                    <th className="pb-3 font-bold">Failure Cause</th>
                    <th className="pb-3 font-bold text-right">RTO Period</th>
                    <th className="pb-3 font-bold text-right">Mitigation</th>
                  </tr>
                </thead>
                <tbody className="text-[11px] divide-y divide-slate-800/40">
                  {incidents.slice(0, 4).map((incident) => {
                    const isResolved = incident.status === 'Resolved';
                    return (
                      <tr key={incident.id} className="hover:bg-slate-800/25 transition-colors duration-100">
                        <td className="py-3.5 font-mono text-slate-400">#DR-{1000 + incident.id}</td>
                        <td className="py-3.5 text-slate-300 font-mono">
                          {new Date(incident.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="py-3.5 text-slate-300 font-mono">
                          {incident.region_id === 1 ? 'Mumbai (ap-south-1)' : 'Singapore (ap-southeast-1)'}
                        </td>
                        <td className="py-3.5 text-white font-medium truncate max-w-[160px]" title={incident.cause}>
                          {incident.cause}
                        </td>
                        <td className="py-3.5 text-right font-mono text-slate-300">
                          {incident.recovery_time ? `${incident.recovery_time}s` : 'Active'}
                        </td>
                        <td className="py-3.5 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider ${
                            isResolved 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15' 
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse'
                          }`}>
                            {incident.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {incidents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-500 font-mono italic">
                        No failover history logs registered in memory block.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>RPO TARGET BUFFER: <strong className="text-slate-300">0.5s</strong></span>
            <span>RTO TIME LIMIT SLA: <strong className="text-slate-300">30.0s</strong></span>
          </div>

        </div>

        {/* Real-time Event Alerts Audit Stream */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl" id="realtime-logs-audit-panel">
          <div>
            <div className="flex justify-between items-center mb-4.5 pb-2 border-b border-slate-800/60">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span>
                Event Alerts Stream
              </h3>
              <span className="text-[10px] text-slate-500 font-mono font-semibold uppercase tracking-wider bg-slate-950 px-1.5 py-0.2 rounded border border-slate-800">
                Audited
              </span>
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1" id="alerts-scroller-dashboard">
              {alerts.slice(0, 6).map((alert) => {
                const isCritical = alert.type === 'Critical';
                const isWarning = alert.type === 'Warning';
                
                let borderTheme = 'border-l-blue-500 bg-blue-500/5 hover:bg-blue-500/10';
                let tagTheme = 'text-blue-400 bg-blue-500/10';
                
                if (isCritical) {
                  borderTheme = 'border-l-rose-500 bg-rose-500/5 hover:bg-rose-500/10';
                  tagTheme = 'text-rose-400 bg-rose-500/10';
                } else if (isWarning) {
                  borderTheme = 'border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/10';
                  tagTheme = 'text-amber-400 bg-amber-500/10';
                }

                return (
                  <div 
                    key={alert.id} 
                    className={`p-3 rounded-lg border border-slate-800 border-l-4 ${borderTheme} text-[11px] space-y-1 transition duration-150`}
                  >
                    <div className="flex justify-between items-center">
                      <span className={`text-[8px] uppercase font-bold px-1.5 py-0.2 rounded font-mono ${tagTheme}`}>
                        {alert.type}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {new Date(alert.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-300 font-sans leading-relaxed">
                      {alert.message}
                    </p>
                  </div>
                );
              })}
              {alerts.length === 0 && (
                <div className="text-center py-12 text-slate-500 text-xs font-mono italic">
                  No automated logs registered in the alert queue.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800/80">
            <button
              onClick={() => onNavigate('simulation')}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-mono font-medium border border-slate-700 hover:border-slate-600 transition duration-150 cursor-pointer text-center"
            >
              Configure SLA thresholds
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
