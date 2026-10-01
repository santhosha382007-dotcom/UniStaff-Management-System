import mongoose from 'mongoose';

export const LeaveSchema = new mongoose.Schema({
  user_id: { type: String, required: true, index: true },
  leave_type: {
    type: String,
    enum: ['CASUAL', 'SICK', 'PAID', 'UNPAID'],
    required: true
  },
  start_date: { type: String, required: true },
  end_date: { type: String, required: true },
  total_days: { type: Number, required: true, default: 1 },
  reason: { type: String, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
    index: true
  },
  approved_by: { type: String, default: null },
  action_at: { type: String, default: null },
  comments: { type: String, default: null }
}, {
  timestamps: true
});

export const LeaveModel = mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);
