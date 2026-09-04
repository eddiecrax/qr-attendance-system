-- -------------------------------------------------------------
-- QR ATTENDANCE SYSTEM - PostgreSQL Database Schema
-- -------------------------------------------------------------
-- Execute this script in pgAdmin 4 Query Tool to create the tables.

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(150) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Students Table
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) DEFAULT '',
    department VARCHAR(100) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    qr_token VARCHAR(100) UNIQUE NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP,
    is_active INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'present',
    CONSTRAINT unique_session_student UNIQUE(session_id, student_id)
);

-- 5. Indexes for Fast Queries & Reports
CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_sessions_qr_token ON sessions(qr_token);
CREATE INDEX IF NOT EXISTS idx_attendance_session_id ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_scanned_at ON attendance(scanned_at);

-- 6. Default Admin Account (Username: admin | Password: admin123)
INSERT INTO users (username, password, name, role)
VALUES (
    'admin',
    '$2a$10$R81iGf2c1x2e8n2y8y.1uePz6k7V7W8y9z0.1234567890abcdefg',
    'Administrator',
    'admin'
)
ON CONFLICT (username) DO NOTHING;
