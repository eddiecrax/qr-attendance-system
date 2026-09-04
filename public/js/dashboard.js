// ─── Auth & API Helpers ──────────────────────────────────────────
const TOKEN = localStorage.getItem('token');
const USER = JSON.parse(localStorage.getItem('user') || '{}');
if (!TOKEN) window.location.href = '/';

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, ...opts.headers }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

function logout() { localStorage.clear(); window.location.href = '/'; }

// ─── Toast Notifications ─────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${type === 'success' ? '✅' : '❌'} ${msg}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ─── Modal Helpers ───────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('active'); });
});

// ─── Section Navigation ─────────────────────────────────────────
function showSection(name, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  document.querySelector('.sidebar').classList.remove('open');

  if (name === 'overview') loadStats();
  if (name === 'sessions') loadSessions();
  if (name === 'students') { loadStudents(); loadDepartments(); }
  if (name === 'reports') { loadReports(); loadReportFilters(); }
}

// ─── Overview / Stats ────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('/api/stats');
    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card"><div class="stat-icon purple">👥</div><div class="stat-value">${s.totalStudents}</div><div class="stat-label">Total Students</div></div>
      <div class="stat-card"><div class="stat-icon cyan">📅</div><div class="stat-value">${s.totalSessions}</div><div class="stat-label">Total Sessions</div></div>
      <div class="stat-card"><div class="stat-icon green">✅</div><div class="stat-value">${s.activeSessions}</div><div class="stat-label">Active Sessions</div></div>
      <div class="stat-card"><div class="stat-icon yellow">📊</div><div class="stat-value">${s.totalAttendance}</div><div class="stat-label">Total Records</div></div>
      <div class="stat-card"><div class="stat-icon red">📌</div><div class="stat-value">${s.todayAttendance}</div><div class="stat-label">Today's Records</div></div>
    `;

    const actEl = document.getElementById('recentActivity');
    if (s.recentAttendance && s.recentAttendance.length > 0) {
      actEl.innerHTML = s.recentAttendance.map(a => `
        <div class="activity-item">
          <div class="activity-dot"></div>
          <div>
            <div class="activity-text"><strong>${a.student_name}</strong> (${a.student_id}) marked present in <strong>${a.session_title}</strong></div>
            <div class="activity-time">${new Date(a.scanned_at).toLocaleString()}</div>
          </div>
        </div>
      `).join('');
    } else {
      actEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No activity yet. Create a session and start tracking!</p></div>';
    }
  } catch (err) { console.error(err); }
}

// ─── Sessions ────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const sessions = await api('/api/sessions');
    const tbody = document.getElementById('sessionsBody');
    const empty = document.getElementById('sessionsEmpty');

    if (sessions.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = sessions.map(s => {
      const expired = s.expires_at && new Date(s.expires_at) < new Date();
      const statusBadge = !s.is_active
        ? '<span class="badge badge-danger">Inactive</span>'
        : expired
          ? '<span class="badge badge-warning">Expired</span>'
          : '<span class="badge badge-success">Active</span>';

      return `<tr>
        <td style="color:var(--text-primary);font-weight:500">${s.title}</td>
        <td>${statusBadge}</td>
        <td><span class="badge badge-info">${s.attendance_count}</span></td>
        <td>${new Date(s.created_at).toLocaleDateString()}</td>
        <td>${s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="showQR(${s.id})" title="QR Code">📱</button>
            <button class="btn btn-ghost btn-sm" onclick="viewAttendance(${s.id})" title="View Attendance">👁️</button>
            <button class="btn btn-ghost btn-sm" onclick="toggleSession(${s.id})" title="Toggle Active">${s.is_active ? '⏸️' : '▶️'}</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteSession(${s.id})" title="Delete" style="color:var(--red)">🗑️</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function createSession() {
  const title = document.getElementById('sessTitle').value.trim();
  if (!title) return toast('Title is required', 'error');

  try {
    await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: document.getElementById('sessDesc').value.trim(),
        duration_minutes: parseInt(document.getElementById('sessDuration').value) || 0
      })
    });
    closeModal('sessionModal');
    document.getElementById('sessTitle').value = '';
    document.getElementById('sessDesc').value = '';
    document.getElementById('sessDuration').value = '60';
    toast('Session created!');
    loadSessions();
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleSession(id) {
  try { await api(`/api/sessions/${id}/toggle`, { method: 'PUT' }); loadSessions(); toast('Session updated'); } catch (err) { toast(err.message, 'error'); }
}

