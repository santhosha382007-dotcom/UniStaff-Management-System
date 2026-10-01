import crypto from 'crypto';
import { db } from '../db.js';
import { isWithinGeofence, calculateDistanceMeters } from '../utils/geo.js';

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function checkIn(req, res) {
  const userId = req.user.id;
  const { latitude, longitude, photo, verificationMethod, remarks, bypassGeofence } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'Latitude and longitude coordinates are required for attendance' });
  }

  const today = getLocalDateString();
  const existing = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today);

  if (existing && existing.check_in_time) {
    return res.status(400).json({
      error: 'You have already checked in today',
      attendance: existing
    });
  }

  // Get active office location
  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();
  let distanceMeters = 0;
  const inRangeRadius = office ? (office.radius_meters || 150) : 150;
  let isInside = true;

  if (office) {
    const geoResult = isWithinGeofence(latitude, longitude, office.latitude, office.longitude, inRangeRadius);
    distanceMeters = geoResult.distanceMeters;
    isInside = distanceMeters <= inRangeRadius; // In range within company radius (150m)

    // If employee is NOT within company radius, selfie photo is strictly required!
    if (!isInside && !photo && !bypassGeofence) {
      return res.status(403).json({
        error: `You are ${Math.round(distanceMeters)}m away from ${office.name}. Because you are not within 150 meters of the company, a geotagged selfie photo with location and timestamp is required to check in.`,
        requiresPhoto: true,
        distanceMeters,
        allowedRadiusMeters: inRangeRadius,
        officeCoordinates: { latitude: office.latitude, longitude: office.longitude }
      });
    }
  }

  const now = new Date();
  const checkInTime = now.toISOString();

  // Determine if late (e.g. standard shift 09:15 AM threshold)
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const isLate = (currentHour > 9) || (currentHour === 9 && currentMinute > 15);
  const status = isLate ? 'LATE' : 'PRESENT';

  const attId = `att-${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO attendance (
      id, user_id, date, check_in_time, check_in_lat, check_in_lng,
      check_in_photo, status, verification_method, distance_meters, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attId,
    userId,
    today,
    checkInTime,
    latitude,
    longitude,
    photo || null,
    status,
    verificationMethod || (isInside ? 'GPS_BIOMETRIC' : 'GPS_SELFIE_WATERMARK'),
    distanceMeters,
    remarks || (isInside ? `Checked in within office bounds (<=${inRangeRadius}m)` : `Remote check-in (${Math.round(distanceMeters)}m away) with geotagged selfie photo`)
  );

  const created = db.prepare('SELECT * FROM attendance WHERE id = ?').get(attId);

  // Initialize / Activate Live Tracking for this shift
  try {
    const existingTracking = db.prepare('SELECT user_id FROM live_tracking WHERE user_id = ?').get(userId);
    if (existingTracking) {
      db.prepare(`
        UPDATE live_tracking SET
          is_checked_in = 1,
          check_in_time = ?,
          attendance_id = ?,
          latitude = ?,
          longitude = ?,
          camera_status = 'STARTING',
          last_location_time = CURRENT_TIMESTAMP,
          last_ping_time = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(checkInTime, attId, latitude, longitude, userId);
    } else {
      db.prepare(`
        INSERT INTO live_tracking (
          user_id, employee_code, employee_name, department, role,
          latitude, longitude, is_checked_in, check_in_time, attendance_id,
          camera_status, last_location_time, last_ping_time, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'STARTING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        userId,
        req.user.employee_code || null,
        req.user.full_name || null,
        req.user.department || null,
        req.user.role || null,
        latitude,
        longitude,
        checkInTime,
        attId
      );
    }
  } catch (trackErr) {
    console.error('Error activating live tracking on checkIn:', trackErr);
  }

  res.status(201).json({
    message: isLate ? 'Checked in (marked as Late)' : 'Checked in successfully! Welcome to work.',
    attendance: created,
    distanceMeters
  });
}

export function checkOut(req, res) {
  const userId = req.user.id;
  const { latitude, longitude, remarks } = req.body;

  const today = getLocalDateString();
  const att = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today);

  if (!att) {
    return res.status(404).json({ error: 'No check-in record found for today. Please check in first.' });
  }

  if (att.check_out_time) {
    return res.status(400).json({ error: 'You have already checked out today', attendance: att });
  }

  const now = new Date();
  const checkOutTime = now.toISOString();
  const inDate = new Date(att.check_in_time);
  const durationMs = now.getTime() - inDate.getTime();
  const workingHours = Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100;

  // Determine half-day or overtime
  let finalStatus = att.status;
  if (workingHours < 4.5 && att.status !== 'HALF_DAY') {
    finalStatus = 'HALF_DAY';
  }

  const overtimeHours = workingHours > 8 ? Math.round((workingHours - 8) * 100) / 100 : 0;

  db.prepare(`
    UPDATE attendance SET
      check_out_time = ?,
      check_out_lat = ?,
      check_out_lng = ?,
      working_hours = ?,
      overtime_hours = ?,
      status = ?,
      remarks = COALESCE(?, remarks)
    WHERE id = ?
  `).run(
    checkOutTime,
    latitude || att.check_in_lat,
    longitude || att.check_in_lng,
    workingHours,
    overtimeHours,
    finalStatus,
    remarks || null,
    att.id
  );

  const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(att.id);

  // Conclude Live Tracking for this shift
  try {
    db.prepare(`
      UPDATE live_tracking SET
        is_checked_in = 0,
        camera_status = 'OFFLINE_CHECKED_OUT',
        last_ping_time = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userId);
  } catch (trackErr) {
    console.error('Error concluding live tracking on checkOut:', trackErr);
  }

  res.json({
    message: 'Checked out successfully. Have a great evening!',
    attendance: updated,
    workingHours,
    overtimeHours
  });
}

