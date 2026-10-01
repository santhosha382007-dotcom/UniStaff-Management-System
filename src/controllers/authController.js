import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db, recordLoginSecurityLog } from '../db.js';
import { config } from '../config.js';

// In-memory reset tokens for password recovery demo
const resetCodes = new Map();

/**
 * Normalizes phone numbers to digits only
 */
export function normalizePhone(phone) {
  if (!phone) return '';
  return phone.toString().replace(/\D/g, '');
}

/**
 * Compares detected device phone number against registered number
 * Supports dual-SIM, national (10-digit), and international formats
 */
export function phonesMatch(detected, registered) {
  const normDet = normalizePhone(detected);
  const normReg = normalizePhone(registered);
  if (!normDet || !normReg) return false;
  if (normDet === normReg) return true;
  // Match last 10 digits (e.g., handles +91-8903366719 matching 8903366719)
  if (normDet.length >= 10 && normReg.length >= 10) {
    return normDet.slice(-10) === normReg.slice(-10);
  }
  return false;
}

/**
 * Hash device key + device ID with SHA-256 (Rule 7: Device keys must not be stored in plain text)
 */
export function hashDeviceKey(deviceKey, deviceId) {
  return crypto.createHash('sha256').update(`${deviceKey || ''}::${deviceId || ''}`).digest('hex');
}

/**
 * Main Login Endpoint
 * Follows Flowchart Section 1, 2, 4, 5, 7, 8
 */
