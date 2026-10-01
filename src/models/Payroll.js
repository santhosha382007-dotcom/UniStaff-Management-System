import mongoose from 'mongoose';

export const PayrollSchema = new mongoose.Schema({
  user_id: { type: String, required: true, index: true },
  month_year: { type: String, required: true, index: true }, // Format: YYYY-MM
  total_working_days: { type: Number, required: true },
  present_days: { type: Number, required: true, default: 0 },
  paid_leave_days: { type: Number, required: true, default: 0 },
  unpaid_leave_days: { type: Number, required: true, default: 0 },
  overtime_hours: { type: Number, required: true, default: 0 },
  base_salary: { type: Number, required: true },
  hra: { type: Number, required: true, default: 0 },
  allowances: { type: Number, required: true, default: 0 },
  overtime_pay: { type: Number, required: true, default: 0 },
  gross_salary: { type: Number, required: true },
  lop_deduction: { type: Number, required: true, default: 0 },
  pf_deduction: { type: Number, required: true, default: 0 },
  tax_deduction: { type: Number, required: true, default: 0 },
  net_salary: { type: Number, required: true },
  status: {
    type: String,
    enum: ['DRAFT', 'PROCESSED', 'PAID'],
    default: 'PROCESSED'
  },
  generated_at: { type: Date, default: Date.now }
}, {
  timestamps: true
});

PayrollSchema.index({ user_id: 1, month_year: 1 }, { unique: true });

export const PayrollModel = mongoose.models.Payroll || mongoose.model('Payroll', PayrollSchema);
