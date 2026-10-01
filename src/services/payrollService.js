import { db } from '../db.js';
import crypto from 'crypto';

/**
 * Calculates standard working days in a month (excluding weekends)
 */
export function getWorkingDaysInMonth(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++;
    }
  }
  return workingDays > 0 ? workingDays : 22;
}

/**
 * Calculates automated payroll for an employee for a specific month (YYYY-MM)
 */
export function calculateEmployeePayroll(user, monthYear) {
  const [yearStr, monthStr] = monthYear.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const totalWorkingDays = getWorkingDaysInMonth(year, month);

  // 1. Fetch attendance records in this month
  const startDate = `${monthYear}-01`;
  const endDate = `${monthYear}-31`;

  const attendances = db.prepare(`
    SELECT status, working_hours, overtime_hours
    FROM attendance
    WHERE user_id = ? AND date >= ? AND date <= ?
  `).all(user.id, startDate, endDate);

  let presentDays = 0;
  let overtimeHours = 0;

  attendances.forEach(att => {
    if (att.status === 'PRESENT' || att.status === 'LATE') {
      presentDays += 1;
    } else if (att.status === 'HALF_DAY') {
      presentDays += 0.5;
    }
    overtimeHours += (att.overtime_hours || 0);
  });

  // 2. Fetch approved leaves in this month
  const leaves = db.prepare(`
    SELECT leave_type, total_days
    FROM leaves
    WHERE user_id = ? AND status = 'APPROVED'
      AND start_date <= ? AND end_date >= ?
  `).all(user.id, endDate, startDate);

  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;

  leaves.forEach(lv => {
    if (lv.leave_type === 'UNPAID') {
      unpaidLeaveDays += lv.total_days;
    } else {
      paidLeaveDays += lv.total_days;
    }
  });

  // Calculate unaccounted absence (if current date is past the month or for current month so far)
  const baseSalary = user.base_salary || 0;
  const hra = user.hra || 0;
  const allowances = user.allowances || 0;
  const pfDeduction = user.pf_deduction || 0;
  const taxDeduction = user.tax_deduction || 0;

  // Day rate and hourly overtime rate (1.5x)
  const dailyRate = totalWorkingDays > 0 ? (baseSalary / totalWorkingDays) : 0;
  const hourlyRate = (dailyRate / 8) * 1.5;
  const overtimePay = Math.round(overtimeHours * hourlyRate * 100) / 100;

  // Calculate Loss of Pay (LOP)
  // Any unpaid leave days + missing days if presentDays + paidLeaveDays < totalWorkingDays
  // For demo & flexibility, we base LOP on unpaidLeaveDays + capped days
  const absentDays = Math.max(0, totalWorkingDays - (presentDays + paidLeaveDays + unpaidLeaveDays));
  const totalLopDays = unpaidLeaveDays + absentDays;
  const lopDeduction = Math.round(totalLopDays * dailyRate * 100) / 100;

  const grossSalary = Math.round((baseSalary + hra + allowances + overtimePay) * 100) / 100;
  const totalDeductions = Math.round((lopDeduction + pfDeduction + taxDeduction) * 100) / 100;
  const netSalary = Math.max(0, Math.round((grossSalary - totalDeductions) * 100) / 100);

  return {
    id: `pay-${user.id}-${monthYear}`,
    user_id: user.id,
    month_year: monthYear,
    total_working_days: totalWorkingDays,
    present_days: presentDays,
    paid_leave_days: paidLeaveDays,
    unpaid_leave_days: totalLopDays,
    overtime_hours: overtimeHours,
    base_salary: baseSalary,
    hra: hra,
    allowances: allowances,
    overtime_pay: overtimePay,
    gross_salary: grossSalary,
    lop_deduction: lopDeduction,
    pf_deduction: pfDeduction,
    tax_deduction: taxDeduction,
    net_salary: netSalary,
    status: 'PROCESSED'
  };
}

/**
 * Runs payroll generation for ALL active employees for a given month
 */
export function generateMonthlyPayroll(monthYear) {
  const employees = db.prepare("SELECT * FROM users WHERE status = 'ACTIVE'").all();
  const results = [];

  const upsertStmt = db.prepare(`
    INSERT INTO payroll (
      id, user_id, month_year, total_working_days, present_days, paid_leave_days,
      unpaid_leave_days, overtime_hours, base_salary, hra, allowances, overtime_pay,
      gross_salary, lop_deduction, pf_deduction, tax_deduction, net_salary, status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(user_id, month_year) DO UPDATE SET
      total_working_days = excluded.total_working_days,
      present_days = excluded.present_days,
      paid_leave_days = excluded.paid_leave_days,
      unpaid_leave_days = excluded.unpaid_leave_days,
      overtime_hours = excluded.overtime_hours,
      base_salary = excluded.base_salary,
      hra = excluded.hra,
      allowances = excluded.allowances,
      overtime_pay = excluded.overtime_pay,
      gross_salary = excluded.gross_salary,
      lop_deduction = excluded.lop_deduction,
      pf_deduction = excluded.pf_deduction,
      tax_deduction = excluded.tax_deduction,
      net_salary = excluded.net_salary,
      status = excluded.status,
      generated_at = CURRENT_TIMESTAMP
  `);

  for (const emp of employees) {
    const calc = calculateEmployeePayroll(emp, monthYear);
    upsertStmt.run(
      calc.id,
      calc.user_id,
      calc.month_year,
      calc.total_working_days,
      calc.present_days,
      calc.paid_leave_days,
      calc.unpaid_leave_days,
      calc.overtime_hours,
      calc.base_salary,
      calc.hra,
      calc.allowances,
      calc.overtime_pay,
      calc.gross_salary,
      calc.lop_deduction,
      calc.pf_deduction,
      calc.tax_deduction,
      calc.net_salary,
      calc.status
    );
    results.push({ ...calc, employee_name: emp.full_name, employee_code: emp.employee_code, department: emp.department });
  }

  return results;
}
