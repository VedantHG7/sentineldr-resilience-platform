-- SentinelDR Database Schema (MySQL Compatible)
-- For production deployment of SentinelDR Automated Disaster Recovery & Resilience Platform

CREATE DATABASE IF NOT EXISTS sentinel_dr_db;
USE sentinel_dr_db;

-- 1. Regions Table
CREATE TABLE IF NOT EXISTS regions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'Active', -- 'Active', 'Standby', 'Degraded', 'Critical'
    last_failover DATETIME DEFAULT NULL
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    role VARCHAR(50) NOT NULL DEFAULT 'Operator', -- 'Administrator', 'Operator', 'Read-Only'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Health Logs Table
CREATE TABLE IF NOT EXISTS health_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    region_id INT NOT NULL,
    cpu_usage FLOAT NOT NULL,
    memory_usage FLOAT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

-- 4. Incidents Table
CREATE TABLE IF NOT EXISTS incidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    region_id INT NOT NULL,
    cause VARCHAR(255) NOT NULL, -- e.g., 'EC2 Instance Termination', 'Database Master Offline'
    recovery_time INT DEFAULT NULL, -- in seconds, NULL means still active
    status VARCHAR(50) NOT NULL DEFAULT 'Investigating', -- 'Investigating', 'Mitigating', 'Resolved'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

-- 5. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    incident_id INT DEFAULT NULL,
    type VARCHAR(50) NOT NULL, -- 'Critical', 'Warning', 'Info'
    message TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL
);

-- Seed Initial Data
INSERT INTO regions (id, name, status, last_failover) VALUES
(1, 'Mumbai (ap-south-1)', 'Active', NULL),
(2, 'Singapore (ap-southeast-1)', 'Standby', NULL)
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO users (id, name, email, role) VALUES
(1, 'Vedant Gajankar', 'vedantgajankar@gmail.com', 'Administrator'),
(2, 'Operations Lead', 'ops-lead@sentineldr.io', 'Operator'),
(3, 'Security Auditor', 'auditor@sentineldr.io', 'Read-Only')
ON DUPLICATE KEY UPDATE email=email;

INSERT INTO incidents (id, region_id, cause, recovery_time, status, created_at) VALUES
(1, 1, 'EC2 Auto Scaling Failure - Peak Traffic Load', 180, 'Resolved', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(2, 2, 'Primary Database Replication Timeout', 45, 'Resolved', DATE_SUB(NOW(), INTERVAL 1 DAY))
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO alerts (id, incident_id, type, message, sent_at) VALUES
(1, 1, 'Critical', 'Region ap-south-1 reported EC2 termination spikes. Initiating backup instances.', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(2, 2, 'Warning', 'Region ap-southeast-1 DB lagging by >10s. Forcing synchrony rebuild.', DATE_SUB(NOW(), INTERVAL 1 DAY))
ON DUPLICATE KEY UPDATE id=id;
