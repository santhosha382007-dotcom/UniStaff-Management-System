import PDFDocument from 'pdfkit';

/**
 * Generates an itemized payslip PDF and pipes it to an Express response stream
 */
export function generatePayslipPDF(slip, employee, office, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Payslip_${employee.employee_code}_${slip.month_year}.pdf"`);

  doc.pipe(res);

  // --- Corporate Header ---
  doc.rect(40, 40, 515, 65).fill('#1E3A8A');
  doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('UnitedSoft Technologies Inc.', 60, 52);
  doc.fontSize(10).font('Helvetica').text('Corporate Attendance & Automated Payroll System', 60, 77);
  doc.fontSize(9).text(office ? office.address : 'Bengaluru Tech Hub, India', 60, 90);

  doc.moveDown(3);

  // --- Payslip Title & Period ---
  doc.fillColor('#0F172A').fontSize(14).font('Helvetica-Bold').text(`SALARY VOUCHER — ${slip.month_year}`, 40, 125, { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`Generated Date: ${new Date().toLocaleDateString()}`, 40, 142, { align: 'center' });

  // --- Employee Details Box ---
  const boxTop = 165;
  doc.rect(40, boxTop, 515, 75).strokeColor('#E2E8F0').lineWidth(1).stroke();

  doc.fillColor('#64748B').fontSize(9).font('Helvetica-Bold');
  doc.text('EMPLOYEE NAME:', 55, boxTop + 12);
  doc.text('EMPLOYEE CODE:', 55, boxTop + 30);
  doc.text('DEPARTMENT:', 55, boxTop + 48);

  doc.fillColor('#0F172A').fontSize(9).font('Helvetica');
  doc.text(employee.full_name, 160, boxTop + 12);
  doc.text(employee.employee_code, 160, boxTop + 30);
  doc.text(employee.department, 160, boxTop + 48);

  doc.fillColor('#64748B').font('Helvetica-Bold');
  doc.text('DESIGNATION:', 310, boxTop + 12);
  doc.text('PAY PERIOD:', 310, boxTop + 30);
  doc.text('PAYMENT STATUS:', 310, boxTop + 48);

  doc.fillColor('#0F172A').font('Helvetica');
  doc.text(employee.designation, 410, boxTop + 12);
  doc.text(slip.month_year, 410, boxTop + 30);
  doc.fillColor(slip.status === 'PAID' ? '#059669' : '#2563EB').font('Helvetica-Bold').text(slip.status, 410, boxTop + 48);

  // --- Attendance Factors Summary ---
  const attTop = 255;
  doc.rect(40, attTop, 515, 30).fill('#F8FAFC');
  doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
  doc.text(`Workdays: ${slip.total_working_days}`, 55, attTop + 10);
  doc.text(`Present Days: ${slip.present_days}`, 160, attTop + 10);
  doc.text(`Paid Leaves: ${slip.paid_leave_days}`, 270, attTop + 10);
  doc.text(`LOP Days: ${slip.unpaid_leave_days}`, 370, attTop + 10);
  doc.text(`Overtime: ${slip.overtime_hours}h`, 465, attTop + 10);

  // --- Earnings & Deductions Tables ---
  const tableTop = 305;

  // Earnings Header
  doc.rect(40, tableTop, 250, 22).fill('#E2E8F0');
  doc.fillColor('#1E293B').fontSize(10).font('Helvetica-Bold').text('EARNINGS', 50, tableTop + 6);
  doc.text('AMOUNT (₹)', 220, tableTop + 6, { align: 'right' });

  // Deductions Header
  doc.rect(305, tableTop, 250, 22).fill('#E2E8F0');
  doc.fillColor('#1E293B').fontSize(10).font('Helvetica-Bold').text('DEDUCTIONS', 315, tableTop + 6);
  doc.text('AMOUNT (₹)', 485, tableTop + 6, { align: 'right' });

  // Row 1
  let y = tableTop + 30;
  doc.fillColor('#0F172A').font('Helvetica').fontSize(9);
  doc.text('Basic Salary', 50, y);
  doc.text(slip.base_salary.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 220, y, { align: 'right' });

  doc.text('Loss of Pay (LOP)', 315, y);
  doc.text(slip.lop_deduction.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 485, y, { align: 'right' });

  // Row 2
  y += 20;
  doc.text('House Rent Allowance (HRA)', 50, y);
  doc.text(slip.hra.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 220, y, { align: 'right' });

  doc.text('Provident Fund (PF)', 315, y);
  doc.text(slip.pf_deduction.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 485, y, { align: 'right' });

  // Row 3
  y += 20;
  doc.text('Special Allowances', 50, y);
  doc.text(slip.allowances.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 220, y, { align: 'right' });

  doc.text('TDS / Income Tax', 315, y);
  doc.text(slip.tax_deduction.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 485, y, { align: 'right' });

  // Row 4 (Overtime)
  y += 20;
  doc.text(`Overtime (${slip.overtime_hours} hrs)`, 50, y);
  doc.text(slip.overtime_pay.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 220, y, { align: 'right' });

  // Subtotals
  y += 30;
  doc.rect(40, y, 250, 22).fill('#F1F5F9');
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9).text('GROSS EARNINGS:', 50, y + 6);
  doc.text(`₹${slip.gross_salary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 220, y + 6, { align: 'right' });

  const totalDeductions = slip.lop_deduction + slip.pf_deduction + slip.tax_deduction;
  doc.rect(305, y, 250, 22).fill('#F1F5F9');
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9).text('TOTAL DEDUCTIONS:', 315, y + 6);
  doc.text(`₹${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 485, y + 6, { align: 'right' });

  // --- Net Salary Highlight Banner ---
  y += 40;
  doc.rect(40, y, 515, 45).fill('#ECFDF5');
  doc.rect(40, y, 515, 45).strokeColor('#10B981').lineWidth(1.5).stroke();

  doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(11).text('NET TAKE-HOME SALARY PAYABLE:', 55, y + 15);
  doc.fillColor('#047857').fontSize(18).text(`₹${slip.net_salary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 380, y + 12, { align: 'right' });

  // --- Footer Notice & Digital Signature ---
  y += 75;
  doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(8).text(
    'Note: This document is an electronically generated salary voucher under the UnitedSoft Automated Attendance & Payroll System. No physical signature is required. For discrepancies, contact hr@unitedsoft.com.',
    40,
    y,
    { width: 515, align: 'center' }
  );

  doc.end();
}
