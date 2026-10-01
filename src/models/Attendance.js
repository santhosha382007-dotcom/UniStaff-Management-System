import mongoose from 'mongoose';

export const AttendanceSchema = new mongoose.Schema({
  user_id: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true }, // Format: YYYY-MM-DD
  check_in_time: { type: String, default: null }, // ISO timestamp
  check_out_time: { type: String, default: null },
  check_in_lat: { type: Number, default: null },
  check_in_lng: { type: Number, default: null },
  check_in_photo: { type: String, default: null },
  check_out_lat: { type: Number, default: null },
  check_out_lng: { type: Number, default: null },
  status: {
    type: String,
    enum: ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'],
    default: 'PRESENT'
  },
  working_hours: { type: Number, default: 0 },
  overtime_hours: { type: Number, default: 0 },
  verification_method: { type: String, default: 'GPS_BIOMETRIC' },
  distance_meters: { type: Number, default: 0 },
  remarks: { type: String, default: '' }
}, {
  timestamps: true
});

AttendanceSchema.index({ user_id: 1, date: 1 }, { unique: true });

export const AttendanceModel = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