async function deleteSession(id) {
  if (!confirm('Delete this session and all its attendance records?')) return;
  try { await api(`/api/sessions/${id}`, { method: 'DELETE' }); loadSessions(); toast('Session deleted'); } catch (err) { toast(err.message, 'error'); }
}

// ─── QR Code ─────────────────────────────────────────────────────
let currentQR = {};

async function showQR(id) {
  try {
    const data = await api(`/api/sessions/${id}/qr`);
    currentQR = { ...data, sessionId: id };
    document.getElementById('qrImage').src = data.qr;
    document.getElementById('qrTitle').textContent = data.title;
    const urlEl = document.getElementById('qrUrl');
    if (urlEl) urlEl.textContent = data.url;

    // Show share button if Web Share API available
    if (navigator.share) document.getElementById('shareBtn').style.display = '';

    openModal('qrModal');
  } catch (err) { toast(err.message, 'error'); }
}

function downloadQR() {
  const a = document.createElement('a');
  a.href = currentQR.qr;
  a.download = `qr-${currentQR.title || 'session'}.png`;
  a.click();
  toast('QR code downloaded!');
}

function copyQRLink() {
  navigator.clipboard.writeText(currentQR.url).then(() => toast('Link copied to clipboard!'));
}

async function shareQR() {
  try {
    // Convert data URL to blob for sharing
    const res = await fetch(currentQR.qr);
    const blob = await res.blob();
    const file = new File([blob], `qr-${currentQR.title}.png`, { type: 'image/png' });

    await navigator.share({
      title: `QR Attendance: ${currentQR.title}`,
      text: `Scan this QR code to mark your attendance for "${currentQR.title}"`,
      url: currentQR.url,
      files: [file]
    });
    toast('Shared successfully!');
  } catch (err) {
    // Fallback: share without file
    try {
      await navigator.share({
        title: `QR Attendance: ${currentQR.title}`,
        text: `Mark your attendance: ${currentQR.url}`
      });
    } catch (e) { /* user cancelled */ }
  }
}

// ─── Session Attendance View ─────────────────────────────────────
let currentSessionAttendance = [];
let currentSessionTitle = '';

