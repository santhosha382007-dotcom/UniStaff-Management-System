import mongoose from 'mongoose';

export const UserSchema = new mongoose.Schema({
  employee_code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  full_name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['ADMIN', 'HR', 'EMPLOYEE', 'HR_ADMIN'], default: 'EMPLOYEE' },
  department: { type: String, default: 'General' },
  designation: { type: String, default: 'Staff' },
  phone: { type: String, default: '' },
  base_salary: { type: Number, default: 50000 },
  hra: { type: Number, default: 15000 },
  allowances: { type: Number, default: 5000 },
  pf_deduction: { type: Number, default: 2500 },
  tax_deduction: { type: Number, default: 5000 },
  joining_date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  reset_token: { type: String, default: null },
  reset_token_expiry: { type: Date, default: null }
}, {
  timestamps: true
});

export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
