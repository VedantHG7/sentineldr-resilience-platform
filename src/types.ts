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
  recovery_time: number | null;
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

export interface CurrentHealthMetric {
  region_id: number;
  name: string;
  status: 'Active' | 'Standby' | 'Degraded' | 'Critical';
  cpu: number;
  memory: number;
  timestamp: string;
}

export interface TelemetryData {
  current: CurrentHealthMetric[];
  history: HealthLog[];
  lastRefresh: string;
}

export interface SimulationState {
  active: boolean;
  type: 'EC2' | 'Database' | 'High_CPU' | 'Network' | null;
  target_region_id: number | null;
  started_at: string | null;
  step: number;
}
