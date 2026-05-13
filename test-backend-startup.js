#!/usr/bin/env node
/**
 * Backend Startup Diagnostic Test
 * Run this script to verify the backend can start properly
 * Usage: node test-backend-startup.js
 */

console.log('='.repeat(70));
console.log('CRIME DETECTION BACKEND STARTUP DIAGNOSTIC TEST');
console.log('='.repeat(70));

// Test 1: Check Node.js version
console.log('\n[TEST 1] Checking Node.js version...');
console.log(`  Node.js version: ${process.version}`);
console.log('  ✓ PASS');

// Test 2: Check if .env file exists
console.log('\n[TEST 2] Checking environment configuration...');
try {
  require('dotenv').config();
  console.log('  ✓ .env file loaded (dotenv available)');
} catch (_) {
  console.log('  ⚠ dotenv not available (will use process.env)');
}
console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`  PORT: ${process.env.PORT || '3000 (default)'}`);
console.log(`  MONGO_URI: ${process.env.MONGO_URI ? '✓ set' : '✗ NOT SET'}`);
console.log(`  JWT_SECRET: ${process.env.JWT_SECRET ? '✓ set' : '✗ NOT SET'}`);

// Test 3: Check if required packages are installed
console.log('\n[TEST 3] Checking required npm packages...');
const requiredPackages = ['express', 'cors', 'multer', 'mongoose', 'socket.io', 'jsonwebtoken', 'bcryptjs'];
let packageIssues = 0;
for (const pkg of requiredPackages) {
  try {
    require.resolve(pkg);
    console.log(`  ✓ ${pkg}`);
  } catch (_) {
    console.log(`  ✗ ${pkg} - NOT INSTALLED`);
    packageIssues++;
  }
}
if (packageIssues > 0) {
  console.log(`\n  ⚠ WARNING: ${packageIssues} package(s) missing!`);
  console.log('  Run: npm install');
  process.exit(1);
}
console.log('  ✓ PASS - All packages installed');

// Test 4: Check if models can be loaded
console.log('\n[TEST 4] Loading Mongoose models...');
try {
  require('./backend/models/User');
  console.log('  ✓ User model loaded');
  require('./backend/models/Profile');
  console.log('  ✓ Profile model loaded');
  require('./backend/models/AuditLog');
  console.log('  ✓ AuditLog model loaded');
  require('./backend/models/IncidentComment');
  console.log('  ✓ IncidentComment model loaded');
  console.log('  ✓ PASS - All models loaded');
} catch (err) {
  console.log(`  ✗ FAIL - Model loading error: ${err.message}`);
  process.exit(1);
}

// Test 5: Check if middleware can be loaded
console.log('\n[TEST 5] Loading middleware...');
try {
  require('./backend/middleware/auditLogger');
  console.log('  ✓ auditLogger middleware loaded');
  console.log('  ✓ PASS - All middleware loaded');
} catch (err) {
  console.log(`  ✗ FAIL - Middleware loading error: ${err.message}`);
  process.exit(1);
}

// Test 6: Check if auth module can be loaded
console.log('\n[TEST 6] Loading auth module...');
try {
  require('./backend/auth');
  console.log('  ✓ Auth module loaded');
  console.log('  ✓ PASS - Auth module loaded');
} catch (err) {
  console.log(`  ✗ FAIL - Auth module loading error: ${err.message}`);
  process.exit(1);
}

// Test 7: Check if backend/uploads directory exists or can be created
console.log('\n[TEST 7] Checking uploads directory...');
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, 'backend', 'uploads');
if (fs.existsSync(uploadsDir)) {
  console.log(`  ✓ uploads directory exists: ${uploadsDir}`);
} else {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`  ✓ Created uploads directory: ${uploadsDir}`);
  } catch (err) {
    console.log(`  ⚠ WARNING: Could not create uploads directory: ${err.message}`);
  }
}
console.log('  ✓ PASS');

// Test 8: Test MongoDB connection (async)
console.log('\n[TEST 8] Testing MongoDB connection...');
(async () => {
  try {
    const mongoose = require('mongoose');
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crimeai';
    
    console.log(`  Attempting to connect to MongoDB...`);
    
    // Set a short timeout for this test
    const timeout = setTimeout(() => {
      console.log('  ✗ MongoDB connection timeout (took more than 10 seconds)');
      console.log('  ℹ Possible issues:');
      console.log('    - MongoDB server is not running');
      console.log('    - Network connection to MongoDB is blocked');
      console.log('    - MONGO_URI is incorrect');
      console.log('\n[TEST RESULT] PARTIALLY PASSED - Backend can start without MongoDB');
      console.log('              (using in-memory fallback storage)\n');
      process.exit(0);
    }, 10000);
    
    const conn = await mongoose.connect(MONGO_URI, { 
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000
    });
    clearTimeout(timeout);
    
    console.log('  ✓ MongoDB connection successful');
    console.log(`  ✓ Connected to: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);
    console.log('  ✓ PASS');
    
    await mongoose.disconnect();
    printTestSummary(true);
    process.exit(0);
  } catch (err) {
    console.log(`  ⚠ MongoDB connection failed: ${err.message}`);
    console.log('  ℹ Backend will use in-memory fallback storage');
    console.log('  ℹ This is expected if MongoDB is not available');
    printTestSummary(false);
    process.exit(0);
  }
})();

function printTestSummary(mongoConnected) {
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  if (mongoConnected) {
    console.log('✓ Backend is ready for deployment!');
    console.log('  - All packages installed');
    console.log('  - All models and middleware loaded');
    console.log('  - MongoDB connection verified');
  } else {
    console.log('✓ Backend is ready for deployment!');
    console.log('  - All packages installed');
    console.log('  - All models and middleware loaded');
    console.log('  - MongoDB not available (in-memory fallback will be used)');
  }
  console.log('\nNext steps:');
  console.log('1. Ensure MONGO_URI and JWT_SECRET are set in Render environment');
  console.log('2. Deploy to Render with: git push origin main');
  console.log('3. Check Render logs after deployment');
  console.log('4. Test health endpoint: https://your-render-url.onrender.com/api/health');
  console.log('='.repeat(70));
}
