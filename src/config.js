import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'unitedsoft-super-secret-jwt-key-2026',
  DB_PATH: path.join(__dirname, '../data/attendance.sqlite'),
  DEFAULT_OFFICE: {
    id: 'off-main-01',
    name: 'UnitedSoft Headquarters',
    latitude: 12.9716, // Default office lat (can be updated or set by admin)
    longitude: 77.5946, // Default office lng
    radius_meters: 150, // 150 meter geofence radius
    address: 'UnitedSoft Tower, Tech Park Road, Bengaluru'
  }
};
