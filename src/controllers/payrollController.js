import { db } from '../db.js';
import { generateMonthlyPayroll } from '../services/payrollService.js';
import { generatePayslipPDF } from '../services/pdfService.js';

function getDefaultMonthYear() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function generatePayroll(req, res) {
  const { month_year } = req.body;
  const targetMonth = month_year || getDefaultMonthYear();

  try {
    const results = generateMonthlyPayroll(targetMonth);
    res.json({
      message: `Automated payroll processed successfully for period ${targetMonth}`,
      month_year: targetMonth,
      count: results.length,
      records: results
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process automated payroll', details: err.message });
  }
}

export function getPayrollRecords(req, res) {
  const { month_year } = req.query;
  const targetMonth = month_year || getDefaultMonthYear();

  const records = db.prepare(`
    SELECT p.*, u.full_name, u.employee_code, u.department, u.designation, u.email
    FROM payroll p
    JOIN users u ON p.user_id = u.id
    WHERE p.month_year = ?
    ORDER BY u.employee_code ASC
  `).all(targetMonth);

  // Financial aggregates
  const summary = {
    month_year: targetMonth,
    totalEmployees: records.length,
    totalGross: records.reduce((sum, r) => sum + r.gross_salary, 0),
    totalDeductions: records.reduce((sum, r) => sum + (r.lop_deduction + r.pf_deduction + r.tax_deduction), 0),
    totalNetPayout: records.reduce((sum, r) => sum + r.net_salary, 0),
    totalOvertimeHours: records.reduce((sum, r) => sum + r.overtime_hours, 0)
  };

  res.json({ records, summary });
}

export function updatePayrollStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'DRAFT', 'PROCESSED', 'PAID'

  if (!['DRAFT', 'PROCESSED', 'PAID'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  db.prepare('UPDATE payroll SET status = ? WHERE id = ?').run(status, id);
  const updated = db.prepare('SELECT * FROM payroll WHERE id = ?').get(id);

  res.json({ message: `Payroll record updated to ${status}`, record: updated });
}

export function getMySlips(req, res) {
  const userId = req.user.id;

  const slips = db.prepare(`
    SELECT * FROM payroll
    WHERE user_id = ?
    ORDER BY month_year DESC
  `).all(userId);

  res.json({ slips });
}

export function getPayslipDetails(req, res) {
  const { id } = req.params;
  const isHR = ['HR', 'ADMIN', 'HR_ADMIN'].includes(req.user.role);

  let query = `
    SELECT p.*, u.full_name, u.employee_code, u.department, u.designation, u.phone, u.email, u.joining_date
    FROM payroll p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `;
  const params = [id];

  if (!isHR) {
    query += ' AND p.user_id = ?';
    params.push(req.user.id);
  }

  const slip = db.prepare(query).get(...params);
  if (!slip) {
    return res.status(404).json({ error: 'Payslip record not found or access denied' });
  }

  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();

  res.json({
    payslip: slip,
    company: {
      name: 'UnitedSoft Technologies Inc.',
      address: office ? office.address : 'UnitedSoft Tower, Bengaluru',
      currency: 'INR',
      symbol: '₹'
    }
  });
}

export function downloadPayslipPDF(req, res) {
  const { id } = req.params;
  const isHR = ['HR', 'ADMIN', 'HR_ADMIN'].includes(req.user.role);

  let query = `
    SELECT p.*, u.full_name, u.employee_code, u.department, u.designation, u.phone, u.email
    FROM payroll p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `;
  const params = [id];

  if (!isHR) {
    query += ' AND p.user_id = ?';
    params.push(req.user.id);
  }

  const slip = db.prepare(query).get(...params);
  if (!slip) {
    return res.status(404).json({ error: 'Payslip record not found or access denied' });
  }

  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();
  generatePayslipPDF(slip, {
    full_name: slip.full_name,
    employee_code: slip.employee_code,
    department: slip.department,
    designation: slip.designation
  }, office, res);
}
