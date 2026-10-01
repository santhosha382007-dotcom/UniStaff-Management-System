import mongoose from 'mongoose';

export const OfficeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  radius_meters: { type: Number, required: true, default: 200 },
  address: { type: String, default: '' },
  is_active: { type: Boolean, default: true }
}, {
  timestamps: true
});

export const OfficeModel = mongoose.models.Office || mongoose.model('Office', OfficeSchema);