export function getTodayStatus(req, res) {
  const userId = req.user.id;
  const today = getLocalDateString();

  const record = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today);
  const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();

  res.json({
    date: today,
    isCheckedIn: !!(record && record.check_in_time),
    isCheckedOut: !!(record && record.check_out_time),
    attendance: record || null,
    office
  });
}

export function getMyHistory(req, res) {
  const userId = req.user.id;
  const { month } = req.query; // Format: YYYY-MM

  let query = 'SELECT * FROM attendance WHERE user_id = ?';
  const params = [userId];

  if (month) {
    query += ' AND date LIKE ?';
    params.push(`${month}%`);
  }

  query += ' ORDER BY date DESC LIMIT 60';

  const records = db.prepare(query).all(...params);

  // Summary statistics
  const summary = {
    totalRecords: records.length,
    present: records.filter(r => r.status === 'PRESENT').length,
    late: records.filter(r => r.status === 'LATE').length,
    halfDay: records.filter(r => r.status === 'HALF_DAY').length,
    totalOvertimeHours: records.reduce((acc, r) => acc + (r.overtime_hours || 0), 0)
  };

  res.json({ records, summary });
}

export function getAllAttendance(req, res) {
  const { date, department, status } = req.query;

  let query = `
    SELECT a.*, u.full_name, u.employee_code, u.department, u.designation
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (date) {
    query += ' AND a.date = ?';
    params.push(date);
  }
  if (department) {
    query += ' AND u.department = ?';
    params.push(department);
  }
  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY a.date DESC, a.check_in_time DESC LIMIT 150';

  const records = db.prepare(query).all(...params);

  // Quick stats for today
  const today = getLocalDateString();
  const todayRecords = db.prepare(`
    SELECT a.status, count(*) as count
    FROM attendance a
    WHERE a.date = ?
    GROUP BY a.status
  `).all(today);

  const totalEmployees = db.prepare("SELECT count(*) as count FROM users WHERE status = 'ACTIVE' AND role = 'EMPLOYEE'").get().count;

  res.json({
    records,
    stats: {
      date: date || today,
      totalEmployees,
      todayBreakdown: todayRecords
    }
  });
}

export function manualOverride(req, res) {
  const { id } = req.params;
  const { status, working_hours, remarks } = req.body;

  const existing = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Attendance record not found' });
  }

  db.prepare(`
    UPDATE attendance SET
      status = COALESCE(?, status),
      working_hours = COALESCE(?, working_hours),
      remarks = COALESCE(?, remarks) || ' [HR Override by ' || ? || ']'
    WHERE id = ?
  `).run(
    status || null,
    working_hours !== undefined ? working_hours : null,
    remarks ? `${remarks} ` : '',
    req.user.full_name,
    id
  );

  const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  res.json({ message: 'Attendance updated by HR/Admin', record: updated });
}

export function manualEntry(req, res) {
  const {
    user_id,
    date,
    status = 'PRESENT',
    check_in_time,
    check_out_time,
    working_hours = 8,
    remarks
  } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }

  const employee = db.prepare('SELECT id, full_name, employee_code, department FROM users WHERE id = ?').get(user_id);
  if (!employee) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const targetDate = date || new Date().toISOString().split('T')[0];
  const adminName = req.user?.full_name || 'HR Admin';

  const defaultInTime = check_in_time
    ? (check_in_time.includes('T') ? check_in_time : `${targetDate}T${check_in_time}:00.000Z`)
    : `${targetDate}T09:00:00.000Z`;

  const defaultOutTime = check_out_time
    ? (check_out_time.includes('T') ? check_out_time : `${targetDate}T${check_out_time}:00.000Z`)
    : `${targetDate}T18:00:00.000Z`;

  const note = remarks
    ? `${remarks} (Offline/No Network Spot - Verified by ${adminName})`
    : `Manual entry by HR: ${adminName} (Employee in No Network Spot)`;

  // Check if attendance already exists for this employee on this date
  const existing = db.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').get(user_id, targetDate);

  let recordId;
  if (existing) {
    recordId = existing.id;
    db.prepare(`
      UPDATE attendance SET
        status = ?,
        check_in_time = ?,
        check_out_time = ?,
        working_hours = ?,
        verification_method = 'HR_MANUAL_NO_NETWORK',
        remarks = ?
      WHERE id = ?
    `).run(
      status,
      defaultInTime,
      defaultOutTime,
      parseFloat(working_hours) || 8.0,
      note,
      recordId
    );
  } else {
    recordId = `att-manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO attendance (
        id, user_id, date, check_in_time, check_out_time,
        status, working_hours, verification_method, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'HR_MANUAL_NO_NETWORK', ?)
    `).run(
      recordId,
      user_id,
      targetDate,
      defaultInTime,
      defaultOutTime,
      status,
      parseFloat(working_hours) || 8.0,
      note
    );
  }

  const savedRecord = db.prepare(`
    SELECT a.*, u.full_name, u.employee_code, u.department
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    WHERE a.id = ?
  `).get(recordId);

  res.status(201).json({
    message: `Attendance marked successfully for ${employee.full_name} (${employee.employee_code})`,
    attendance: savedRecord
  });
}
