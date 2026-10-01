import crypto from 'crypto';
import { db } from '../db.js';
import { calculateDistanceMeters } from '../utils/geo.js';

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Pings and updates the employee's live GPS coordinates, battery, and address
 * POST /api/tracking/live-location
 */
export function updateLiveLocation(req, res) {
  try {
    const userId = req.user.id;
    const { latitude, longitude, accuracy, address, batteryLevel, isCharging } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude coordinates are required' });
    }

    const today = getLocalDateString();
    const attendance = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today);
    const isCheckedIn = !!(attendance && attendance.check_in_time && !attendance.check_out_time);

    // Upsert into live_tracking
    const existing = db.prepare('SELECT * FROM live_tracking WHERE user_id = ?').get(userId);

    if (existing) {
      db.prepare(`
        UPDATE live_tracking SET
          employee_code = ?,
          employee_name = ?,
          department = ?,
          role = ?,
          latitude = ?,
          longitude = ?,
          accuracy = ?,
          address = COALESCE(?, address),
          battery_level = COALESCE(?, battery_level),
          is_charging = COALESCE(?, is_charging),
          is_checked_in = ?,
          check_in_time = COALESCE(?, check_in_time),
          attendance_id = COALESCE(?, attendance_id),
          last_location_time = CURRENT_TIMESTAMP,
          last_ping_time = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(
        req.user.employee_code || null,
        req.user.full_name || null,
        req.user.department || null,
        req.user.role || null,
        latitude,
        longitude,
        accuracy || 10,
        address || null,
        batteryLevel !== undefined ? batteryLevel : null,
        isCharging ? 1 : 0,
        isCheckedIn ? 1 : 0,
        attendance ? attendance.check_in_time : null,
        attendance ? attendance.id : null,
        userId
      );
    } else {
      db.prepare(`
        INSERT INTO live_tracking (
          user_id, employee_code, employee_name, department, role,
          latitude, longitude, accuracy, address,
          battery_level, is_charging,
          is_checked_in, check_in_time, attendance_id,
          last_location_time, last_ping_time, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        userId,
        req.user.employee_code || null,
        req.user.full_name || null,
        req.user.department || null,
        req.user.role || null,
        latitude,
        longitude,
        accuracy || 10,
        address || null,
        batteryLevel !== undefined ? batteryLevel : null,
        isCharging ? 1 : 0,
        isCheckedIn ? 1 : 0,
        attendance ? attendance.check_in_time : null,
        attendance ? attendance.id : null
      );
    }

    // Save tracking history waypoint if moved > 20m or first point
    let shouldRecordHistory = true;
    const lastHistory = db.prepare('SELECT * FROM live_tracking_history WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1').get(userId);
    if (lastHistory) {
      const dist = calculateDistanceMeters(lastHistory.latitude, lastHistory.longitude, latitude, longitude);
      if (dist < 15) {
        shouldRecordHistory = false;
      }
    }

    if (shouldRecordHistory) {
      db.prepare(`
        INSERT INTO live_tracking_history (id, user_id, employee_code, latitude, longitude, accuracy)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `lth-${crypto.randomUUID()}`,
        userId,
        req.user.employee_code || '',
        latitude,
        longitude,
        accuracy || 10
      );
    }

    res.json({
      success: true,
      isCheckedIn,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in updateLiveLocation:', err);
    res.status(500).json({ error: 'Failed to update live location', details: err.message });
  }
}

/**
 * Uploads a live camera snapshot frame
 * POST /api/tracking/camera-feed
 */
export function updateCameraFeed(req, res) {
  try {
    const userId = req.user.id;
    const { cameraFrame, cameraStatus, facingMode } = req.body;

    if (!cameraFrame && cameraStatus !== 'PAUSED_BACKGROUND') {
      return res.status(400).json({ error: 'cameraFrame is required' });
    }

    const today = getLocalDateString();
    const attendance = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, today);
    const isCheckedIn = !!(attendance && attendance.check_in_time && !attendance.check_out_time);

    const existing = db.prepare('SELECT user_id FROM live_tracking WHERE user_id = ?').get(userId);

    if (existing) {
      db.prepare(`
        UPDATE live_tracking SET
          camera_frame = COALESCE(?, camera_frame),
          camera_status = ?,
          camera_timestamp = CURRENT_TIMESTAMP,
          last_ping_time = CURRENT_TIMESTAMP,
          is_checked_in = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(
        cameraFrame || null,
        cameraStatus || 'LIVE',
        isCheckedIn ? 1 : 0,
        userId
      );
    } else {
      db.prepare(`
        INSERT INTO live_tracking (
          user_id, employee_code, employee_name, department, role,
          camera_frame, camera_status, camera_timestamp,
          is_checked_in, check_in_time, attendance_id,
          last_ping_time, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        userId,
        req.user.employee_code || null,
        req.user.full_name || null,
        req.user.department || null,
        req.user.role || null,
        cameraFrame || null,
        cameraStatus || 'LIVE',
        isCheckedIn ? 1 : 0,
        attendance ? attendance.check_in_time : null,
        attendance ? attendance.id : null
      );
    }

    res.json({
      success: true,
      status: cameraStatus || 'LIVE',
      receivedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in updateCameraFeed:', err);
    res.status(500).json({ error: 'Failed to update camera feed', details: err.message });
  }
}

/**
 * HR / Admin endpoint to view all currently active & checked-in employees
 * with their latest camera feed, live GPS location, and distance from office.
 * GET /api/tracking/live-employees
 */
export function getLiveEmployees(req, res) {
  try {
    const today = getLocalDateString();
    const office = db.prepare('SELECT * FROM office_locations WHERE is_active = 1 LIMIT 1').get();

    // Query active users who have checked in today and haven't checked out
    const activeStaff = db.prepare(`
      SELECT 
        u.id as user_id,
        u.employee_code,
        u.full_name,
        u.email,
        u.phone,
        u.department,
        u.designation,
        u.role,
        a.id as attendance_id,
        a.date,
        a.check_in_time,
        a.check_out_time,
        a.check_in_photo,
        a.verification_method,
        a.distance_meters as check_in_distance,
        lt.latitude,
        lt.longitude,
        lt.accuracy,
        lt.address,
        lt.camera_frame,
        lt.camera_timestamp,
        lt.camera_status,
        lt.battery_level,
        lt.is_charging,
        lt.last_location_time,
        lt.last_ping_time
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN live_tracking lt ON u.id = lt.user_id
      WHERE a.date = ?
        AND a.check_in_time IS NOT NULL
        AND a.check_out_time IS NULL
      ORDER BY lt.last_ping_time DESC, a.check_in_time DESC
    `).all(today);

    const now = Date.now();

    const employeesWithMeta = activeStaff.map(emp => {
      // Calculate distance to office if coordinates available
      let currentDistanceMeters = null;
      let isInsideGeofence = false;

      const lat = emp.latitude !== null && emp.latitude !== undefined ? emp.latitude : null;
      const lng = emp.longitude !== null && emp.longitude !== undefined ? emp.longitude : null;

      if (office && lat !== null && lng !== null) {
        currentDistanceMeters = Math.round(calculateDistanceMeters(lat, lng, office.latitude, office.longitude));
        const radius = office.radius_meters || 150;
        isInsideGeofence = currentDistanceMeters <= radius;
      }

      // Check freshness of ping
      let connectionStatus = 'OFFLINE';
      let secondsSincePing = 99999;
      if (emp.last_ping_time) {
        const pingTime = new Date(emp.last_ping_time).getTime();
        secondsSincePing = Math.round((now - pingTime) / 1000);
        if (secondsSincePing <= 30) {
          connectionStatus = emp.camera_status === 'LIVE' ? 'LIVE_STREAMING' : 'ONLINE';
        } else if (secondsSincePing <= 90) {
          connectionStatus = 'IDLE';
        } else {
          connectionStatus = 'AWAY';
        }
      }

      // Working duration
      let shiftMinutes = 0;
      if (emp.check_in_time) {
        const checkInDate = new Date(emp.check_in_time).getTime();
        shiftMinutes = Math.max(0, Math.round((now - checkInDate) / 60000));
      }

      return {
        userId: emp.user_id,
        employeeCode: emp.employee_code,
        fullName: emp.full_name,
        email: emp.email,
        phone: emp.phone,
        department: emp.department,
        designation: emp.designation,
        checkInTime: emp.check_in_time,
        checkInPhoto: emp.check_in_photo,
        shiftMinutes,
        latitude: lat,
        longitude: lng,
        accuracy: emp.accuracy,
        address: emp.address,
        currentDistanceMeters,
        isInsideGeofence,
        cameraFrame: emp.camera_frame,
        cameraTimestamp: emp.camera_timestamp,
        cameraStatus: emp.camera_status || 'INACTIVE',
        batteryLevel: emp.battery_level,
        isCharging: Boolean(emp.is_charging),
        lastPingTime: emp.last_ping_time,
        secondsSincePing,
        connectionStatus
      };
    });

    res.json({
      success: true,
      office,
      summary: {
        totalCheckedIn: employeesWithMeta.length,
        liveStreaming: employeesWithMeta.filter(e => e.connectionStatus === 'LIVE_STREAMING').length,
        onlineGps: employeesWithMeta.filter(e => e.latitude !== null).length
      },
      employees: employeesWithMeta
    });
  } catch (err) {
    console.error('Error in getLiveEmployees:', err);
    res.status(500).json({ error: 'Failed to retrieve live employees', details: err.message });
  }
}

/**
 * Retrieves coordinate trail for a specific employee today
 * GET /api/tracking/history/:userId
 */
export function getEmployeeTrackingHistory(req, res) {
  try {
    const { userId } = req.params;
    const history = db.prepare(`
      SELECT latitude, longitude, accuracy, recorded_at
      FROM live_tracking_history
      WHERE user_id = ?
        AND date(recorded_at) = date('now', 'localtime')
      ORDER BY recorded_at ASC
    `).all(userId);

    res.json({
      success: true,
      userId,
      history
    });
  } catch (err) {
    console.error('Error in getEmployeeTrackingHistory:', err);
    res.status(500).json({ error: 'Failed to retrieve tracking history', details: err.message });
  }
}

/**
 * Stops live tracking session for employee (called on check-out or explicit stop)
 * POST /api/tracking/stop-session
 */
export function stopTrackingSession(req, res) {
  try {
    const userId = req.user.id;
    db.prepare(`
      UPDATE live_tracking SET
        is_checked_in = 0,
        camera_status = 'OFFLINE_CHECKED_OUT',
        last_ping_time = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userId);

    res.json({ success: true, message: 'Live tracking session concluded' });
  } catch (err) {
    console.error('Error in stopTrackingSession:', err);
    res.status(500).json({ error: 'Failed to stop tracking session', details: err.message });
  }
}
