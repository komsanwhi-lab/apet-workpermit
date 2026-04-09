// ================================================================
// APET CORE SYSTEM v4 — GAS backend + Role dashboard + QR deep link
// include ทุกหน้า: <script src="core.js"></script>
// ================================================================

const APET = (() => {
  const API = 'https://script.google.com/macros/s/AKfycbzGzsisnsQRVypgSwQP6XnjBqteucMgXD-k1cRT3mQEuWCY-XNrWZ49HcNtnEdr0aY3Sw/exec';
  const CACHE_KEY = 'apet_cache_v4';
  const TIMEOUT = 12000;

  const STATUS = {
    PENDING_DEPT: 'รอแผนกที่ว่าจ้าง',
    PENDING_SAFETY: 'รอ จป.วิชาชีพ',
    PENDING_CHAIR: 'รอ ประธาน คปอ.',
    APPROVED: 'อนุมัติ',
    REJECTED: 'ไม่อนุมัติ',
    EXPIRED: 'หมดอายุ',
    CLOSED: 'ปิดงาน',
  };

  const STATUS_CONFIG = {
    [STATUS.PENDING_DEPT]: { color: '#856404', bg: '#FFF3CD', icon: '🏢', next: 'dept' },
    [STATUS.PENDING_SAFETY]: { color: '#7C5CBF', bg: '#EAD7FF', icon: '🔍', next: 'inspector' },
    [STATUS.PENDING_CHAIR]: { color: '#185FA5', bg: '#D6EAF8', icon: '👑', next: 'chairman' },
    [STATUS.APPROVED]: { color: '#1E8449', bg: '#D5F5E3', icon: '✅', next: null },
    [STATUS.REJECTED]: { color: '#96281B', bg: '#FADBD8', icon: '❌', next: null },
    [STATUS.EXPIRED]: { color: '#5F6368', bg: '#F2F3F4', icon: '⏰', next: null },
    [STATUS.CLOSED]: { color: '#2C3E50', bg: '#D5D8DC', icon: '🔒', next: null },
  };

  const ROLES = {
    all: { label: 'ทุกบทบาท', icon: '🧭', color: '#5F6368', requires: [] },
    contractor: { label: 'ผู้รับเหมา', icon: '🧰', color: '#C0392B', requires: [] },
    dept: { label: 'แผนกที่ว่าจ้าง', icon: '🏢', color: '#2980B9', requires: [] },
    inspector: { label: 'จป.วิชาชีพ', icon: '🔍', color: '#7C5CBF', requires: ['dept'] },
    chairman: { label: 'ประธาน คปอ.', icon: '👑', color: '#27AE60', requires: ['dept', 'inspector'] },
  };

  function normalizeStatus(status) {
    if (!status || status === 'รอตรวจสอบ') return STATUS.PENDING_DEPT;
    return status;
  }

  function normalizePermit(raw = {}) {
    const permit = { ...raw };
    permit.status = normalizeStatus(permit.status);
    permit.permit_id = permit.permit_id || permit.permitId || '';
    permit.company_name = permit.company_name || permit.companyName || '';
    permit.supervisor = permit.supervisor || permit.supervisorName || '';
    permit.work_date = permit.work_date || permit.workDate || '';
    permit.work_date_end = permit.work_date_end || permit.workDateEnd || '';
    permit.time_start = permit.time_start || permit.timeStart || '';
    permit.time_end = permit.time_end || permit.timeEnd || '';
    permit.work_area = permit.work_area || permit.workArea || '';
    permit.work_description = permit.work_description || permit.workDesc || '';
    permit.hazard_types = permit.hazard_types || permit.hazards || '';
    permit.ppe_required = permit.ppe_required || permit.ppe || '';
    permit.worker_count = permit.worker_count || permit.workerCount || '0';
    permit.submitted_at = permit.submitted_at || permit.submittedAt || '';
    return permit;
  }

  async function apiGet(params) {
    const url = API + '?' + new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', mode: 'cors' });
      clearTimeout(timer);
      return JSON.parse(await res.text());
    } catch (e) {
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
    } catch (e) {
      console.warn('POST error:', e);
      return { success: false, error: e.message };
    }
  }

  function generatePermitId() {
    return `APET-${Date.now()}-${Math.floor(Math.random() * 900) + 100}`;
  }

  async function createPermit(formData) {
    const permitId = generatePermitId();
    formData.permitId = permitId;
    formData.submittedAt = new Date().toLocaleString('th-TH');
    await apiPost(formData);
    return permitId;
  }

  async function getPermit(permitId) {
    const json = await apiGet({ action: 'get_approval', id: permitId });
    if (!json.success) throw new Error(json.error || 'Failed to load permit');
    return {
      permit: normalizePermit(json.permit || {}),
      approval: json.approval || { dept: null, inspector: null, chairman: null },
    };
  }

  async function listPermits() {
    const json = await apiGet({ action: 'list' });
    if (!json.success) throw new Error(json.error || 'Failed to list permits');
    return (json.permits || []).map(normalizePermit);
  }

  function canApprove(role, approval) {
    const required = ROLES[role]?.requires || [];
    for (const r of required) {
      if (!approval[r]) return { ok: false, msg: `ต้องให้ ${ROLES[r].label} ลงชื่อก่อน` };
    }
    return { ok: true };
  }

  async function approvePermit(permitId, role, approvalData) {
    const { approval } = await getPermit(permitId);
    const check = canApprove(role, approval);
    if (!check.ok) throw new Error(check.msg);

    return await apiPost({
      permitId,
      role,
      name: approvalData.name,
      date: approvalData.date || new Date().toLocaleString('th-TH'),
      note: approvalData.note || '',
      savedAt: new Date().toLocaleString('th-TH'),
      finalStatus: determineStatus(role, approval),
    });
  }

  function determineStatus(role, currentApproval) {
    const newApproval = { ...currentApproval, [role]: { name: 'x' } };
    if (newApproval.dept && newApproval.inspector && newApproval.chairman) return STATUS.APPROVED;
    if (newApproval.dept && newApproval.inspector) return STATUS.PENDING_CHAIR;
    if (newApproval.dept) return STATUS.PENDING_SAFETY;
    return STATUS.PENDING_DEPT;
  }

  async function saveChecklist(permitId, phaseData) {
    return await apiPost({ type: 'checklist_phase', permitId, ...phaseData, savedAt: new Date().toLocaleString('th-TH') });
  }

  async function requestOvertime(permitId, data) {
    return await apiPost({ type: 'overtime_request', permitId, ...data, requestedAt: new Date().toLocaleString('th-TH') });
  }

  async function closePermit(permitId) {
    return await apiGet({ action: 'close_permit', id: permitId });
  }

  function isExpired(permit) {
    if ([STATUS.APPROVED, STATUS.CLOSED, STATUS.EXPIRED, STATUS.REJECTED].includes(permit.status)) return false;
    const dateEnd = permit.work_date_end || permit.work_date;
    const timeEnd = permit.time_end || '17:00';
    if (!dateEnd || !timeEnd) return false;
    const sep = dateEnd.includes('-') ? '-' : '/';
    const parts = dateEnd.split(sep).map(Number);
    if (parts.length !== 3) return false;
    const [yRaw, mRaw, dRaw] = dateEnd.includes('-') ? parts : [parts[2], parts[1], parts[0]];
    const [hh, mm] = String(timeEnd).split(':').map(Number);
    const expiry = new Date(yRaw, mRaw - 1, dRaw, hh || 0, mm || 0);
    return new Date() > expiry;
  }

  function getEffectiveStatus(permit) {
    const normalized = normalizeStatus(permit.status);
    if (isExpired({ ...permit, status: normalized }) && ![STATUS.APPROVED, STATUS.CLOSED, STATUS.REJECTED].includes(normalized)) {
      return STATUS.EXPIRED;
    }
    return normalized || STATUS.PENDING_DEPT;
  }

  function getPendingRoleFromStatus(status) {
    const effective = normalizeStatus(status);
    return STATUS_CONFIG[effective]?.next || null;
  }

  function getRoleScopedPermits(role, permits) {
    if (!role || role === 'all') return permits;
    return permits.filter((permit) => {
      const status = getEffectiveStatus(permit);
      if (role === 'contractor') return true;
      if (role === 'dept') return status === STATUS.PENDING_DEPT;
      if (role === 'inspector') return status === STATUS.PENDING_SAFETY || status === STATUS.APPROVED || status === STATUS.CLOSED;
      if (role === 'chairman') return status === STATUS.PENDING_CHAIR || status === STATUS.APPROVED || status === STATUS.CLOSED;
      return true;
    });
  }

  function getActionVisibility(role, permit) {
    const status = getEffectiveStatus(permit);
    const nextRole = getPendingRoleFromStatus(status);
    return {
      view: true,
      qr: true,
      print: true,
      overtime: role === 'all' || role === 'contractor' || role === 'inspector',
      checklist: role === 'all' || role === 'inspector',
      close: status === STATUS.APPROVED && (role === 'all' || role === 'inspector'),
      dept: role === 'all' || role === 'dept' ? nextRole === 'dept' || status === STATUS.APPROVED || status === STATUS.CLOSED : false,
      inspector: role === 'all' || role === 'inspector' ? nextRole === 'inspector' || status === STATUS.APPROVED || status === STATUS.CLOSED : false,
      chairman: role === 'all' || role === 'chairman' ? nextRole === 'chairman' || status === STATUS.APPROVED || status === STATUS.CLOSED : false,
    };
  }

  function getUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  function getParam(name, fallback = '') {
    return getUrlParams().get(name) || fallback;
  }

  function buildPageUrl(page, params = {}) {
    const url = new URL(page, window.location.href);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    return url.toString();
  }

  function buildPermitLink(permitId) {
    return buildPageUrl('permit.html', { id: permitId });
  }

  function buildQrPosterLink(permitId) {
    return buildPageUrl('qr-poster.html', { id: permitId });
  }

  function renderStatusBadge(status) {
    const cfg = STATUS_CONFIG[status] || { color: '#856404', bg: '#FFF3CD', icon: '⏳' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${cfg.bg};color:${cfg.color}">${cfg.icon} ${status}</span>`;
  }

  function renderApprovalSteps(approval) {
    return ['dept', 'inspector', 'chairman'].map((role) => {
      const cfg = ROLES[role];
      const done = !!approval[role];
      return `<div style="flex:1;text-align:center;padding:8px 4px;background:${done ? '#D5F5E3' : '#F8F9FA'};border-right:1px solid #E8EAED">
        <div style="font-size:18px">${cfg.icon}</div>
        <div style="font-size:10px;font-weight:700;color:${done ? '#1E8449' : '#9AA0A6'}">${cfg.label}</div>
        <div style="font-size:9px;color:${done ? '#1E8449' : '#9AA0A6'}">${done ? '✓ ' + approval[role].name : 'รอลงชื่อ'}</div>
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
    if (dateStr.includes('/') || dateStr.includes('น.')) return dateStr;
    try {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${parseInt(y, 10) + 543}`;
    } catch {
      return dateStr;
    }
  }

  function formatTime(timeStr) {
    if (!timeStr) return '—';
    if (/^\d{2}:\d{2}$/.test(timeStr)) return timeStr + ' น.';
    return timeStr;
  }

  function cacheGet(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY + '_' + key) || 'null');
      return raw?.data ?? null;
    } catch {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(CACHE_KEY + '_' + key, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  }

  return {
    STATUS,
    STATUS_CONFIG,
    ROLES,
    apiGet,
    apiPost,
    createPermit,
    getPermit,
    listPermits,
    approvePermit,
    canApprove,
    determineStatus,
    saveChecklist,
    requestOvertime,
    closePermit,
    isExpired,
    getEffectiveStatus,
    getPendingRoleFromStatus,
    getRoleScopedPermits,
    getActionVisibility,
    normalizePermit,
    normalizeStatus,
    getParam,
    buildPageUrl,
    buildPermitLink,
    buildQrPosterLink,
    renderStatusBadge,
    renderApprovalSteps,
    showToast,
    formatDate,
    formatTime,
    cacheGet,
    cacheSet,
  };
})();
