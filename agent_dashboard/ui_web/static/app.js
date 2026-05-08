const root = document.getElementById('root');
const summary = document.getElementById('summary');
const conn = document.getElementById('conn');
const searchEl = document.getElementById('search');
const filterEls = {
  running: document.getElementById('f-running'),
  done:    document.getElementById('f-done'),
  failed:  document.getElementById('f-failed'),
  stale:   document.getElementById('f-stale'),
};

const expanded = new Set();
let lastSnap = null;

const LS_KEY = 'agent-dashboard.filters.v1';
try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  if (saved.search != null) searchEl.value = saved.search;
  for (const k of Object.keys(filterEls)) {
    if (typeof saved[k] === 'boolean') filterEls[k].checked = saved[k];
  }
} catch {}

function persistFilters() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      search: searchEl.value,
      running: filterEls.running.checked,
      done:    filterEls.done.checked,
      failed:  filterEls.failed.checked,
      stale:   filterEls.stale.checked,
    }));
  } catch {}
}

searchEl.addEventListener('input', () => { persistFilters(); render(lastSnap); });
for (const el of Object.values(filterEls)) {
  el.addEventListener('change', () => { persistFilters(); render(lastSnap); });
}

function passesFilter(e, q) {
  if (!filterEls[e.status]?.checked && (e.status === 'running' || e.status === 'done' || e.status === 'failed' || e.status === 'stale')) {
    return false;
  }
  if (!q) return true;
  const hay = (
    (e.description || '') + ' ' +
    (e.subagent_type || '') + ' ' +
    (e.prompt_first_line || '')
  ).toLowerCase();
  return hay.includes(q);
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (ev) => {
    conn.classList.remove('bad');
    try {
      lastSnap = JSON.parse(ev.data);
      render(lastSnap);
    } catch (e) {
      console.error('parse error', e);
    }
  });
  es.addEventListener('ping', () => {
    conn.classList.remove('bad');
  });
  es.onerror = () => {
    conn.classList.add('bad');
    summary.textContent = 'disconnected — reconnecting…';
    es.close();
    setTimeout(connect, 2000);
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function fmtDur(s) {
  if (s == null) return '';
  if (s < 1) return '<1s';
  if (s < 60) return Math.round(s) + 's';
  const m = Math.floor(s/60), sec = Math.round(s%60);
  if (m < 60) return m + 'm' + (sec ? sec + 's' : '');
  const h = Math.floor(m/60);
  return h + 'h' + (m%60) + 'm';
}

function timeSince(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return Math.round(sec) + 's ago';
  if (sec < 3600) return Math.round(sec/60) + 'm ago';
  if (sec < 86400) return Math.round(sec/3600) + 'h ago';
  return Math.round(sec/86400) + 'd ago';
}

function projectKey(s) {
  return s.project_display || s.project_slug || s.project_cwd || '?';
}

const ICON = { running:'▶', done:'✓', failed:'✗', stale:'…', orphaned:'?' };

function render(snap) {
  if (!snap) return;
  const q = (searchEl.value || '').trim().toLowerCase();
  const projQ = q;
  const allSessions = (snap.sessions || []).filter(s => s.events && s.events.length);

  // 통계는 *전체* 기준 (필터 무관) — 사용자 인식
  let r=0, d=0, f=0, total=0;
  for (const s of allSessions) {
    for (const e of s.events) {
      total++;
      if (e.status === 'running') r++;
      else if (e.status === 'done') d++;
      else if (e.status === 'failed') f++;
    }
  }
  const updated = snap.generated_at ? new Date(snap.generated_at).toLocaleTimeString() : '';
  summary.textContent =
    `${allSessions.length} sessions · ▶ ${r} running · ✓ ${d} done · ✗ ${f} failed · ${total} total agent calls · updated ${updated}`;

  // 표시는 필터링된 세션만
  const sessions = allSessions
    .map(s => ({ ...s, events: s.events.filter(e => passesFilter(e, q)) }))
    .filter(s => {
      if (s.events.length === 0) return false;
      if (!projQ) return true;
      const proj = (s.project_display || s.project_slug || s.project_cwd || '').toLowerCase();
      return s.events.length > 0 || proj.includes(projQ);
    });

  const wt = snap.wt_status || [];

  const byProject = {};
  for (const s of sessions) {
    const k = projectKey(s);
    (byProject[k] ||= []).push(s);
  }
  const projKeys = Object.keys(byProject).sort((a,b) => {
    const aRun = byProject[a].some(s => s.events.some(e => e.status === 'running'));
    const bRun = byProject[b].some(s => s.events.some(e => e.status === 'running'));
    if (aRun !== bRun) return aRun ? -1 : 1;
    return a.localeCompare(b);
  });

  const out = [];
  for (const key of projKeys) {
    const arr = byProject[key];
    arr.sort((a,b) => (b.last_activity||'').localeCompare(a.last_activity||''));
    out.push(`<section class="project"><h2>${escapeHtml(key)}</h2>`);
    for (const s of arr) {
      out.push(renderSession(s));
    }
    out.push('</section>');
  }

  if (sessions.length === 0) {
    out.push('<div class="muted" style="padding:20px;text-align:center">no agent activity detected yet — start a Claude Code session that calls the Agent tool</div>');
  }

  if (wt.length > 0) {
    out.push('<section class="wt-section"><h2>worktree status (legacy /tmp/wt-status)</h2>');
    for (const w of wt) {
      out.push(`<div class="wt-entry">
        <h3>${escapeHtml(w.worktree)} — ${escapeHtml(w.domain)}</h3>
        <ul>`);
      for (const t of (w.tasks || [])) {
        out.push(`<li class="t-${escapeHtml((t.status||'').toLowerCase())}">[${escapeHtml(t.status)}] ${escapeHtml(t.name)}</li>`);
      }
      out.push(`</ul>
        ${w.branch ? `<div class="branch">${escapeHtml(w.branch)}</div>` : ''}
      </div>`);
    }
    out.push('</section>');
  }

  root.innerHTML = out.join('');

  for (const id of expanded) {
    const el = document.querySelector(`[data-tu="${id}"]`);
    if (el) el.classList.add('open');
  }
  root.querySelectorAll('.event').forEach(node => {
    node.addEventListener('click', () => {
      const id = node.dataset.tu;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      render(lastSnap);
    });
  });
}

function renderSession(s) {
  const sid = (s.session_id || '').slice(0, 8);
  const since = timeSince(s.last_activity);
  const events = [...s.events].sort((a,b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return (b.started_at||'').localeCompare(a.started_at||'');
  });
  const lines = [`<div class="session">
    <div class="session-head">session <code>${escapeHtml(sid)}</code> · <span>${escapeHtml(since)}</span> · ${events.length} agent call(s)</div>`];
  for (const e of events) {
    const cls = `event s-${e.status}`;
    const sub = e.subagent_type || '(fork)';
    const dur = fmtDur(e.duration_sec);
    const icon = ICON[e.status] || '·';
    const desc = e.description || e.prompt_first_line || '(no description)';
    lines.push(`
      <div class="${cls}" data-tu="${escapeHtml(e.tool_use_id)}">
        <span class="icon">${icon}</span>
        <span class="lbl">${escapeHtml(e.status.toUpperCase())}</span>
        <span class="sub">${escapeHtml(sub)}</span>
        <span class="desc">${escapeHtml(desc)}</span>
        <span class="dur">${escapeHtml(dur)}</span>
      </div>`);
    if (expanded.has(e.tool_use_id)) {
      lines.push(`
        <div class="expanded">
          <div class="row"><span class="key">subagent</span> ${escapeHtml(sub)}</div>
          <div class="row"><span class="key">description</span> ${escapeHtml(e.description || '')}</div>
          <div class="row"><span class="key">prompt[0]</span> ${escapeHtml(e.prompt_first_line || '')}</div>
          <div class="row"><span class="key">started</span> ${escapeHtml(e.started_at || '')}</div>
          <div class="row"><span class="key">finished</span> ${escapeHtml(e.finished_at || '(pending)')}</div>
          <div class="row"><span class="key">duration</span> ${escapeHtml(fmtDur(e.duration_sec))}</div>
          <div class="row"><span class="key">tool_use_id</span> ${escapeHtml(e.tool_use_id)}</div>
        </div>`);
    }
  }
  lines.push('</div>');
  return lines.join('');
}

connect();