export function login(req, res) {
  const {
    email,
    loginId,
    password,
    userType = 'EMPLOYEE', // 'HR' or 'EMPLOYEE'
    deviceId,
    deviceKey,
    detectedMobileNumbers = [],
    verificationCode
  } = req.body;

  const identifier = (loginId || email || '').trim();
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Login ID / Email and password are required' });
  }

  // 1. Authenticate Credentials (Section 1)
  const user = db.prepare('SELECT * FROM users WHERE (email = ? COLLATE NOCASE OR employee_code = ? COLLATE NOCASE)').get(identifier, identifier);
  if (!user) {
    recordLoginSecurityLog({
      employee_id: null,
      employee_code: identifier,
      user_type: userType,
      login_status: 'FAILED',
      verification_status: 'CREDENTIALS_INVALID',
      device_id: deviceId,
      ip_address: ipAddress,
      failure_reason: 'Account not found with provided ID / Email'
    });
    return res.status(401).json({ error: 'Invalid Login ID / Email or password' });
  }

  if (user.status !== 'ACTIVE') {
    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: userType,
      login_status: 'BLOCKED',
      verification_status: 'ACCOUNT_DEACTIVATED',
      device_id: deviceId,
      ip_address: ipAddress,
      failure_reason: 'User account is deactivated'
    });
    return res.status(403).json({ error: 'Account is deactivated. Contact HR.' });
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: userType,
      login_status: 'FAILED',
      verification_status: 'CREDENTIALS_INVALID',
      device_id: deviceId,
      ip_address: ipAddress,
      failure_reason: 'Incorrect password entered'
    });
    return res.status(401).json({ error: 'Invalid Login ID / Email or password' });
  }

  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();

  // ------------------------------------------------------------------------
  // BRANCH A: HR LOGIN FLOW (Section 1)
  // ------------------------------------------------------------------------
  if (userType === 'HR') {
    const isHrRole = user.role === 'HR_ADMIN' || user.role === 'ADMIN' || user.role === 'HR';
    if (!isHrRole) {
      recordLoginSecurityLog({
        employee_id: user.id,
        employee_code: user.employee_code,
        user_type: 'HR',
        login_status: 'DENIED',
        verification_status: 'NOT_HR_ACCOUNT',
        device_id: deviceId,
        ip_address: ipAddress,
        failure_reason: 'Non-HR user attempted to log in through HR portal'
      });
      return res.status(403).json({
        error: 'Access Denied: This account is not authorized for HR Administrator access. Please switch to Employee Login.',
        code: 'NOT_HR_ACCOUNT'
      });
    }

    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: 'HR',
      login_status: 'SUCCESS',
      verification_status: 'VERIFIED_SUCCESS',
      device_id: deviceId,
      ip_address: ipAddress
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const { password_hash, ...userProfile } = user;
    return res.json({
      message: 'HR Login successful',
      token,
      user: userProfile,
      mustChangePassword: !!user.must_change_password,
      office
    });
  }

  // ------------------------------------------------------------------------
  // BRANCH B: EMPLOYEE DEVICE & MOBILE VERIFICATION (Section 2, 4, 5)
  // ------------------------------------------------------------------------
  const registeredPhone = user.phone ? user.phone.trim() : '';

  if (!registeredPhone) {
    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: 'EMPLOYEE',
      login_status: 'DENIED',
      verification_status: 'NO_PHONE_REGISTERED',
      device_id: deviceId,
      ip_address: ipAddress,
      failure_reason: 'No registered mobile number on employee file'
    });
    return res.status(403).json({
      error: 'No mobile number has been registered by HR for this employee account. Please contact HR to register your mobile number.',
      code: 'NO_PHONE_REGISTERED'
    });
  }

  // Check if detectedMobileNumbers provided from device Telephony API
  const simNumbers = Array.isArray(detectedMobileNumbers)
    ? detectedMobileNumbers.filter(Boolean)
    : (detectedMobileNumbers ? [detectedMobileNumbers] : []);

  // Check if an emergency / controlled HR verification code was supplied
  let isHrBypassValid = false;
  if (verificationCode && user.hr_verification_code) {
    const isCodeMatch = verificationCode.toString().trim() === user.hr_verification_code.toString().trim();
    const isNotExpired = user.hr_verification_expiry && new Date(user.hr_verification_expiry) > new Date();
    if (isCodeMatch && isNotExpired) {
      isHrBypassValid = true;
    }
  }

  // STEP 2.1: Mobile Number Found?
  if (simNumbers.length === 0 && !isHrBypassValid) {
    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: 'EMPLOYEE',
      login_status: 'DENIED',
      verification_status: 'MOBILE_NOT_FOUND',
      device_id: deviceId,
      ip_address: ipAddress,
      failure_reason: 'Mobile number could not be verified on this device (no SIM detected or number unavailable)'
    });

    return res.status(403).json({
      error: 'Mobile number could not be verified on this device.',
      code: 'MOBILE_NOT_FOUND',
      message: 'Mobile number could not be read from this device. Please ensure a SIM card with your registered number is active in this phone, or contact HR for authorization.',
      canRequestHrHelp: true,
      registeredMobileMasked: registeredPhone.length > 4 ? registeredPhone.slice(-4).padStart(registeredPhone.length, '•') : registeredPhone
    });
  }

  // STEP 2.2: Compare with HR Registered Number (Numbers Match?)
  if (!isHrBypassValid) {
    const isNumberMatch = simNumbers.some(simNum => phonesMatch(simNum, registeredPhone));
    if (!isNumberMatch) {
      recordLoginSecurityLog({
        employee_id: user.id,
        employee_code: user.employee_code,
        user_type: 'EMPLOYEE',
        login_status: 'BLOCKED',
        verification_status: 'MOBILE_MISMATCH',
        device_id: deviceId,
        ip_address: ipAddress,
        failure_reason: `Device SIM numbers [${simNumbers.join(', ')}] did not match registered employee mobile [${registeredPhone}]`
      });

      return res.status(403).json({
        error: 'This device is not registered for this employee account.',
        code: 'MOBILE_MISMATCH',
        message: 'The mobile number in this device does not match the mobile number registered by HR for this employee account.'
      });
    }
  }

  // STEP 2.3 & Section 5: Check Registered Device
  const safeDeviceId = deviceId || 'dev-unknown-' + user.id;
  const safeDeviceKey = deviceKey || 'key-unknown-' + user.id;
  const keyHash = hashDeviceKey(safeDeviceKey, safeDeviceId);

  if (!user.device_registered) {
    // FIRST LOGIN: Register This Device (Section 5)
    db.prepare(`
      UPDATE users SET
        device_registered = 1,
        device_public_key = ?,
        device_id = ?,
        device_registered_at = CURRENT_TIMESTAMP,
        hr_verification_code = NULL,
        hr_verification_expiry = NULL
      WHERE id = ?
    `).run(keyHash, safeDeviceId, user.id);

    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: 'EMPLOYEE',
      login_status: 'SUCCESS',
      verification_status: 'DEVICE_REGISTERED',
      device_id: safeDeviceId,
      ip_address: ipAddress,
      failure_reason: 'Device key generated and bound to employee account (First Login)'
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, deviceId: safeDeviceId },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const { password_hash, ...userProfile } = updatedUser;

    return res.json({
      message: 'Device successfully registered and bound to your account! Future logins will require this device & mobile.',
      token,
      user: userProfile,
      mustChangePassword: !!user.must_change_password,
      office,
      isFirstDeviceRegistration: true
    });
  }

  // SUBSEQUENT LOGIN: Verify Same Device (Section 4)
  const isDeviceMatch = (user.device_id === safeDeviceId) && (user.device_public_key === keyHash);
  if (!isDeviceMatch) {
    recordLoginSecurityLog({
      employee_id: user.id,
      employee_code: user.employee_code,
      user_type: 'EMPLOYEE',
      login_status: 'BLOCKED',
      verification_status: 'DEVICE_MISMATCH',
      device_id: safeDeviceId,
      ip_address: ipAddress,
      failure_reason: `Device mismatch. Account is registered to device [${user.device_id}], received [${safeDeviceId}]`
    });

    return res.status(403).json({
      error: 'This device is not registered for this employee account.',
      code: 'DEVICE_MISMATCH',
      message: 'This employee account is bound to another device. For security purposes, logins from multiple devices are blocked. Contact HR to authorize or reset your device.'
    });
  }

  // All checks passed! Login Successful
  recordLoginSecurityLog({
    employee_id: user.id,
    employee_code: user.employee_code,
    user_type: 'EMPLOYEE',
    login_status: 'SUCCESS',
    verification_status: 'VERIFIED_SUCCESS',
    device_id: safeDeviceId,
    ip_address: ipAddress
  });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, deviceId: safeDeviceId },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );

  const { password_hash, ...userProfile } = user;

  res.json({
    message: 'Login successful. Mobile and device verified.',
    token,
    user: userProfile,
    mustChangePassword: !!user.must_change_password,
    office
  });
}

