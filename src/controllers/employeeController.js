import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

export function getEmployees(req, res) {
  const { search, department, status } = req.query;

  let query = `
    SELECT id, employee_code, full_name, email, role, department, designation,
           phone, base_salary, hra, allowances, pf_deduction, tax_deduction,
           joining_date, status, created_at
    FROM users
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ' AND (full_name LIKE ? OR employee_code LIKE ? OR email LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  if (department) {
    query += ' AND department = ?';
    params.push(department);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY employee_code ASC';

  const employees = db.prepare(query).all(...params);
  res.json({ employees });
}

export function getEmployeeById(req, res) {
  const { id } = req.params;

  const user = db.prepare(`
    SELECT id, employee_code, full_name, email, role, department, designation,
           phone, base_salary, hra, allowances, pf_deduction, tax_deduction,
           joining_date, status, created_at
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  // Fetch recent attendance
  const recentAttendance = db.prepare(`
    SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC LIMIT 10
  `).all(id);

  // Fetch recent leaves
  const recentLeaves = db.prepare(`
    SELECT * FROM leaves WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(id);

  // Fetch latest payroll
  const latestPayroll = db.prepare(`
    SELECT * FROM payroll WHERE user_id = ? ORDER BY month_year DESC LIMIT 3
  `).all(id);

  res.json({
    employee: user,
    recentAttendance,
    recentLeaves,
    latestPayroll
  });
}

export function createEmployee(req, res) {
  const {
    employee_code,
    full_name,
    email,
    password,
    role = 'EMPLOYEE',
    department,
    designation,
    phone,
    base_salary = 50000,
    hra = 15000,
    allowances = 5000,
    pf_deduction = 2500,
    tax_deduction = 5000,
    joining_date = new Date().toISOString().split('T')[0]
  } = req.body;

  if (!full_name || !email) {
    return res.status(400).json({ error: 'Full name and email are required' });
  }

  // Check email uniqueness
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (existingEmail) {
    return res.status(400).json({ error: 'An employee with this email already exists' });
  }

  const generatedCode = employee_code || `US-${department ? department.slice(0, 3).toUpperCase() : 'EMP'}-${Math.floor(100 + Math.random() * 900)}`;

  // Hash password (default: emp123)
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password || 'emp123', salt);
  const id = `usr-${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO users (
      id, employee_code, full_name, email, password_hash, role,
      department, designation, phone, base_salary, hra, allowances,
      pf_deduction, tax_deduction, joining_date, status, must_change_password
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1)
  `).run(
    id,
    generatedCode,
    full_name.trim(),
    email.trim().toLowerCase(),
    passwordHash,
    role,
    department || 'General',
    designation || 'Staff',
    phone || '',
    parseFloat(base_salary) || 0,
    parseFloat(hra) || 0,
    parseFloat(allowances) || 0,
    parseFloat(pf_deduction) || 0,
    parseFloat(tax_deduction) || 0,
    joining_date
  );

  const created = db.prepare(`
    SELECT id, employee_code, full_name, email, role, department, designation,
           phone, base_salary, hra, allowances, pf_deduction, tax_deduction,
           joining_date, status, must_change_password
    FROM users WHERE id = ?
  `).get(id);

  res.status(201).json({
    message: 'Employee created successfully',
    employee: created
  });
}

export function updateEmployee(req, res) {
  const { id } = req.params;
  const {
    full_name,
    department,
    designation,
    phone,
    base_salary,
    hra,
    allowances,
    pf_deduction,
    tax_deduction,
    status,
    role
  } = req.body;

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  db.prepare(`
    UPDATE users SET
      full_name = COALESCE(?, full_name),
      department = COALESCE(?, department),
      designation = COALESCE(?, designation),
      phone = COALESCE(?, phone),
      base_salary = COALESCE(?, base_salary),
      hra = COALESCE(?, hra),
      allowances = COALESCE(?, allowances),
      pf_deduction = COALESCE(?, pf_deduction),
      tax_deduction = COALESCE(?, tax_deduction),
      status = COALESCE(?, status),
      role = COALESCE(?, role)
    WHERE id = ?
  `).run(
    full_name !== undefined ? full_name.trim() : null,
    department !== undefined ? department : null,
    designation !== undefined ? designation : null,
    phone !== undefined ? phone : null,
    base_salary !== undefined ? parseFloat(base_salary) : null,
    hra !== undefined ? parseFloat(hra) : null,
    allowances !== undefined ? parseFloat(allowances) : null,
    pf_deduction !== undefined ? parseFloat(pf_deduction) : null,
    tax_deduction !== undefined ? parseFloat(tax_deduction) : null,
    status !== undefined ? status : null,
    role !== undefined ? role : null,
    id
  );

  const updated = db.prepare(`
    SELECT id, employee_code, full_name, email, role, department, designation,
           phone, base_salary, hra, allowances, pf_deduction, tax_deduction,
           joining_date, status
    FROM users WHERE id = ?
  `).get(id);

  res.json({ message: 'Employee updated successfully', employee: updated });
}

export function deleteEmployee(req, res) {
  const { id } = req.params;

  const target = db.prepare('SELECT id, role, full_name FROM users WHERE id = ?').get(id);
  if (!target) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  if (target.role === 'HR_ADMIN' || target.id === req.user?.id) {
    return res.status(403).json({ error: 'Cannot delete HR Admin account' });
  }

  // Delete all associated records then the user
  db.prepare('DELETE FROM attendance WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM leaves WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM payroll WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  res.json({ message: `Employee ${target.full_name} deleted successfully` });
}
