import { db } from '../db.js';

export function getOfficeLocations(req, res) {
  const offices = db.prepare('SELECT * FROM office_locations ORDER BY is_active DESC').all();
  res.json({ offices });
}

export function updateOfficeLocation(req, res) {
  const { id } = req.params;
  const { name, latitude, longitude, radius_meters, address } = req.body;

  const existing = db.prepare('SELECT * FROM office_locations WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Office location not found' });
  }

  db.prepare(`
    UPDATE office_locations SET
      name = COALESCE(?, name),
      latitude = COALESCE(?, latitude),
      longitude = COALESCE(?, longitude),
      radius_meters = COALESCE(?, radius_meters),
      address = COALESCE(?, address)
    WHERE id = ?
  `).run(
    name || null,
    latitude !== undefined ? parseFloat(latitude) : null,
    longitude !== undefined ? parseFloat(longitude) : null,
    radius_meters !== undefined ? parseFloat(radius_meters) : null,
    address || null,
    id
  );

  const updated = db.prepare('SELECT * FROM office_locations WHERE id = ?').get(id);
  res.json({ message: 'Office geofence settings updated successfully', office: updated });
}

export function setOfficeToCurrentLocation(req, res) {
  const { latitude, longitude, radius_meters } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  const office = db.prepare('SELECT id FROM office_locations WHERE is_active = 1 LIMIT 1').get();
  if (office) {
    db.prepare(`
      UPDATE office_locations SET
        latitude = ?,
        longitude = ?,
        radius_meters = COALESCE(?, radius_meters)
      WHERE id = ?
    `).run(parseFloat(latitude), parseFloat(longitude), radius_meters ? parseFloat(radius_meters) : null, office.id);
  }

  const updated = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();
  res.json({
    message: 'Office geofence synced to specified coordinates',
    office: updated
  });
}