export function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }

  const user = db.prepare('SELECT id, full_name, email FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
  if (!user) {
    // Return friendly message even if email not found for security
    return res.json({ message: 'If this email exists in our records, a password reset verification code has been dispatched.' });
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  resetCodes.set(user.email.toLowerCase(), {
    code,
    userId: user.id,
    expiresAt: Date.now() + 15 * 60 * 1000 // 15 mins
  });

  res.json({
    message: 'Password reset code generated successfully',
    demo_code: code, // returned for mobile demo convenience
    email: user.email
  });
}

export function resetPassword(req, res) {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, verification code, and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const record = resetCodes.get(email.toLowerCase().trim());
  if (!record || record.code !== code.trim() || Date.now() > record.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword, salt);

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, record.userId);
  resetCodes.delete(email.toLowerCase().trim());

  res.json({ message: 'Password has been reset successfully. You can now log in.' });
}

export function getMe(req, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { password_hash, ...userProfile } = user;
  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();

  res.json({ user: userProfile, office });
}

export function getDemoAccounts(req, res) {
  const users = db.prepare(`
    SELECT id, employee_code, full_name, email, role, department, designation
    FROM users
    WHERE status = 'ACTIVE'
  `).all();

  res.json({
    accounts: users.map(u => ({
      ...u,
      sample_password: (u.role === 'ADMIN' || u.role === 'HR_ADMIN') ? 'admin123' : 'emp123'
    }))
  });
}

export function changePassword(req, res) {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.trim().length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // If currentPassword provided, verify it (unless first-time password reset by staff)
  if (currentPassword) {
    const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password does not match' });
    }
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword.trim(), salt);

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, userId);

  const updatedUser = db.prepare('SELECT id, employee_code, full_name, email, role, department, designation, phone, status, must_change_password FROM users WHERE id = ?').get(userId);

  res.json({
    message: 'Password updated successfully! You can now use your new password.',
    user: updatedUser
  });
}