async function viewAttendance(id) {
  try {
    const data = await api(`/api/attendance/session/${id}`);
    currentSessionAttendance = data.attendance || [];
    currentSessionTitle = data.session ? data.session.title : 'Session';
    document.getElementById('attModalTitle').textContent = `Attendance — ${currentSessionTitle}`;

    if (currentSessionAttendance.length === 0) {
      document.getElementById('attModalBody').innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No attendance recorded yet for this session.</p></div>';
    } else {
      document.getElementById('attModalBody').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <p style="color:var(--text-muted);font-size:13px; margin:0;">
            📊 <strong>${currentSessionAttendance.length}</strong> participant(s) registered
          </p>
          <button class="btn btn-outline btn-sm" onclick="exportSessionCSV()">📥 Export Session CSV</button>
        </div>
        <table><thead><tr><th>Name</th><th>Email / Dept</th><th>Time Scanned</th><th>Status</th></tr></thead>
        <tbody>${currentSessionAttendance.map(a => `<tr>
          <td style="color:var(--text-primary); font-weight:500;">${a.student_name}</td>
          <td>${a.email || a.department || '—'}</td>
          <td>${new Date(a.scanned_at).toLocaleString()}</td>
          <td><span class="badge badge-success">Present</span></td>
        </tr>`).join('')}</tbody></table>`;
    }
    openModal('attendanceModal');
  } catch (err) { toast(err.message, 'error'); }
}

function exportSessionCSV() {
  if (currentSessionAttendance.length === 0) return toast('No data to export', 'error');
  const header = 'Name,Email/Department,Scanned Time,Status\n';
  const rows = currentSessionAttendance.map(a =>
    `"${a.student_name}","${a.email || a.department || ''}","${a.scanned_at}","Present"`
  ).join('\n');

  const blob = new Blob([header + rows], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance-${currentSessionTitle.replace(/[^a-z0-9]/gi, '_')}.csv`;
  a.click();
  toast('Session attendance exported!');
}

// ─── Students ────────────────────────────────────────────────────
async function loadStudents() {
  const search = document.getElementById('studentSearch').value.trim();
  const dept = document.getElementById('deptFilter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (dept) params.set('department', dept);

  try {
    const students = await api(`/api/students?${params}`);
    const tbody = document.getElementById('studentsBody');
    const empty = document.getElementById('studentsEmpty');

    if (students.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    tbody.innerHTML = students.map(s => `<tr>
      <td style="font-weight:500;color:var(--accent-light)">${s.student_id}</td>
      <td style="color:var(--text-primary)">${s.name}</td>
      <td>${s.email || '—'}</td>
      <td>${s.department || '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick='editStudent(${JSON.stringify(s)})'>✏️</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteStudent(${s.id})" style="color:var(--red)">🗑️</button>
      </td>
    </tr>`).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function clearStudentForm() {
  document.getElementById('editStudentId').value = '';
  document.getElementById('stuId').value = '';
  document.getElementById('stuName').value = '';
  document.getElementById('stuEmail').value = '';
  document.getElementById('stuDept').value = '';
  document.getElementById('studentModalTitle').textContent = 'Add Student';
}

function editStudent(s) {
  document.getElementById('editStudentId').value = s.id;
  document.getElementById('stuId').value = s.student_id;
  document.getElementById('stuName').value = s.name;
  document.getElementById('stuEmail').value = s.email || '';
  document.getElementById('stuDept').value = s.department || '';
  document.getElementById('studentModalTitle').textContent = 'Edit Student';
  openModal('studentModal');
}

async function saveStudent() {
  const editId = document.getElementById('editStudentId').value;
  const body = {
    student_id: document.getElementById('stuId').value.trim(),
    name: document.getElementById('stuName').value.trim(),
    email: document.getElementById('stuEmail').value.trim(),
    department: document.getElementById('stuDept').value.trim()
  };

  if (!body.student_id || !body.name) return toast('Student ID and name are required', 'error');

  try {
    if (editId) {
      await api(`/api/students/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Student updated!');
    } else {
      await api('/api/students', { method: 'POST', body: JSON.stringify(body) });
      toast('Student added!');
    }
    closeModal('studentModal');
    loadStudents();
    loadDepartments();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteStudent(id) {
  if (!confirm('Delete this student and their attendance records?')) return;
  try { await api(`/api/students/${id}`, { method: 'DELETE' }); loadStudents(); toast('Student deleted'); } catch (err) { toast(err.message, 'error'); }
}

function handleCSVFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { document.getElementById('csvData').value = ev.target.result; };
  reader.readAsText(file);
}

function downloadSampleCSV() {
  const sampleData = "student_id,name,email,department\nSTU001,John Doe,john@example.com,Computer Science\nSTU002,Jane Smith,jane@example.com,Cybersecurity\nSTU003,Alex Johnson,alex@example.com,Information Technology";
  const blob = new Blob([sampleData], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'students_sample_template.csv';
  a.click();
  toast('Sample CSV template downloaded!');
}

async function exportStudentsCSV() {
  try {
    const students = await api('/api/students');
    if (!students || students.length === 0) return toast('No students to export', 'error');
    const header = 'Student ID,Name,Email,Department,Created At\n';
    const rows = students.map(s => `"${s.student_id}","${s.name}","${s.email || ''}","${s.department || ''}","${s.created_at}"`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `students_list_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('Students exported to CSV!');
  } catch (err) { toast(err.message, 'error'); }
}

async function importCSV() {

  const raw = document.getElementById('csvData').value.trim();
  if (!raw) return toast('No data to import', 'error');

  const lines = raw.split('\n').filter(l => l.trim());
  const students = [];

  for (let line of lines) {
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    if (parts[0].toLowerCase() === 'student_id') continue; // skip header
    students.push({ student_id: parts[0], name: parts[1], email: parts[2] || '', department: parts[3] || '' });
  }

  if (students.length === 0) return toast('No valid entries found', 'error');

  try {
    const result = await api('/api/students/bulk', { method: 'POST', body: JSON.stringify({ students }) });
    closeModal('importModal');
    document.getElementById('csvData').value = '';
    toast(`Imported ${result.imported} of ${result.total} students!`);
    loadStudents();
    loadDepartments();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Departments ─────────────────────────────────────────────────
async function loadDepartments() {
  try {
    const depts = await api('/api/departments');
    const sel = document.getElementById('deptFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    sel.value = current;
  } catch (err) { /* ignore */ }
}

// ─── Reports ─────────────────────────────────────────────────────
let reportData = [];

async function loadReportFilters() {
  try {
    const depts = await api('/api/departments');
    const deptSel = document.getElementById('reportDept');
    deptSel.innerHTML = '<option value="">All Depts</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');

    const sessions = await api('/api/sessions');
    const sessSel = document.getElementById('reportSession');
    sessSel.innerHTML = '<option value="">All Sessions</option>' + sessions.map(s => `<option value="${s.id}">${s.title}</option>`).join('');
  } catch (err) { /* ignore */ }
}

async function loadReports() {
  const params = new URLSearchParams();
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  const dept = document.getElementById('reportDept').value;
  const sess = document.getElementById('reportSession').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (dept) params.set('department', dept);
  if (sess) params.set('session_id', sess);

  try {
    reportData = await api(`/api/reports?${params}`);
    const tbody = document.getElementById('reportsBody');
    const empty = document.getElementById('reportsEmpty');

    if (reportData.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    tbody.innerHTML = reportData.map(r => `<tr>
      <td style="font-weight:500;color:var(--accent-light)">${r.student_id}</td>
      <td style="color:var(--text-primary)">${r.student_name}</td>
      <td>${r.department || '—'}</td>
      <td>${r.session_title}</td>
      <td>${new Date(r.scanned_at).toLocaleString()}</td>
      <td><span class="badge badge-success">Present</span></td>
    </tr>`).join('');
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Export CSV ──────────────────────────────────────────────────
function exportCSV() {
  if (reportData.length === 0) return toast('No data to export', 'error');
  const header = 'Student ID,Name,Department,Email,Session,Date/Time,Status\n';
  const rows = reportData.map(r =>
    `"${r.student_id}","${r.student_name}","${r.department || ''}","${r.email || ''}","${r.session_title}","${r.scanned_at}","Present"`
  ).join('\n');

  const blob = new Blob([header + rows], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast('CSV exported!');
}

// ─── Export PDF (Simple) ─────────────────────────────────────────
function exportPDF() {
  if (reportData.length === 0) return toast('No data to export', 'error');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Attendance Report</title>
    <style>body{font-family:Arial,sans-serif;padding:30px;color:#333}
    h1{font-size:22px;margin-bottom:4px}
    p.sub{color:#666;margin-bottom:20px;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left}
    th{background:#f5f5f5;font-weight:600}
    .badge{background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:11px}
    @media print{body{padding:10px}}</style>
  </head><body>
    <h1>📋 Attendance Report</h1>
    <p class="sub">Generated: ${new Date().toLocaleString()} — ${reportData.length} record(s)</p>
    <table><thead><tr><th>Student ID</th><th>Name</th><th>Department</th><th>Session</th><th>Date/Time</th><th>Status</th></tr></thead>
    <tbody>${reportData.map(r => `<tr>
      <td>${r.student_id}</td><td>${r.student_name}</td><td>${r.department || '—'}</td>
      <td>${r.session_title}</td><td>${new Date(r.scanned_at).toLocaleString()}</td>
      <td><span class="badge">Present</span></td>
    </tr>`).join('')}</tbody></table>
    <script>setTimeout(()=>window.print(),500)<\/script>
  </body></html>`);
  win.document.close();
  toast('PDF ready for printing!');
}

// ─── Init ────────────────────────────────────────────────────────
document.getElementById('userName').textContent = USER.name || 'Admin';
document.getElementById('userAvatar').textContent = (USER.name || 'A')[0].toUpperCase();
loadStats();
