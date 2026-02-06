// === OB Tracker - Single-file JS Application ===
// All data persisted in localStorage

(function () {
  'use strict';

  // --- Data Layer ---
  const STORAGE_KEY = 'ob_tracker_data';
  const THEME_KEY = 'ob_tracker_theme';

  function loadPatients() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function savePatients(patients) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
  }
  function getPatient(id) { return loadPatients().find(p => p.id === id); }
  function updatePatient(id, changes) {
    const patients = loadPatients();
    const idx = patients.findIndex(p => p.id === id);
    if (idx === -1) return;
    Object.assign(patients[idx], changes);
    savePatients(patients);
  }
  function deletePatient(id) {
    savePatients(loadPatients().filter(p => p.id !== id));
  }

  // --- Time Helpers ---
  function now() { return new Date(); }
  function midnightsSince(dateStr) {
    if (!dateStr) return '—';
    const admit = new Date(dateStr);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const admitDay = new Date(admit); admitDay.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((today - admitDay) / 86400000));
  }
  function hoursSince(dateStr) {
    if (!dateStr) return '—';
    const diff = now() - new Date(dateStr);
    return Math.max(0, (diff / 3600000)).toFixed(1);
  }
  function postOpDays(csDateStr) {
    if (!csDateStr) return null;
    const cs = new Date(csDateStr); cs.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((today - cs) / 86400000));
  }
  function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toLocalInput(date) {
    const d = date || new Date();
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }
  function toLocalDate(date) {
    const d = date || new Date();
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 10);
  }

  // For babies: get the time reference (born time, which is their DOB datetime)
  function babyTimeRef(p) {
    return p.born || p.admitted; // fallback to admitted for legacy data
  }

  // --- Alert Engine ---
  function getAlertsDue() {
    const patients = loadPatients();
    const due = [];
    const n = now().getTime();
    patients.forEach(p => {
      if (!p.alerts) return;
      p.alerts.forEach(a => {
        if (a.dismissed) return;
        const start = new Date(a.start).getTime();
        if (a.repeatHours > 0) {
          const interval = a.repeatHours * 3600000;
          const elapsed = n - start;
          if (elapsed >= 0) {
            const cycles = Math.floor(elapsed / interval);
            const lastDue = start + cycles * interval;
            if (n >= lastDue && n < lastDue + 900000) {
              due.push({ patient: p, alert: a, dueAt: new Date(lastDue) });
            }
          }
        } else {
          if (n >= start && n < start + 900000) {
            due.push({ patient: p, alert: a, dueAt: new Date(start) });
          }
        }
      });
    });
    return due;
  }

  function getUpcomingAlerts(patientId) {
    const p = getPatient(patientId);
    if (!p || !p.alerts) return [];
    const n = now().getTime();
    return p.alerts.map(a => {
      const start = new Date(a.start).getTime();
      let nextDue;
      if (a.repeatHours > 0) {
        const interval = a.repeatHours * 3600000;
        const elapsed = n - start;
        if (elapsed < 0) {
          nextDue = start;
        } else {
          const cycles = Math.floor(elapsed / interval);
          nextDue = start + (cycles + 1) * interval;
        }
      } else {
        nextDue = start;
      }
      return { ...a, nextDue: new Date(nextDue), isPast: nextDue < n && !a.repeatHours };
    });
  }

  function hasActiveAlerts(patient) {
    const n = now().getTime();
    if (!patient.alerts) return false;
    return patient.alerts.some(a => {
      if (a.dismissed) return false;
      const start = new Date(a.start).getTime();
      if (a.repeatHours > 0) {
        const interval = a.repeatHours * 3600000;
        const elapsed = n - start;
        if (elapsed >= 0) {
          const cycles = Math.floor(elapsed / interval);
          const lastDue = start + cycles * interval;
          return n >= lastDue && n < lastDue + 900000;
        }
      } else {
        return n >= start && n < start + 900000;
      }
      return false;
    });
  }

  function generateDefaultAlerts(patient) {
    const alerts = patient.alerts || [];
    const nowStr = toLocalInput(now());

    if (patient.type === 'mother') {
      if (patient.delivered && patient.deliveryTime) {
        const deliveryDate = new Date(patient.deliveryTime);
        const nextMorning = new Date(deliveryDate);
        nextMorning.setDate(nextMorning.getDate() + 1);
        nextMorning.setHours(6, 0, 0, 0);
        if (!alerts.find(a => a.autoType === 'cbc')) {
          alerts.push({
            id: crypto.randomUUID(), label: '🧪 CBC Check', autoType: 'cbc',
            start: toLocalInput(nextMorning), repeatHours: 0, dismissed: false
          });
        }
      }
      if (patient.preeclamptic) {
        if (!alerts.find(a => a.autoType === 'mag_check')) {
          alerts.push({
            id: crypto.randomUUID(), label: '💊 Mag Check', autoType: 'mag_check',
            start: patient.magStart || nowStr, repeatHours: 2, dismissed: false
          });
        }
      } else {
        const idx = alerts.findIndex(a => a.autoType === 'mag_check');
        if (idx !== -1) alerts.splice(idx, 1);
      }
      if (patient.labor) {
        if (!alerts.find(a => a.autoType === 'labor_note')) {
          alerts.push({
            id: crypto.randomUUID(), label: '📝 Labor Note', autoType: 'labor_note',
            start: patient.laborStart || nowStr, repeatHours: 4, dismissed: false
          });
        }
      } else {
        const idx = alerts.findIndex(a => a.autoType === 'labor_note');
        if (idx !== -1) alerts.splice(idx, 1);
      }
    }

    if (patient.type === 'baby') {
      const ref = babyTimeRef(patient);
      if (ref && !alerts.find(a => a.autoType === 'baby_24hr')) {
        const bornTime = new Date(ref);
        const check24 = new Date(bornTime.getTime() + 24 * 3600000);
        alerts.push({
          id: crypto.randomUUID(), label: '👶 24hr Screen', autoType: 'baby_24hr',
          start: toLocalInput(check24), repeatHours: 0, dismissed: false
        });
      }
    }

    return alerts;
  }

  // --- Newborn Screen ---
  // screen: { hearingR: null|'pass'|'fail', hearingL: null|'pass'|'fail', cardiac: null|'pass'|'fail' }
  function getScreen(p) {
    return p.screen || { hearingR: null, hearingL: null, cardiac: null };
  }

  function screenSummaryHtml(p) {
    const s = getScreen(p);
    function cls(v) {
      if (v === 'pass') return 'screen-pass';
      if (v === 'fail') return 'screen-fail';
      return 'screen-pending';
    }
    function txt(v) {
      if (v === 'pass') return '✓';
      if (v === 'fail') return '✗';
      return '·';
    }
    return `<span class="${cls(s.hearingR)}">HR:${txt(s.hearingR)}</span>` +
           `<span class="${cls(s.hearingL)}">HL:${txt(s.hearingL)}</span>` +
           `<span class="${cls(s.cardiac)}">♡:${txt(s.cardiac)}</span>`;
  }

  // --- Theme ---
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeBtn(saved);
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeBtn(next);
  }
  function updateThemeBtn(theme) {
    document.getElementById('btn-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // --- Notifications ---
  let notifPermission = Notification ? Notification.permission : 'denied';

  function requestNotifPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { notifPermission = p; });
    }
  }

  function sendNotification(title, body) {
    // Browser notification (works on phone if site is added to home screen or tab is open)
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, {
          body: body,
          icon: '🏥',
          tag: 'ob-alert-' + Date.now(),
          requireInteraction: true,
          vibrate: [200, 100, 200, 100, 200]
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch (e) {
        // Safari doesn't support Notification constructor in some contexts
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, { body: body, vibrate: [200, 100, 200, 100, 200] });
          });
        }
      }
    }
    // Vibrate as fallback
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }

  // --- Rendering ---
  function render() {
    const patients = loadPatients();
    const grid = document.getElementById('room-grid');
    const empty = document.getElementById('empty-state');

    patients.sort((a, b) => {
      const na = parseInt(a.room) || 0, nb = parseInt(b.room) || 0;
      return na - nb || a.room.localeCompare(b.room);
    });

    if (patients.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    grid.innerHTML = patients.map(p => {
      const isMother = p.type === 'mother';
      const icon = isMother ? '🤰' : '👶';
      const statusClass = `status-${p.status || 'green'}`;
      const alertActive = hasActiveAlerts(p);
      const biliGlow = !isMother && p.biliLights ? 'bili-glow' : '';

      let stats = '';
      if (isMother) {
        const mn = midnightsSince(p.admitted);
        stats += `<span>🌙${mn}</span>`;
        if (p.ga) stats += `<span>📅${esc(p.ga)}w</span>`;
        if (p.csection && p.csectionDate) {
          const pod = postOpDays(p.csectionDate);
          if (pod !== null) stats += `<span>🔪POD${pod}</span>`;
        }
        if (p.ebl) stats += `<span>🩸${p.ebl}</span>`;
      } else {
        const ref = babyTimeRef(p);
        const hrs = hoursSince(ref);
        stats += `<span>⏱${hrs}h</span>`;
        if (p.weight) stats += `<span>⚖${p.weight}g</span>`;
        if (p.feeding) {
          const feedIcon = { breast: '🤱', bottle: '🍼', combo: '🤱🍼' };
          stats += `<span>${feedIcon[p.feeding] || p.feeding}</span>`;
        }
        if (p.bili) stats += `<span>🟡${p.bili}</span>`;
      }

      let badges = '';
      if (isMother) {
        if (p.gravida || p.para) badges += `<span class="badge" style="background:var(--fg2);color:var(--bg)">G${esc(p.gravida || '?')}P${esc(p.para || '?')}</span>`;
        if (p.preeclamptic) badges += '<span class="badge badge-preec">MAG</span>';
        if (p.labor) badges += '<span class="badge badge-labor">LAB</span>';
        if (p.csection) badges += '<span class="badge badge-csec">C/S</span>';
        if (p.delivered) badges += '<span class="badge badge-delivered">DEL</span>';
        if (p.delivered && !p.cbcDone) badges += '<span class="badge badge-cbc">CBC</span>';
        if (p.gbs) badges += '<span class="badge badge-gbs">GBS+</span>';
      } else {
        if (p.nicu) badges += '<span class="badge badge-nicu">NICU</span>';
        if (p.biliLights) badges += '<span class="badge badge-bili">BILI💡</span>';
      }
      if (alertActive) badges += '<span class="badge badge-alert">⚠️</span>';

      // Newborn screen summary on card
      let screenHtml = '';
      if (!isMother) {
        screenHtml = `<div class="card-screen">${screenSummaryHtml(p)}</div>`;
      }

      return `
        <div class="room-card ${statusClass} ${biliGlow}" data-id="${p.id}" onclick="window._openDetail('${p.id}')">
          ${alertActive ? '<div class="card-alert-dot"></div>' : ''}
          <div class="card-top">
            <span class="room-num">${esc(p.room)}</span>
            <span class="type-icon">${icon}</span>
          </div>
          <div class="patient-name">${esc(p.name)}</div>
          <div class="card-stats">${stats}</div>
          <div class="card-badges">${badges}</div>
          ${screenHtml}
        </div>`;
    }).join('');

    updateAlertBanner();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function updateAlertBanner() {
    const due = getAlertsDue();
    const banner = document.getElementById('alert-banner');
    if (due.length === 0) {
      banner.classList.add('hidden');
      banner.textContent = '';
      document.title = 'OB Tracker';
      return;
    }
    const msgs = due.map(d => `Rm ${d.patient.room}: ${d.alert.label}`);
    banner.textContent = `⚠️ ${msgs.join(' | ')}`;
    banner.classList.remove('hidden');
    document.title = `⚠️ (${due.length}) OB Tracker`;
  }

  // --- Add Patient ---
  function setupAddModal() {
    const modal = document.getElementById('modal-add');
    const form = document.getElementById('form-add');
    const typeGroup = form.querySelectorAll('[data-type]');
    const statusGroup = form.querySelectorAll('[data-status]');
    let selectedType = 'mother';
    let selectedStatus = 'green';

    document.getElementById('btn-add').addEventListener('click', () => {
      form.reset();
      selectedType = 'mother';
      selectedStatus = 'green';
      updateTypeUI();
      updateStatusUI();
      document.getElementById('add-admitted').value = toLocalInput();
      document.getElementById('add-born').value = toLocalInput();
      document.getElementById('csection-date-row').style.display = 'none';
      document.getElementById('delivery-date-row').style.display = 'none';
      modal.classList.remove('hidden');
      document.getElementById('add-room').focus();
    });

    typeGroup.forEach(btn => btn.addEventListener('click', () => {
      selectedType = btn.dataset.type;
      updateTypeUI();
    }));
    statusGroup.forEach(btn => btn.addEventListener('click', () => {
      selectedStatus = btn.dataset.status;
      updateStatusUI();
    }));

    function updateTypeUI() {
      typeGroup.forEach(b => b.classList.toggle('active', b.dataset.type === selectedType));
      document.getElementById('mother-fields').style.display = selectedType === 'mother' ? '' : 'none';
      document.getElementById('baby-fields').style.display = selectedType === 'baby' ? '' : 'none';
      // Mother gets DOB (date) + Admitted (datetime); Baby gets Born (datetime)
      document.getElementById('add-dob-row').style.display = selectedType === 'mother' ? '' : 'none';
      document.getElementById('add-admitted-row').style.display = selectedType === 'mother' ? '' : 'none';
      document.getElementById('add-born-row').style.display = selectedType === 'baby' ? '' : 'none';
    }
    function updateStatusUI() {
      statusGroup.forEach(b => b.classList.toggle('active', b.dataset.status === selectedStatus));
    }

    document.getElementById('add-csection').addEventListener('change', e => {
      document.getElementById('csection-date-row').style.display = e.target.checked ? '' : 'none';
      if (e.target.checked) document.getElementById('add-csection-date').value = toLocalDate();
    });
    document.getElementById('add-delivered').addEventListener('change', e => {
      document.getElementById('delivery-date-row').style.display = e.target.checked ? '' : 'none';
      if (e.target.checked) document.getElementById('add-delivery-time').value = toLocalInput();
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const patient = {
        id: crypto.randomUUID(),
        room: document.getElementById('add-room').value.trim(),
        name: document.getElementById('add-name').value.trim(),
        type: selectedType,
        status: selectedStatus,
        notes: '',
        alerts: [],
        cbcDone: false
      };
      if (selectedType === 'mother') {
        patient.dob = document.getElementById('add-dob').value;
        patient.admitted = document.getElementById('add-admitted').value;
        patient.gravida = document.getElementById('add-gravida').value.trim();
        patient.para = document.getElementById('add-para').value.trim();
        patient.ga = document.getElementById('add-ga').value.trim();
        patient.preeclamptic = document.getElementById('add-preeclamptic').checked;
        patient.labor = document.getElementById('add-labor').checked;
        patient.csection = document.getElementById('add-csection').checked;
        patient.csectionDate = document.getElementById('add-csection-date').value;
        patient.delivered = document.getElementById('add-delivered').checked;
        patient.deliveryTime = document.getElementById('add-delivery-time').value;
        patient.ebl = document.getElementById('add-ebl').value;
        patient.gbs = document.getElementById('add-gbs').checked;
        patient.magStart = '';
        patient.laborStart = '';
      } else {
        patient.born = document.getElementById('add-born').value;
        patient.weight = document.getElementById('add-weight').value;
        patient.feeding = document.getElementById('add-feeding').value;
        patient.nicu = document.getElementById('add-nicu').checked;
        patient.biliLights = document.getElementById('add-bili-lights').checked;
        patient.bili = document.getElementById('add-bili').value;
        patient.screen = { hearingR: null, hearingL: null, cardiac: null };
      }
      patient.alerts = generateDefaultAlerts(patient);
      const patients = loadPatients();
      patients.push(patient);
      savePatients(patients);
      modal.classList.add('hidden');
      render();
    });
  }

  // --- Detail View ---
  function openDetail(id) {
    const p = getPatient(id);
    if (!p) return;
    const modal = document.getElementById('modal-detail');
    const title = document.getElementById('detail-title');
    const body = document.getElementById('detail-body');
    const isMother = p.type === 'mother';
    const icon = isMother ? '🤰' : '👶';

    title.textContent = `Rm ${p.room} ${icon} ${p.name}`;

    let html = '<div class="detail-section"><h3>Info</h3><div class="detail-stats">';
    if (isMother) {
      html += `<div class="stat-box"><div class="stat-val">${midnightsSince(p.admitted)}</div><div class="stat-label">🌙 Midnights</div></div>`;
      if (p.gravida || p.para) {
        html += `<div class="stat-box"><div class="stat-val" style="font-size:1rem">G${esc(p.gravida || '?')}P${esc(p.para || '?')}</div><div class="stat-label">G/P</div></div>`;
      }
      if (p.ga) {
        html += `<div class="stat-box"><div class="stat-val" style="font-size:1rem">${esc(p.ga)}</div><div class="stat-label">📅 GA wks</div></div>`;
      }
      if (p.csection && p.csectionDate) {
        const pod = postOpDays(p.csectionDate);
        html += `<div class="stat-box"><div class="stat-val">${pod}</div><div class="stat-label">🔪 POD</div></div>`;
      }
      if (p.ebl) {
        html += `<div class="stat-box"><div class="stat-val">${p.ebl}</div><div class="stat-label">🩸 EBL mL</div></div>`;
      }
      if (p.dob) {
        html += `<div class="stat-box"><div class="stat-val" style="font-size:0.9rem">${p.dob}</div><div class="stat-label">🎂 DOB</div></div>`;
      }
      html += `<div class="stat-box"><div class="stat-val" style="font-size:0.9rem">${formatTime(p.admitted)}</div><div class="stat-label">📥 Admitted</div></div>`;
      if (p.gbs) {
        html += `<div class="stat-box"><div class="stat-val" style="color:var(--red)">+</div><div class="stat-label">🦠 GBS</div></div>`;
      }
    } else {
      const ref = babyTimeRef(p);
      html += `<div class="stat-box"><div class="stat-val">${hoursSince(ref)}</div><div class="stat-label">⏱ Hours old</div></div>`;
      if (p.weight) {
        html += `<div class="stat-box"><div class="stat-val">${p.weight}</div><div class="stat-label">⚖ Weight g</div></div>`;
      }
      if (p.feeding) {
        const feedLabels = { breast: 'Breast', bottle: 'Bottle', combo: 'Combo' };
        html += `<div class="stat-box"><div class="stat-val" style="font-size:1rem">${feedLabels[p.feeding]}</div><div class="stat-label">🍼 Feeding</div></div>`;
      }
      if (ref) {
        html += `<div class="stat-box"><div class="stat-val" style="font-size:0.9rem">${formatTime(ref)}</div><div class="stat-label">🎂 Born</div></div>`;
      }
      if (p.bili) {
        html += `<div class="stat-box"><div class="stat-val" style="color:${parseFloat(p.bili) > 15 ? 'var(--red)' : 'var(--yellow)'}">${p.bili}</div><div class="stat-label">🟡 Bili</div></div>`;
      }
      if (p.biliLights) {
        html += `<div class="stat-box"><div class="stat-val" style="color:var(--bili-glow)">ON</div><div class="stat-label">💡 Bili Lights</div></div>`;
      }
      if (p.nicu) {
        html += `<div class="stat-box"><div class="stat-val" style="color:#8e44ad">NICU</div><div class="stat-label">📍 Location</div></div>`;
      }
    }
    html += '</div></div>';

    // Newborn screen (babies only)
    if (!isMother) {
      const s = getScreen(p);
      html += '<div class="detail-section"><h3>Newborn Screen</h3><div class="screen-grid">';
      const items = [
        { key: 'hearingR', label: '👂 Hearing R' },
        { key: 'hearingL', label: '👂 Hearing L' },
        { key: 'cardiac', label: '♡ Cardiac' }
      ];
      items.forEach(item => {
        const v = s[item.key];
        html += `<span class="screen-label">${item.label}</span>`;
        html += `<button class="${v === 'pass' ? 'pass' : ''}" onclick="window._setScreen('${id}','${item.key}','pass')">Pass</button>`;
        html += `<button class="${v === 'fail' ? 'fail' : ''}" onclick="window._setScreen('${id}','${item.key}','fail')">Fail</button>`;
      });
      html += '</div></div>';
    }

    // Checklists
    html += '<div class="detail-section"><h3>Checklists</h3>';
    if (isMother && p.delivered) {
      html += `<div class="checklist-item ${p.cbcDone ? 'checked' : ''}">
        <input type="checkbox" ${p.cbcDone ? 'checked' : ''} onchange="window._toggleCbc('${id}', this.checked)">
        <label>🧪 Post-delivery CBC</label></div>`;
    }
    html += '</div>';

    // Upcoming alerts
    const alerts = getUpcomingAlerts(id);
    if (alerts.length > 0) {
      html += '<div class="detail-section"><h3>Alerts</h3>';
      alerts.forEach(a => {
        const isDue = a.nextDue <= now() && !a.isPast;
        html += `<div class="alert-item ${isDue ? 'alert-due' : ''}">
          <div class="alert-info">
            <strong>${a.label}</strong>
            <small>Next: ${formatTime(a.nextDue.toISOString())}${a.repeatHours ? ' (q' + a.repeatHours + 'h)' : ' (once)'}</small>
          </div>
        </div>`;
      });
      html += '</div>';
    }

    // Notes
    html += `<div class="detail-section"><h3>Notes</h3>
      <textarea class="notes-area" placeholder="Tap to add notes..." onchange="window._saveNotes('${id}', this.value)">${esc(p.notes)}</textarea>
    </div>`;

    // Actions
    html += `<div class="detail-actions">
      <button class="btn-secondary" onclick="window._openEdit('${id}')">✏️ Edit</button>
      <button class="btn-secondary" onclick="window._openAlerts('${id}')">🔔 Alerts</button>
      <button class="btn-secondary" onclick="if(confirm('Delete this patient?')){window._deletePatient('${id}')}">🗑️ Delete</button>
    </div>`;

    body.innerHTML = html;
    modal.classList.remove('hidden');
  }
  window._openDetail = openDetail;

  window._saveNotes = function (id, val) { updatePatient(id, { notes: val }); };
  window._toggleCbc = function (id, val) { updatePatient(id, { cbcDone: val }); render(); };

  window._setScreen = function (id, key, val) {
    const p = getPatient(id);
    if (!p) return;
    const screen = getScreen(p);
    // Toggle: if already set to this value, clear it
    screen[key] = screen[key] === val ? null : val;
    updatePatient(id, { screen: screen });
    openDetail(id); // refresh detail view
    render();
  };

  window._deletePatient = function (id) {
    deletePatient(id);
    document.getElementById('modal-detail').classList.add('hidden');
    render();
  };

  // --- Edit Patient ---
  function openEdit(id) {
    const p = getPatient(id);
    if (!p) return;
    document.getElementById('modal-detail').classList.add('hidden');
    const modal = document.getElementById('modal-edit');
    const form = document.getElementById('form-edit');
    const isMother = p.type === 'mother';

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-room').value = p.room;
    document.getElementById('edit-name').value = p.name;

    // Type
    let editType = p.type;
    const editTypeGroup = document.getElementById('edit-type-group').querySelectorAll('[data-type]');
    editTypeGroup.forEach(b => b.classList.toggle('active', b.dataset.type === editType));
    showEditTypeFields(editType);

    editTypeGroup.forEach(btn => {
      btn.onclick = () => {
        editType = btn.dataset.type;
        editTypeGroup.forEach(b => b.classList.toggle('active', b.dataset.type === editType));
        showEditTypeFields(editType);
      };
    });

    function showEditTypeFields(type) {
      document.getElementById('edit-mother-fields').style.display = type === 'mother' ? '' : 'none';
      document.getElementById('edit-baby-fields').style.display = type === 'baby' ? '' : 'none';
      document.getElementById('edit-dob-row').style.display = type === 'mother' ? '' : 'none';
      document.getElementById('edit-admitted-row').style.display = type === 'mother' ? '' : 'none';
      document.getElementById('edit-born-row').style.display = type === 'baby' ? '' : 'none';
    }

    // Mother fields
    document.getElementById('edit-dob').value = p.dob || '';
    document.getElementById('edit-admitted').value = p.admitted || '';
    document.getElementById('edit-gravida').value = p.gravida || '';
    document.getElementById('edit-para').value = p.para || '';
    document.getElementById('edit-ga').value = p.ga || '';
    document.getElementById('edit-ebl').value = p.ebl || '';
    document.getElementById('edit-gbs').checked = p.gbs || false;
    document.getElementById('edit-preeclamptic').checked = p.preeclamptic || false;
    document.getElementById('edit-labor').checked = p.labor || false;
    document.getElementById('edit-csection').checked = p.csection || false;
    document.getElementById('edit-csection-date').value = p.csectionDate || '';
    document.getElementById('edit-csection-date-row').style.display = p.csection ? '' : 'none';
    document.getElementById('edit-delivered').checked = p.delivered || false;
    document.getElementById('edit-delivery-time').value = p.deliveryTime || '';
    document.getElementById('edit-delivery-date-row').style.display = p.delivered ? '' : 'none';
    document.getElementById('edit-mag-start').value = p.magStart || '';
    document.getElementById('edit-mag-start-row').style.display = p.preeclamptic ? '' : 'none';
    document.getElementById('edit-labor-start').value = p.laborStart || '';
    document.getElementById('edit-labor-start-row').style.display = p.labor ? '' : 'none';

    // Baby fields
    document.getElementById('edit-born').value = p.born || '';
    document.getElementById('edit-weight').value = p.weight || '';
    document.getElementById('edit-feeding').value = p.feeding || '';
    document.getElementById('edit-nicu').checked = p.nicu || false;
    document.getElementById('edit-bili-lights').checked = p.biliLights || false;
    document.getElementById('edit-bili').value = p.bili || '';

    // Status
    let editStatus = p.status || 'green';
    const editStatusGroup = document.getElementById('edit-status-group').querySelectorAll('[data-status]');
    editStatusGroup.forEach(b => b.classList.toggle('active', b.dataset.status === editStatus));
    editStatusGroup.forEach(btn => {
      btn.onclick = () => {
        editStatus = btn.dataset.status;
        editStatusGroup.forEach(b => b.classList.toggle('active', b.dataset.status === editStatus));
      };
    });

    // Dynamic show/hide
    document.getElementById('edit-preeclamptic').onchange = e => {
      document.getElementById('edit-mag-start-row').style.display = e.target.checked ? '' : 'none';
      if (e.target.checked && !document.getElementById('edit-mag-start').value) {
        document.getElementById('edit-mag-start').value = toLocalInput();
      }
    };
    document.getElementById('edit-labor').onchange = e => {
      document.getElementById('edit-labor-start-row').style.display = e.target.checked ? '' : 'none';
      if (e.target.checked && !document.getElementById('edit-labor-start').value) {
        document.getElementById('edit-labor-start').value = toLocalInput();
      }
    };
    document.getElementById('edit-csection').onchange = e => {
      document.getElementById('edit-csection-date-row').style.display = e.target.checked ? '' : 'none';
      if (e.target.checked && !document.getElementById('edit-csection-date').value) {
        document.getElementById('edit-csection-date').value = toLocalDate();
      }
    };
    document.getElementById('edit-delivered').onchange = e => {
      document.getElementById('edit-delivery-date-row').style.display = e.target.checked ? '' : 'none';
      if (e.target.checked && !document.getElementById('edit-delivery-time').value) {
        document.getElementById('edit-delivery-time').value = toLocalInput();
      }
    };

    // Delete button
    document.getElementById('btn-delete-patient').onclick = () => {
      if (confirm('Delete this patient?')) {
        deletePatient(id);
        modal.classList.add('hidden');
        render();
      }
    };

    form.onsubmit = e => {
      e.preventDefault();
      const changes = {
        room: document.getElementById('edit-room').value.trim(),
        name: document.getElementById('edit-name').value.trim(),
        type: editType,
        status: editStatus
      };
      if (editType === 'mother') {
        changes.dob = document.getElementById('edit-dob').value;
        changes.admitted = document.getElementById('edit-admitted').value;
        changes.gravida = document.getElementById('edit-gravida').value.trim();
        changes.para = document.getElementById('edit-para').value.trim();
        changes.ga = document.getElementById('edit-ga').value.trim();
        changes.preeclamptic = document.getElementById('edit-preeclamptic').checked;
        changes.labor = document.getElementById('edit-labor').checked;
        changes.csection = document.getElementById('edit-csection').checked;
        changes.csectionDate = document.getElementById('edit-csection-date').value;
        changes.delivered = document.getElementById('edit-delivered').checked;
        changes.deliveryTime = document.getElementById('edit-delivery-time').value;
        changes.ebl = document.getElementById('edit-ebl').value;
        changes.gbs = document.getElementById('edit-gbs').checked;
        changes.magStart = document.getElementById('edit-mag-start').value;
        changes.laborStart = document.getElementById('edit-labor-start').value;
      } else {
        changes.born = document.getElementById('edit-born').value;
        changes.weight = document.getElementById('edit-weight').value;
        changes.feeding = document.getElementById('edit-feeding').value;
        changes.nicu = document.getElementById('edit-nicu').checked;
        changes.biliLights = document.getElementById('edit-bili-lights').checked;
        changes.bili = document.getElementById('edit-bili').value;
      }
      updatePatient(id, changes);
      const updated = getPatient(id);
      updated.alerts = generateDefaultAlerts(updated);
      updatePatient(id, { alerts: updated.alerts });
      modal.classList.add('hidden');
      render();
    };

    modal.classList.remove('hidden');
  }
  window._openEdit = openEdit;

  // --- Alert Management ---
  function openAlerts(id) {
    const p = getPatient(id);
    if (!p) return;
    document.getElementById('modal-detail').classList.add('hidden');
    const modal = document.getElementById('modal-alerts');
    document.getElementById('alert-patient-id').value = id;
    document.getElementById('alert-start').value = toLocalInput();
    document.getElementById('alert-repeat').value = '0';
    document.getElementById('alert-type').value = 'custom';
    document.getElementById('alert-label').value = '';
    document.getElementById('custom-label-row').style.display = '';

    renderAlertList(id);
    modal.classList.remove('hidden');
  }
  window._openAlerts = openAlerts;

  function renderAlertList(id) {
    const p = getPatient(id);
    const list = document.getElementById('alert-list');
    if (!p.alerts || p.alerts.length === 0) {
      list.innerHTML = '<p style="color:var(--fg2);font-size:0.8rem;text-align:center;">No alerts</p>';
      return;
    }
    const n = now().getTime();
    list.innerHTML = p.alerts.map(a => {
      const start = new Date(a.start).getTime();
      let isDue = false;
      let nextStr = '';
      if (a.repeatHours > 0) {
        const interval = a.repeatHours * 3600000;
        const elapsed = n - start;
        if (elapsed >= 0) {
          const cycles = Math.floor(elapsed / interval);
          const lastDue = start + cycles * interval;
          const nextDue = start + (cycles + 1) * interval;
          isDue = n >= lastDue && n < lastDue + 900000;
          nextStr = formatTime(new Date(nextDue).toISOString());
        } else {
          nextStr = formatTime(a.start);
        }
      } else {
        isDue = n >= start && n < start + 900000;
        nextStr = formatTime(a.start);
      }
      return `<div class="alert-item ${isDue ? 'alert-due' : ''}">
        <div class="alert-info">
          <strong>${a.label}</strong>
          <small>Next: ${nextStr}${a.repeatHours ? ' (q' + a.repeatHours + 'h)' : ''}</small>
        </div>
        <button onclick="window._removeAlert('${id}','${a.id}')" title="Remove">✕</button>
      </div>`;
    }).join('');
  }

  window._removeAlert = function (patientId, alertId) {
    const p = getPatient(patientId);
    if (!p) return;
    p.alerts = (p.alerts || []).filter(a => a.id !== alertId);
    updatePatient(patientId, { alerts: p.alerts });
    renderAlertList(patientId);
    render();
  };

  function setupAlertForm() {
    const typeSelect = document.getElementById('alert-type');
    typeSelect.addEventListener('change', () => {
      const v = typeSelect.value;
      const labelRow = document.getElementById('custom-label-row');
      const repeatInput = document.getElementById('alert-repeat');
      if (v === 'custom') {
        labelRow.style.display = '';
        document.getElementById('alert-label').value = '';
      } else {
        labelRow.style.display = 'none';
        const presets = {
          blood_draw: { label: '🩸 Blood Draw', repeat: 0 },
          mag_check: { label: '💊 Mag Check', repeat: 2 },
          labor_note: { label: '📝 Labor Note', repeat: 4 },
          cbc: { label: '🧪 CBC Check', repeat: 0 },
          glucose: { label: '🍬 Glucose Check', repeat: 0 }
        };
        const preset = presets[v];
        if (preset) {
          document.getElementById('alert-label').value = preset.label;
          repeatInput.value = preset.repeat;
        }
      }
    });

    document.getElementById('form-alert').addEventListener('submit', e => {
      e.preventDefault();
      const patientId = document.getElementById('alert-patient-id').value;
      const p = getPatient(patientId);
      if (!p) return;

      const type = typeSelect.value;
      let label = document.getElementById('alert-label').value.trim();
      if (!label && type === 'custom') label = 'Custom Alert';
      if (!label) {
        const presets = {
          blood_draw: '🩸 Blood Draw', mag_check: '💊 Mag Check',
          labor_note: '📝 Labor Note', cbc: '🧪 CBC Check', glucose: '🍬 Glucose Check'
        };
        label = presets[type] || 'Alert';
      }

      const alert = {
        id: crypto.randomUUID(),
        label: label,
        start: document.getElementById('alert-start').value,
        repeatHours: parseFloat(document.getElementById('alert-repeat').value) || 0,
        dismissed: false
      };

      p.alerts = p.alerts || [];
      p.alerts.push(alert);
      updatePatient(patientId, { alerts: p.alerts });
      renderAlertList(patientId);
      render();

      typeSelect.value = 'custom';
      document.getElementById('alert-label').value = '';
      document.getElementById('alert-start').value = toLocalInput();
      document.getElementById('alert-repeat').value = '0';
      document.getElementById('custom-label-row').style.display = '';
    });
  }

  // --- Modal Close Handlers ---
  function setupModals() {
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        document.getElementById(modalId).classList.add('hidden');
      });
    });
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });
  }

  // --- Alert Banner Click ---
  function setupAlertBanner() {
    document.getElementById('alert-banner').addEventListener('click', () => {
      const due = getAlertsDue();
      if (due.length > 0) {
        openDetail(due[0].patient.id);
      }
    });
  }

  // --- Periodic Update ---
  function startTicker() {
    setInterval(() => {
      render();
    }, 30000);
  }

  // --- Notification Sound + Push ---
  let lastAlertCount = 0;
  let lastAlertIds = new Set();

  function checkAlertSound() {
    const due = getAlertsDue();
    const currentIds = new Set(due.map(d => d.alert.id + '-' + (d.dueAt ? d.dueAt.getTime() : '')));

    // Find new alerts that weren't in the last check
    const newAlerts = due.filter(d => {
      const key = d.alert.id + '-' + (d.dueAt ? d.dueAt.getTime() : '');
      return !lastAlertIds.has(key);
    });

    if (newAlerts.length > 0) {
      playAlertSound();
      // Send phone notification for each new alert
      newAlerts.forEach(d => {
        sendNotification(
          `🏥 Rm ${d.patient.room}: ${d.alert.label}`,
          `${d.patient.name} - ${d.alert.label}`
        );
      });
    }

    lastAlertIds = currentIds;
    lastAlertCount = due.length;
  }

  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1000;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.3);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      osc2.start(ctx.currentTime + 0.3);
      osc2.stop(ctx.currentTime + 0.8);
    } catch (e) { /* ignore audio errors */ }
  }

  // --- Export / Import ---
  function setupDataModal() {
    const modal = document.getElementById('modal-data');
    document.getElementById('btn-data').addEventListener('click', () => {
      document.getElementById('import-status').textContent = '';
      document.getElementById('import-file').value = '';
      modal.classList.remove('hidden');
    });

    const mergeBtn = document.getElementById('import-mode-merge');
    const replaceBtn = document.getElementById('import-mode-replace');
    let importMode = 'merge';
    mergeBtn.addEventListener('click', () => {
      importMode = 'merge';
      mergeBtn.classList.add('active');
      replaceBtn.classList.remove('active');
    });
    replaceBtn.addEventListener('click', () => {
      importMode = 'replace';
      replaceBtn.classList.add('active');
      mergeBtn.classList.remove('active');
    });

    document.getElementById('btn-export-file').addEventListener('click', () => {
      const patients = loadPatients();
      const blob = new Blob([JSON.stringify(patients, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `ob-tracker-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    document.getElementById('btn-export-copy').addEventListener('click', () => {
      const patients = loadPatients();
      const text = JSON.stringify(patients, null, 2);
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-export-copy');
        const orig = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const btn = document.getElementById('btn-export-copy');
        const orig = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });

    document.getElementById('btn-import').addEventListener('click', () => {
      const status = document.getElementById('import-status');
      const fileInput = document.getElementById('import-file');
      const file = fileInput.files[0];
      if (!file) {
        status.textContent = '⚠️ Select a file first.';
        status.style.color = 'var(--yellow)';
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const imported = JSON.parse(e.target.result);
          if (!Array.isArray(imported)) throw new Error('Not a valid array');
          if (importMode === 'replace') {
            savePatients(imported);
            status.textContent = `✅ Replaced with ${imported.length} patient(s).`;
            status.style.color = 'var(--green)';
          } else {
            const existing = loadPatients();
            const existingIds = new Set(existing.map(p => p.id));
            let added = 0;
            imported.forEach(p => {
              if (!existingIds.has(p.id)) {
                existing.push(p);
                added++;
              }
            });
            savePatients(existing);
            status.textContent = `✅ Added ${added} new patient(s), skipped ${imported.length - added} duplicate(s).`;
            status.style.color = 'var(--green)';
          }
          render();
        } catch (err) {
          status.textContent = '❌ Invalid file: ' + err.message;
          status.style.color = 'var(--red)';
        }
      };
      reader.readAsText(file);
    });
  }

  // --- Service Worker for background notifications ---
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // --- Init ---
  function init() {
    initTheme();
    setupModals();
    setupAddModal();
    setupAlertForm();
    setupAlertBanner();
    setupDataModal();
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    requestNotifPermission();
    registerSW();
    render();
    startTicker();
    setInterval(checkAlertSound, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
