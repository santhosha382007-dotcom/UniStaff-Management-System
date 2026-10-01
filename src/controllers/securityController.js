import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, recordLoginSecurityLog, recordHrImpersonationLog, endHrImpersonationSession } from '../db.js';
import { config } from '../config.js';

/**
 * HR Impersonation: HR logs in as an employee with temporary session
 * Flowchart Section 3: HR DASHBOARD & EMPLOYEE ACCESS
 */
export function hrImpersonate(req, res) {
  const hrUser = req.user;
  const { employeeId, reason } = req.body;

  if (!employeeId) {
    return res.status(400).json({ error: 'Employee ID is required for access' });
  }

  // 1. Verify HR permissions
  if (hrUser.role !== 'HR_ADMIN' && hrUser.role !== 'ADMIN' && hrUser.role !== 'HR') {
    return res.status(403).json({ error: 'Access Denied: Only authorized HR Administrators can access employee accounts' });
  }

  // 2. Fetch target employee
  const employee = db.prepare(`
    SELECT * FROM users 
    WHERE (id = ? OR employee_code = ?)
  `).get(employeeId, employeeId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee account not found' });
  }

  // 3. Generate temporary impersonation session
  const sessionId = 'imp-' + crypto.randomUUID();
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const deviceInfo = req.headers['user-agent'] || 'UnitedSoft Mobile Client';

  // 4. Record in HR Impersonation Audit Log (Flowchart Section 6 & Rule 8)
  recordHrImpersonationLog({
    hr_id: hrUser.id,
    hr_name: hrUser.full_name || 'HR Admin',
    employee_id: employee.id,
    employee_code: employee.employee_code,
    employee_name: employee.full_name,
    reason: reason || 'HR Authorized Administrative Access',
    ip_address: ipAddress,
    device_info: deviceInfo,
    session_id: sessionId
  });

  // 5. Issue temporary impersonation JWT (2 hours max)
  const impersonationToken = jwt.sign(
    {
      id: employee.id,
      email: employee.email,
      role: employee.role,
      isImpersonating: true,
      impersonatedBy: {
        id: hrUser.id,
        name: hrUser.full_name,
        email: hrUser.email
      },
      impersonationReason: reason || 'HR Authorized Administrative Access',
      sessionId
    },
    config.JWT_SECRET,
    { expiresIn: '2h' }
  );

  const { password_hash, ...employeeProfile } = employee;
  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();

  res.json({
    message: `Impersonation session active for ${employee.full_name} (${employee.employee_code})`,
    token: impersonationToken,
    user: employeeProfile,
    office,
    impersonation: {
      sessionId,
      hrAdminId: hrUser.id,
      hrAdminName: hrUser.full_name,
      employeeCode: employee.employee_code,
      employeeName: employee.full_name,
      reason: reason || 'HR Authorized Administrative Access'
    }
  });
}

/**
 * Exit HR Impersonation session
 */
export function exitHrImpersonation(req, res) {
  const { sessionId } = req.body;
  if (sessionId) {
    endHrImpersonationSession(sessionId);
  }
  res.json({ message: 'Impersonation session concluded successfully' });
}

/**
 * HR resets an employee's registered device
 * (Used when employee changed phone, lost device, or SIM changed)
 */
export function resetEmployeeDevice(req, res) {
  const { id } = req.params;

  const target = db.prepare('SELECT id, employee_code, full_name, phone, device_registered FROM users WHERE id = ?').get(id);
  if (!target) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  db.prepare(`
    UPDATE users SET
      device_registered = 0,
      device_public_key = NULL,
      device_id = NULL,
      device_registered_at = NULL,
      hr_verification_code = NULL
    WHERE id = ?
  `).run(id);

  // Log device reset in security logs
  recordLoginSecurityLog({
    employee_id: target.id,
    employee_code: target.employee_code,
    user_type: 'HR',
    login_status: 'SUCCESS',
    verification_status: 'DEVICE_RESET_BY_HR',
    device_id: null,
    ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
    failure_reason: `Device registration reset by HR Admin (${req.user?.full_name || 'Admin'})`
  });

  res.json({
    message: `Device binding for ${target.full_name} (${target.employee_code}) has been reset. The employee can now register their new device upon next login.`,
    employeeId: target.id
  });
}

/**
 * Generate a 6-digit HR verification code for an employee
 * (Used for Controlled Verification Flow if device telephony fails)
 */
export function generateHrVerificationCode(req, res) {
  const { id } = req.params;

  const target = db.prepare('SELECT id, employee_code, full_name, phone FROM users WHERE id = ?').get(id);
  if (!target) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

  db.prepare(`
    UPDATE users SET
      hr_verification_code = ?,
      hr_verification_expiry = ?
    WHERE id = ?
  `).run(code, expiry, id);

  res.json({
    message: 'HR device verification code generated successfully',
    code,
    employeeCode: target.employee_code,
    employeeName: target.full_name,
    registeredMobile: target.phone,
    expiresInMinutes: 15
  });
}

/**
 * Get recent Login & Security Logs
 */
export function getLoginSecurityLogs(req, res) {
  const logs = db.prepare(`
    SELECT * FROM login_security_logs
    ORDER BY timestamp DESC
    LIMIT 100
  `).all();

  res.json({ logs });
}

/**
 * Get recent HR Impersonation Logs
 */
export function getHrImpersonationLogs(req, res) {
  const logs = db.prepare(`
    SELECT * FROM hr_impersonation_logs
    ORDER BY timestamp DESC
    LIMIT 100
  `).all();

  res.json({ logs });
}
