import crypto from 'crypto';
import { db } from '../db.js';

function calculateDaysBetween(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays > 0 ? diffDays : 1;
}

export function applyLeave(req, res) {
  const userId = req.user.id;
  const { leave_type, start_date, end_date, reason } = req.body;

  if (!leave_type || !start_date || !end_date || !reason) {
    return res.status(400).json({ error: 'Leave type, start date, end date, and reason are required' });
  }

  const validTypes = ['CASUAL', 'SICK', 'PAID', 'UNPAID'];
  if (!validTypes.includes(leave_type)) {
    return res.status(400).json({ error: `Invalid leave type. Must be one of: ${validTypes.join(', ')}` });
  }

  const totalDays = calculateDaysBetween(start_date, end_date);
  const id = `lv-${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO leaves (id, user_id, leave_type, start_date, end_date, total_days, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(id, userId, leave_type, start_date, end_date, totalDays, reason.trim());

  const created = db.prepare('SELECT * FROM leaves WHERE id = ?').get(id);

  res.status(201).json({
    message: 'Leave application submitted for HR approval',
    leave: created
  });
}

export function getMyLeaves(req, res) {
  const userId = req.user.id;

  const leaves = db.prepare(`
    SELECT l.*, u.full_name as approver_name
    FROM leaves l
    LEFT JOIN users u ON l.approved_by = u.id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
  `).all(userId);

  // Calculate annual balances
  // Standard quota: Casual: 12, Sick: 10, Paid: 15
  const approvedLeaves = leaves.filter(l => l.status === 'APPROVED');
  const usedCasual = approvedLeaves.filter(l => l.leave_type === 'CASUAL').reduce((a, b) => a + b.total_days, 0);
  const usedSick = approvedLeaves.filter(l => l.leave_type === 'SICK').reduce((a, b) => a + b.total_days, 0);
  const usedPaid = approvedLeaves.filter(l => l.leave_type === 'PAID').reduce((a, b) => a + b.total_days, 0);
  const usedUnpaid = approvedLeaves.filter(l => l.leave_type === 'UNPAID').reduce((a, b) => a + b.total_days, 0);

  const balances = {
    casual: { quota: 12, used: usedCasual, remaining: Math.max(0, 12 - usedCasual) },
    sick: { quota: 10, used: usedSick, remaining: Math.max(0, 10 - usedSick) },
    paid: { quota: 15, used: usedPaid, remaining: Math.max(0, 15 - usedPaid) },
    unpaidUsed: usedUnpaid
  };

  res.json({ leaves, balances });
}

export function getAllLeaves(req, res) {
  const { status, department } = req.query;

  let query = `
    SELECT l.*, u.full_name, u.employee_code, u.department, u.designation,
           app.full_name as approver_name
    FROM leaves l
    JOIN users u ON l.user_id = u.id
    LEFT JOIN users app ON l.approved_by = app.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ' AND l.status = ?';
    params.push(status);
  }
  if (department) {
    query += ' AND u.department = ?';
    params.push(department);
  }

  query += ' ORDER BY l.created_at DESC LIMIT 100';

  const leaves = db.prepare(query).all(...params);

  const pendingCount = db.prepare("SELECT COUNT(*) as count FROM leaves WHERE status = 'PENDING'").get().count;

  res.json({
    leaves,
    pendingCount
  });
}

export function updateLeaveStatus(req, res) {
  const { id } = req.params;
  const { status, comments } = req.body;

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Status must be either APPROVED or REJECTED' });
  }

  const existing = db.prepare('SELECT * FROM leaves WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Leave request not found' });
  }

  db.prepare(`
    UPDATE leaves SET
      status = ?,
      approved_by = ?,
      action_at = CURRENT_TIMESTAMP,
      comments = ?
    WHERE id = ?
  `).run(status, req.user.id, comments || null, id);

  const updated = db.prepare(`
    SELECT l.*, u.full_name, app.full_name as approver_name
    FROM leaves l
    JOIN users u ON l.user_id = u.id
    LEFT JOIN users app ON l.approved_by = app.id
    WHERE l.id = ?
  `).get(id);

  res.json({
    message: `Leave application marked as ${status}`,
    leave: updated
  });
}
