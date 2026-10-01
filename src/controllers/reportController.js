import { db } from '../db.js';

export function exportAttendanceReport(req, res) {
  const { format = 'csv', month, date } = req.query;

  let query = `
    SELECT a.date, u.employee_code, u.full_name, u.department, u.designation,
           a.check_in_time, a.check_out_time, a.working_hours, a.overtime_hours,
           a.status, a.distance_meters, a.remarks
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (date) {
    query += ' AND a.date = ?';
    params.push(date);
  } else if (month) {
    query += ' AND a.date LIKE ?';
    params.push(`${month}%`);
  }

  query += ' ORDER BY a.date DESC, u.employee_code ASC';

  const records = db.prepare(query).all(...params);

  if (format === 'json') {
    return res.json({ count: records.length, records });
  }

  // Generate CSV (compatible with Microsoft Excel)
  const headers = ['Date', 'Employee Code', 'Employee Name', 'Department', 'Designation', 'Check In', 'Check Out', 'Hours Worked', 'Overtime Hours', 'Status', 'Distance (m)', 'Remarks'];
  const csvRows = [headers.join(',')];

  for (const r of records) {
    const row = [
      r.date,
      `"${r.employee_code}"`,
      `"${r.full_name}"`,
      `"${r.department}"`,
      `"${r.designation}"`,
      r.check_in_time ? `"${new Date(r.check_in_time).toLocaleTimeString()}"` : '""',
      r.check_out_time ? `"${new Date(r.check_out_time).toLocaleTimeString()}"` : '""',
      r.working_hours || 0,
      r.overtime_hours || 0,
      r.status,
      Math.round(r.distance_meters || 0),
      `"${(r.remarks || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(','));
  }

  const csvContent = csvRows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="Attendance_Report_${month || date || 'all'}.csv"`);
  res.send(csvContent);
}

export function exportPayrollReport(req, res) {
  const { format = 'csv', month_year } = req.query;
  const targetMonth = month_year || new Date().toISOString().slice(0, 7);

  const records = db.prepare(`
    SELECT p.*, u.employee_code, u.full_name, u.department, u.designation, u.email
    FROM payroll p
    JOIN users u ON p.user_id = u.id
    WHERE p.month_year = ?
    ORDER BY u.employee_code ASC
  `).all(targetMonth);

  if (format === 'json') {
    return res.json({ month_year: targetMonth, count: records.length, records });
  }

  // Generate CSV for Payroll
  const headers = [
    'Month', 'Employee Code', 'Employee Name', 'Department', 'Designation',
    'Working Days', 'Present Days', 'Paid Leaves', 'Unpaid Leaves (LOP)', 'Overtime Hours',
    'Base Salary ($)', 'HRA ($)', 'Allowances ($)', 'Overtime Pay ($)', 'Gross Salary ($)',
    'LOP Deduction ($)', 'PF Deduction ($)', 'Tax Deduction ($)', 'Net Take-Home ($)', 'Status'
  ];

  const csvRows = [headers.join(',')];

  for (const r of records) {
    const row = [
      r.month_year,
      `"${r.employee_code}"`,
      `"${r.full_name}"`,
      `"${r.department}"`,
      `"${r.designation}"`,
      r.total_working_days,
      r.present_days,
      r.paid_leave_days,
      r.unpaid_leave_days,
      r.overtime_hours,
      r.base_salary,
      r.hra,
      r.allowances,
      r.overtime_pay,
      r.gross_salary,
      r.lop_deduction,
      r.pf_deduction,
      r.tax_deduction,
      r.net_salary,
      r.status
    ];
    csvRows.push(row.join(','));
  }

  const csvContent = csvRows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="Payroll_Report_${targetMonth}.csv"`);
  res.send(csvContent);
}
