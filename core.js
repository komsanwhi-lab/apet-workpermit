// ================================================================
// APET CORE SYSTEM v3 — เชื่อม Google Apps Script จริง
// include ทุกหน้า: <script src="core.js"></script>
// ================================================================

const APET = (() => {

  const API = 'https://script.google.com/macros/s/AKfycbzGzsisnsQRVypgSwQP6XnjBqteucMgXD-k1cRT3mQEuWCY-XNrWZ49HcNtnEdr0aY3Sw/exec';
  const CACHE_KEY = 'apet_cache_v3';
  const TIMEOUT = 10000;

  // ===============================
  // STATUS DEFINITIONS
  // ===============================
  const STATUS = {
    PENDING_DEPT:    'รอแผนกที่ว่าจ้าง',
    PENDING_SAFETY:  'รอ จป.วิชาชีพ',
    PENDING_CHAIR:   'รอ ประธาน คปอ.',
    APPROVED:        'อนุมัติ',
    REJECTED:        'ไม่อนุมัติ',
    EXPIRED:         'หมดอายุ',
    CLOSED:          'ปิดงาน',
  };

  const STATUS_CONFIG = {
    [STATUS.PENDING_DEPT]:   { color: '#856404', bg: '#FFF3CD', icon: '🏢', next: 'dept' },
    [STATUS.PENDING_SAFETY]: { color: '#7C5CBF', bg: '#EAD7FF', icon: '🔍', next: 'inspector' },
    [STATUS.PENDING_CHAIR]:  { color: '#185FA5', bg: '#D6EAF8', icon: '👑', next: 'chairman' },
    [STATUS.APPROVED]:       { color: '#1E8449', bg: '#D5F5E3', icon: '✅', next: null },
    [STATUS.REJECTED]:       { color: '#96281B', bg: '#FADBD8', icon: '❌', next: null },
    [STATUS.EXPIRED]:        { color: '#5F6368', bg: '#F2F3F4', icon: '⏰', next: null },
    [STATUS.CLOSED]:         { color: '#2C3E50', bg: '#D5D8DC', icon: '🔒', next: null },
  };

  // ===============================
  // APPROVAL ROLES
  // ===============================
  const ROLES = {
    dept:      { label: 'แผนกที่ว่าจ้าง', icon: '🏢', color: '#2980B9', requires: [] },
    inspector: { label: 'จป.วิชาชีพ',    icon: '🔍', color: '#7C5CBF', requires: ['dept'] },
    chairman:  { label: 'ประธาน คปอ.',   icon: '✅', color: '#27AE60', requires: ['dept','inspector'] },
  };

  // ===============================
  // API CALLS
  // ===============================
  async function apiGet(params) {
    const url = API + '?' + new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', mode: 'cors' });
      clearTimeout(timer);
      return JSON.parse(await res.text());
    } catch(e) {
      clearTimeout(timer);
      throw e;
    }
  }

  async function apiPost(data) {
    try {
      await fetch(API, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return { success: true };
    } catch(e) {
      console.warn('POST error:', e);
      return { success: false, error: e.message };
    }
  }

  // ===============================
  // PERMIT OPERATIONS
  // ===============================

  // สร้างใบอนุญาตใหม่
  async function createPermit(formData) {
    const permitId = 'APET-' + new Date().getFullYear() + '-' + (Math.floor(Math.random()*9000)+1000);
    formData.permitId = permitId;
    formData.submittedAt = new Date().toLocaleString('th-TH');

    // ส่งผ่าน POST (no-cors)
    await apiPost(formData);
    return permitId;
  }

  // ดึงข้อมูลใบอนุญาต + approval state
  async function getPermit(permitId) {
    const json = await apiGet({ action: 'get_approval', id: permitId });
    if (!json.success) throw new Error(json.error || 'Failed to load permit');
    return {
      permit: json.permit,
      approval: json.approval || { dept: null, inspector: null, chairman: null },
    };
  }

  // ดึงรายการทั้งหมด
  async function listPermits() {
    const json = await apiGet({ action: 'list' });
    if (!json.success) throw new Error(json.error || 'Failed to list permits');
    return json.permits || [];
  }

  // ===============================
  // APPROVAL FLOW (LOCKED)
  // ===============================

  // ตรวจสอบว่าสามารถลงชื่อได้ไหม
  function canApprove(role, approval) {
    const required = ROLES[role]?.requires || [];
    for (const r of required) {
      if (!approval[r]) {
        return { ok: false, msg: `ต้องให้ ${ROLES[r].label} ลงชื่อก่อน` };
      }
    }
    return { ok: true };
  }

  // ลงชื่ออนุมัติ
  async function approvePermit(permitId, role, approvalData) {
    // Lock check ฝั่ง client ก่อน
    const { approval } = await getPermit(permitId);
    const check = canApprove(role, approval);
    if (!check.ok) throw new Error(check.msg);

    const payload = {
      permitId,
      role,
      name: approvalData.name,
      date: approvalData.date || new Date().toLocaleString('th-TH'),
      note: approvalData.note || '',
      savedAt: new Date().toLocaleString('th-TH'),
      finalStatus: determineStatus(role, approval),
    };

    return await apiPost(payload);
  }

  // คำนวณสถานะหลังอนุมัติ
  function determineStatus(role, currentApproval) {
    const newApproval = { ...currentApproval, [role]: { name: 'x' } };
    if (newApproval.dept && newApproval.inspector && newApproval.chairman) return STATUS.APPROVED;
    if (newApproval.dept && newApproval.inspector) return STATUS.PENDING_CHAIR;
    if (newApproval.dept) return STATUS.PENDING_SAFETY;
    return STATUS.PENDING_DEPT;
  }

  // ===============================
  // CHECKLIST
  // ===============================

  async function saveChecklist(permitId, phaseData) {
    return await apiPost({
      type: 'checklist_phase',
      permitId,
      ...phaseData,
      savedAt: new Date().toLocaleString('th-TH'),
    });
  }

  // ===============================
  // OVERTIME
  // ===============================

  async function requestOvertime(permitId, data) {
    return await apiPost({
      type: 'overtime_request',
      permitId,
      ...data,
      requestedAt: new Date().toLocaleString('th-TH'),
    });
  }

  // ===============================
  // CLOSE WORK
  // ===============================

  async function closePermit(permitId) {
    return await apiGet({ action: 'close_permit', id: permitId });
  }

  // ===============================
  // EXPIRE CHECK (client-side)
  // ===============================

  function isExpired(permit) {
    if ([STATUS.APPROVED, STATUS.CLOSED, STATUS.EXPIRED, STATUS.REJECTED].includes(permit.status)) return false;
    const dateEnd = permit.work_date_end || permit.work_date;
    const timeEnd = permit.time_end || '17:00';
    if (!dateEnd || !timeEnd) return false;
    // Parse as string to avoid timezone issues
    const [y, m, d] = dateEnd.split('-').map(Number);
    const [hh, mm] = timeEnd.split(':').map(Number);
    if (!y || !m || !d) return false;
    const expiry = new Date(y, m-1, d, hh, mm);
    return new Date() > expiry;
  }

  function getEffectiveStatus(permit) {
    if (isExpired(permit) && ![STATUS.APPROVED, STATUS.CLOSED, STATUS.REJECTED].includes(permit.status)) {
      return STATUS.EXPIRED;
    }
    return permit.status || STATUS.PENDING_DEPT;
  }

  // ===============================
  // UI HELPERS
  // ===============================

  function renderStatusBadge(status) {
    const cfg = STATUS_CONFIG[status] || { color: '#856404', bg: '#FFF3CD', icon: '⏳' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${cfg.bg};color:${cfg.color}">${cfg.icon} ${status}</span>`;
  }

  function renderApprovalSteps(approval) {
    return Object.entries(ROLES).map(([role, cfg]) => {
      const done = !!approval[role];
      return `<div style="flex:1;text-align:center;padding:8px 4px;background:${done?'#D5F5E3':'#F8F9FA'};border-right:1px solid #E8EAED">
        <div style="font-size:18px">${cfg.icon}</div>
        <div style="font-size:10px;font-weight:700;color:${done?'#1E8449':'#9AA0A6'}">${cfg.label}</div>
        <div style="font-size:9px;color:${done?'#1E8449':'#9AA0A6'}">${done ? '✓ '+approval[role].name : 'รอลงชื่อ'}</div>
      </div>`;
    }).join('');
  }

  function showToast(msg, type = '') {
    let toast = document.getElementById('apet-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'apet-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);padding:10px 20px;border-radius:8px;font-size:13px;font-family:Sarabun,sans-serif;z-index:9999;transition:transform .3s,opacity .3s;opacity:0;white-space:nowrap';
      document.body.appendChild(toast);
    }
    const colors = { error: '#C0392B', success: '#27AE60', warning: '#E67E22', '': '#202124' };
    toast.style.background = colors[type] || colors[''];
    toast.style.color = '#fff';
    toast.textContent = msg;
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.transform = 'translateX(-50%) translateY(80px)';
      toast.style.opacity = '0';
    }, 3000);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    // Return as-is if already formatted
    if (dateStr.includes('/') || dateStr.includes('น.')) return dateStr;
    try {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${parseInt(y)+543}`;
    } catch { return dateStr; }
  }

  function formatTime(timeStr) {
    if (!timeStr) return '—';
    // Already in HH:MM format
    if (/^\d{2}:\d{2}$/.test(timeStr)) return timeStr + ' น.';
    return timeStr;
  }

  // ===============================
  // LOCAL CACHE (fallback)
  // ===============================

  function cacheGet(key) {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY + '_' + key) || 'null'); } catch { return null; }
  }
  function cacheSet(key, data) {
    try { localStorage.setItem(CACHE_KEY + '_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  // ===============================
  // PUBLIC API
  // ===============================
  return {
    STATUS,
    STATUS_CONFIG,
    ROLES,
    // Permit CRUD
    createPermit,
    getPermit,
    listPermits,
    // Approval
    approvePermit,
    canApprove,
    determineStatus,
    // Checklist
    saveChecklist,
    // Overtime
    requestOvertime,
    // Close
    closePermit,
    // Expire
    isExpired,
    getEffectiveStatus,
    // UI
    renderStatusBadge,
    renderApprovalSteps,
    showToast,
    formatDate,
    formatTime,
    // Cache
    cacheGet,
    cacheSet,
    // Low-level
    apiGet,
    apiPost,
  };
})();
