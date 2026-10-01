import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDatabase } from './db.js';
import apiRouter from './routes/api.js';

const app = express();

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// HTTP Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Root Welcome & Status
app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'UnitedSoft Attendance & Payroll API',
    endpoints: {
      health: '/api/health',
      demoAccounts: '/api/auth/demo-accounts',
      routes: '/api'
    },
    timestamp: new Date().toISOString()
  });
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'UnitedSoft Attendance & Payroll API',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Mount Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// Initialize database & Start Server
try {
  initDatabase();
  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  UnitedSoft Attendance & Payroll Backend Server`);
    console.log(`  Listening on: http://localhost:${config.PORT}`);
    console.log(`  Network:      http://0.0.0.0:${config.PORT}`);
    console.log(`  Health Check: http://localhost:${config.PORT}/api/health`);
    console.log(`=======================================================`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}
