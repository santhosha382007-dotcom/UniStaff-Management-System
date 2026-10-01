import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

// Ensure data directory exists
const dataDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new DatabaseSync(config.DB_PATH);

// Initialize Tables
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      employee_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('EMPLOYEE', 'HR_ADMIN')),
      department TEXT,
      designation TEXT,
      phone TEXT,
      base_salary REAL DEFAULT 0,
      hra REAL DEFAULT 0,
      allowances REAL DEFAULT 0,
      pf_deduction REAL DEFAULT 0,
      tax_deduction REAL DEFAULT 0,
      joining_date TEXT,
      status TEXT DEFAULT 'ACTIVE',
      must_change_password INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS office_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters REAL NOT NULL DEFAULT 150,
      address TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      check_in_time TEXT,
      check_out_time TEXT,
      check_in_lat REAL,
      check_in_lng REAL,
      check_in_photo TEXT,
      check_out_lat REAL,
      check_out_lng REAL,
      status TEXT DEFAULT 'PRESENT',
      working_hours REAL DEFAULT 0,
      overtime_hours REAL DEFAULT 0,
      verification_method TEXT DEFAULT 'GPS_BIOMETRIC',
      distance_meters REAL DEFAULT 0,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS leaves (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      total_days REAL NOT NULL DEFAULT 1,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      approved_by TEXT,
      action_at TEXT,
      comments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payroll (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      month_year TEXT NOT NULL,
      total_working_days INTEGER NOT NULL,
      present_days REAL NOT NULL,
      paid_leave_days REAL NOT NULL,
      unpaid_leave_days REAL NOT NULL,
      overtime_hours REAL NOT NULL,
      base_salary REAL NOT NULL,
      hra REAL NOT NULL,
      allowances REAL NOT NULL,
      overtime_pay REAL NOT NULL,
      gross_salary REAL NOT NULL,
      lop_deduction REAL NOT NULL,
      pf_deduction REAL NOT NULL,
      tax_deduction REAL NOT NULL,
      net_salary REAL NOT NULL,
      status TEXT DEFAULT 'PROCESSED',
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, month_year)
    );

    CREATE TABLE IF NOT EXISTS login_security_logs (
      log_id TEXT PRIMARY KEY,
      employee_id TEXT,
      employee_code TEXT,
      user_type TEXT NOT NULL,
      login_status TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      device_id TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      failure_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS hr_impersonation_logs (
      log_id TEXT PRIMARY KEY,
      hr_id TEXT NOT NULL,
      hr_name TEXT,
      employee_id TEXT NOT NULL,
      employee_code TEXT,
      employee_name TEXT,
      action TEXT DEFAULT 'HR_IMPERSONATION',
      reason TEXT,
      ip_address TEXT,
      device_info TEXT,
      session_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      duration TEXT,
      ended_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS live_tracking (
      user_id TEXT PRIMARY KEY,
      employee_code TEXT,
      employee_name TEXT,
      department TEXT,
      role TEXT,
      latitude REAL,
      longitude REAL,
      accuracy REAL,
      address TEXT,
      camera_frame TEXT,
      camera_timestamp DATETIME,
      camera_status TEXT DEFAULT 'INACTIVE',
      is_checked_in INTEGER DEFAULT 0,
      check_in_time TEXT,
      attendance_id TEXT,
      battery_level INTEGER,
      is_charging INTEGER,
      last_location_time DATETIME,
      last_ping_time DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS live_tracking_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      employee_code TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migration columns for employee device & mobile verification
  try { db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN device_registered INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN device_public_key TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN device_id TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN device_registered_at DATETIME'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN account_status TEXT DEFAULT "ACTIVE"'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN hr_verification_code TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN hr_verification_expiry DATETIME'); } catch (e) {}

  seedInitialData();
}

/**
 * Record a login / security audit event
 */
export function recordLoginSecurityLog({
  employee_id = null,
  employee_code = null,
  user_type = 'EMPLOYEE',
  login_status = 'SUCCESS',
  verification_status = 'VERIFIED_SUCCESS',
  device_id = null,
  ip_address = null,
  failure_reason = null
}) {
  try {
    const logId = 'sec-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const stmt = db.prepare(`
      INSERT INTO login_security_logs (
        log_id, employee_id, employee_code, user_type, login_status,
        verification_status, device_id, ip_address, failure_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      logId,
      employee_id,
      employee_code,
      user_type,
      login_status,
      verification_status,
      device_id,
      ip_address,
      failure_reason
    );
  } catch (err) {
    console.warn('[Security Log Error]', err.message);
  }
}

/**
 * Record an HR Impersonation session event
 */
export function recordHrImpersonationLog({
  hr_id,
  hr_name,
  employee_id,
  employee_code,
  employee_name,
  reason,
  ip_address,
  device_info,
  session_id
}) {
  try {
    const logId = 'imp-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const stmt = db.prepare(`
      INSERT INTO hr_impersonation_logs (
        log_id, hr_id, hr_name, employee_id, employee_code, employee_name,
        action, reason, ip_address, device_info, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'HR_IMPERSONATION', ?, ?, ?, ?)
    `);
    stmt.run(
      logId,
      hr_id,
      hr_name,
      employee_id,
      employee_code,
      employee_name,
      reason || 'HR Authorized Employee View',
      ip_address,
      device_info,
      session_id
    );
  } catch (err) {
    console.warn('[Impersonation Log Error]', err.message);
  }
}

/**
 * Close HR Impersonation session
 */
export function endHrImpersonationSession(session_id) {
  try {
    const log = db.prepare('SELECT timestamp FROM hr_impersonation_logs WHERE session_id = ?').get(session_id);
    let duration = 'N/A';
    if (log && log.timestamp) {
      const ms = Date.now() - new Date(log.timestamp).getTime();
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      duration = `${mins}m ${secs}s`;
    }

    db.prepare(`
      UPDATE hr_impersonation_logs
      SET ended_at = CURRENT_TIMESTAMP, duration = ?
      WHERE session_id = ?
    `).run(duration, session_id);
  } catch (err) {
    console.warn('[End Impersonation Log Error]', err.message);
  }
}

function seedInitialData() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    console.log('Seeding initial UnitedSoft database records...');

    const salt = bcrypt.genSaltSync(10);
    const adminPass = bcrypt.hashSync('admin123', salt);

    // Seed Office Location
    const insertOffice = db.prepare(`
      INSERT INTO office_locations (id, name, latitude, longitude, radius_meters, address, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertOffice.run(
      config.DEFAULT_OFFICE.id,
      config.DEFAULT_OFFICE.name,
      config.DEFAULT_OFFICE.latitude,
      config.DEFAULT_OFFICE.longitude,
      config.DEFAULT_OFFICE.radius_meters,
      config.DEFAULT_OFFICE.address,
      1
    );

    // Seed Users (HR Admin)
    const insertUser = db.prepare(`
      INSERT INTO users (
        id, employee_code, full_name, email, password_hash, role,
        department, designation, phone, base_salary, hra, allowances,
        pf_deduction, tax_deduction, joining_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. HR / Admin
    insertUser.run(
      'usr-admin-01',
      'US-ADM-001',
      'Sarah Jenkins',
      'admin@unitedsoft.com',
      adminPass,
      'HR_ADMIN',
      'Human Resources',
      'HR Director & Admin',
      '+1-555-0100',
      95000,
      25000,
      10000,
      4000,
      12000,
      '2022-01-15',
      'ACTIVE'
    );

    console.log('Database initialized with HR Admin successfully.');
  }
}
