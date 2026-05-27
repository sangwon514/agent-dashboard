// agent-dashboard — 로비/방 뷰. 캐릭터는 이모지+CSS 조합.
// 화면 상태: window.location.hash = "" → 로비, "#room/<projectKey>" → 방 안.

const root = document.getElementById('root');
const summary = document.getElementById('summary');
const conn = document.getElementById('conn');

let lastSnap = null;
let openDetail = null; // tool_use_id
let settingsOpen = false;
let lobbySearchQuery = '';
let lobbyFilterActive = false;

// ── 테마 (light=양피지 기본 / dark cozy 팔레트) (localStorage) ──────────
const THEME_KEY = 'agentville.theme.v1';
function loadTheme() { try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; } }
function applyTheme(t) {
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = (t === 'dark') ? '☾' : '☀';
}
window.toggleTheme = function () {
  const next = (loadTheme() === 'dark') ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
};
applyTheme(loadTheme());

// ── 펫 커스터마이즈 (localStorage) ──────────────────────────────
const PET_CONFIG_KEY = 'agentville.pet-config.v1';
let petConfig = (() => {
  try { return JSON.parse(localStorage.getItem(PET_CONFIG_KEY) || '{}'); }
  catch { return {}; }
})();
function savePetConfig() {
  try { localStorage.setItem(PET_CONFIG_KEY, JSON.stringify(petConfig)); }
  catch (e) { console.error(e); }
}

// ── 펫 이름 + 즐겨찾기 (localStorage) ────────────────────────────────
const PET_META_KEY = 'agentville.pet-meta.v1';
let petMeta = (() => {
  try { return JSON.parse(localStorage.getItem(PET_META_KEY) || '{}'); }
  catch { return {}; }
})();
function savePetMeta() {
  try { localStorage.setItem(PET_META_KEY, JSON.stringify(petMeta)); } catch {}
}
function setPetName(type, name) {
  petMeta[type] ||= {};
  petMeta[type].name = (name || '').trim().slice(0, 16);
  if (!petMeta[type].name) delete petMeta[type].name;
  savePetMeta();
}
function togglePetFav(type) {
  petMeta[type] ||= {};
  petMeta[type].fav = !petMeta[type].fav;
  savePetMeta();
}
const PET_DEFAULT_LABELS = {
  'codex-shell':   '쉘',
  'codex-edit':    '편집',
  'codex-exec':    '실행',
  'codex-vscode':  '에디터',
  'codex-desktop': '에디터',
  'codex-ide':     '에디터',
};
function getPetDisplay(type) { return petMeta[type]?.name || PET_DEFAULT_LABELS[type] || type; }
function isPetFav(type) { return !!petMeta[type]?.fav; }

// ── 장면 내 위치 저장 (localStorage) ────────────────────────────────
const SCENE_POS_KEY = 'agentville.scene-positions.v3';
let scenePositions = (() => {
  try { return JSON.parse(localStorage.getItem(SCENE_POS_KEY) || '{}'); }
  catch { return {}; }
})();
function saveScenePositions() {
  try { localStorage.setItem(SCENE_POS_KEY, JSON.stringify(scenePositions)); } catch {}
}
function getScenePos(sessionId, entityKey) {
  const entry = scenePositions[sessionId]?.[entityKey];
  // Only return positions the user explicitly dragged; auto-slot positions are never stored.
  if (!entry || entry.by !== 'user') return null;
  return entry;
}
function setScenePos(sessionId, entityKey, xPct, yPct) {
  scenePositions[sessionId] ||= {};
  scenePositions[sessionId][entityKey] = { x: xPct, y: yPct, by: 'user' };
  saveScenePositions();
}

// ── subagent_type → 펫 외형 매핑 ──────────────────────────────────
// 자주 보이는 타입은 명시. 그 외는 hash 로 동물 풀에서 결정.
const NAMED = {
  'Explore':                    { hat: '🦊', hue: 200 },  // 정찰 — 여우
  'Plan':                       { hat: '🦉', hue: 140 },  // 계획 — 부엉이
  'general-purpose':            { hat: '🐶', hue: 30  },  // 만능 — 강아지
  'claude-code-guide':          { hat: '🐢', hue: 250 },  // 안내 — 거북이
  'claude-practice-researcher': { hat: '🐱', hue: 200 },  // 연구 — 고양이
  'code-reviewer':              { hat: '🦅', hue: 0   },  // 검수 — 매
  'security-review':            { hat: '🦔', hue: 350 },  // 보안 — 고슴도치
  'statusline-setup':           { hat: '🐰', hue: 280 },  // 토끼
  'dev':                        { hat: '🐺', hue: 220 },  // 개발 — 늑대
  'surveyor':                   { hat: '🦦', hue: 180 },  // 수달
};
// 동물 풀 (그 외 타입)
const HAT_POOL = ['🐹','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆'];

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function styleFor(subagent_type) {
  const t = subagent_type || '익명';
  // 사용자 오버라이드 우선
  const cfg = petConfig[t] || {};
  let base;
  if (NAMED[t]) base = { ...NAMED[t], klass: t };
  else {
    const h = djb2(t);
    base = { hat: HAT_POOL[h % HAT_POOL.length], hue: h % 360, klass: t };
  }
  if (cfg.hue != null) base.hue = cfg.hue;
  if (cfg.label) base.klass = cfg.label;
  return base;
}
function bodyColor(hue) {
  return `hsl(${hue}, 55%, 70%)`;
}
function bodyColorDark(hue) {
  return `hsl(${hue}, 50%, 45%)`;
}
function hairColor(hue) {
  return `hsl(${hue}, 60%, 38%)`;
}
function hairColorDark(hue) {
  return `hsl(${hue}, 55%, 22%)`;
}

// ── 픽셀아트 스프라이트 ─────────────────────────────────────────
// 16x16 격자. 한 칸 = 한 픽셀. CSS variable 로 색 입힘.
//   . = 투명, L = 본체, D = 아웃라인/그림자, E = 눈, M = 입,
//   A = 강조1 (귀/날개 안쪽), B = 강조2 (배/볼)
// 각 스프라이트는 frame1(idle) + frame2(walk) 두 단계.
// 단일 배열만 들어있는 경우는 walk 프레임이 idle 과 동일.
const SPRITES = {
  // blob — 하찮귀 16×16 젤리 블롭. 통통하고 단순, 빈 공간 많음.
  // 실루엣: 둥근 돔형, 위쪽 넓고 아래로 살짝 좁아짐
  // 비대칭: 왼눈(R6 col6) 한 줄 위, 오른눈(R7 col8) 한 칸 오른쪽; L 하이라이트 오른편 치우침
  blob: [[
    "................",
    "................",
    "................",
    "................",
    ".....DDDDDD.....",
    "....DAAAAALD....",
    "....DAMAAAAD....",
    "....DAAAMAAD....",
    "....DAAAAAD.....",
    ".....DDDDD......",
    "......DDDD......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "................",
    "................",
    "................",
    "................",
    ".....DDDDDD.....",
    "....DAAAAALD....",
    "....DAAAAAAD....",
    "....DAAAMAAD....",
    "....DAAMAAD.....",
    ".....DDDDD......",
    "......DDDD......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 새형 (bird) — 날갯짓 (32×32)
  // 실루엣: 둥근 머리 + 날개 + 꼬리 + 두 발
  // 비대칭: 왼쪽 날개 1px 더 낮음, 부리 오른쪽 1px 치우침
  bird: [[
    "................................",
    "................................",
    "..........LLLLLLLLLL............",
    ".........LDDDDDDDDDDL...........",
    "........LDLLLLLLLLLLLD..........",
    "........DLLLLLLLLLLLLLD........",
    ".......DLLLEEEEELLLEEELD........",
    ".......DLLLEEEEELLLEEELD........",
    ".......DLLLLLLLLLLLLLLLD........",
    ".......DLLLLLLAAALLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLLD........",
    "......DLLLLLLLLLLLLLLLLD........",
    "......DLLLLLLLLLLLLLLLLLD.......",
    "......DLLLLLLLLLLLLLLLLLLD......",
    ".....DLLLLLLLLLLLLLLLLLLLD......",
    ".....DDDDDDDDDDDDDDDDDDDDD......",
    "......DLLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLD.........",
    ".......DDLLLLLLLLLLDD...........",
    ".........DDDDDDDDDD.............",
    "........DD........DD............",
    "........DD........DD............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    "..........LLLLLLLLLL............",
    ".........LDDDDDDDDDDL...........",
    "........LDLLLLLLLLLLLD..........",
    ".......DLLLLLLLLLLLLLLLD........",   // 날개 펼침 — 1px 더 넓음
    "......DLLLLEEEEELLLEEELLD.......",
    "......DLLLLEEEEELLLEEELLD.......",
    ".......DLLLLLLLLLLLLLLLD........",
    ".......DLLLLLLAAALLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLLD........",
    "......DLLLLLLLLLLLLLLLLD........",
    "......DLLLLLLLLLLLLLLLLLD.......",
    "......DLLLLLLLLLLLLLLLLLLD......",
    ".....DLLLLLLLLLLLLLLLLLLLD......",
    ".....DDDDDDDDDDDDDDDDDDDDD......",
    "......DLLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLD.........",
    ".......DDLLLLLLLLLLDD...........",
    ".........DDDDDDDDDD.............",
    ".........DD......DD.............",
    ".........DD......DD.............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    "..........LLLLLLLLLL............",
    ".........LDDDDDDDDDDL...........",
    "........LDLLLLLLLLLLLD..........",
    "........DLLLLLLLLLLLLLD........",
    ".......DLLLLLLLLLLLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    ".......DLLLLLLLLLLLLLLLD........",
    ".......DLLLLLLAAALLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLLD........",
    "......DLLLLLLLLLLLLLLLLD........",
    "......DLLLLLLLLLLLLLLLLLD.......",
    "......DLLLLLLLLLLLLLLLLLLD......",
    ".....DLLLLLLLLLLLLLLLLLLLD......",
    ".....DDDDDDDDDDDDDDDDDDDDD......",
    "......DLLLLLLLLLLLLLLLD.........",
    "......DLLLLLLLLLLLLLLLD.........",
    ".......DDLLLLLLLLLLDD...........",
    ".........DDDDDDDDDD.............",
    "........DD........DD............",
    "........DD........DD............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 강아지/늑대형 — 귀 흔들기 + 발 교차 (32×32)
  // 비대칭: 왼쪽 귀 1행 더 김, 오른발 앞으로
  pup: [[
    "....DDDD........DDDD............",
    "....DLLD........DLLD............",
    "....DLLD........DLLD............",
    "....DLLDDDDDDDDDDLLD............",
    "....DLLLLLLLLLLLLLLD............",
    "...DLLLLLLLLLLLLLLLLLD..........",
    "...DLLLLLLLLLLLLLLLLLD..........",
    "...DLLLEEEEELLLLEEEELD..........",
    "...DLLLEEEEELLLLEEEELD..........",
    "...DLLLEEEEELLLLEEEELD..........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLAAALLLLLLLLD...........",
    "...DLLLLLMMMMLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "....DLLLLLLLLLLLLLLLD...........",
    ".....DLLLLLLLLLLLLLD............",
    "......DDDDDDDDDDDDDD............",
    ".......DLLLLLLLLLD..............",
    ".......DLLLLLLLLLD..............",
    ".......DDDDDDDDDDDD.............",
    ".......DD........DD.............",
    ".......DD........DD.............",
    "......DDDD......DDDD............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "....DDDD........DDDD............",
    "....DLLD........DLLD............",
    "....DLLD........DLLD............",
    "....DLLDDDDDDDDDDLLD............",
    "....DLLLLLLLLLLLLLLD............",
    "...DLLLLLLLLLLLLLLLLLD..........",
    "...DLLLLLLLLLLLLLLLLLD..........",
    "...DLLLEEEEELLLLEEEELD..........",
    "...DLLLEEEEELLLLEEEELD..........",
    "...DLLLEEEEELLLLEEEELD..........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLAAALLLLLLLLD...........",
    "...DLLLLLMMMMLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "....DLLLLLLLLLLLLLLLD...........",
    ".....DLLLLLLLLLLLLLD............",
    "......DDDDDDDDDDDDDD............",
    ".......DLLLLLLLLLD..............",
    ".......DLLLLLLLLLD..............",
    ".......DDDDDDDDDDDD.............",
    "........DD......DD..............",   // 발 모음 (walk frame)
    "........DD......DD..............",
    ".......DDDD....DDDD.............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "....DDDD........DDDD............",
    "....DLLD........DLLD............",
    "....DLLD........DLLD............",
    "....DLLDDDDDDDDDDLLD............",
    "....DLLLLLLLLLLLLLLD............",
    "...DLLLLLLLLLLLLLLLLLD..........",
    "...DLLLLLLLLLLLLLLLLLD..........",
    "...DLLLLLLLLLLLLLLLLD...........",   // blink
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLAAALLLLLLLLD...........",
    "...DLLLLLMMMMLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "....DLLLLLLLLLLLLLLLD...........",
    ".....DLLLLLLLLLLLLLD............",
    "......DDDDDDDDDDDDDD............",
    ".......DLLLLLLLLLD..............",
    ".......DLLLLLLLLLD..............",
    ".......DDDDDDDDDDDD.............",
    ".......DD........DD.............",
    ".......DD........DD.............",
    "......DDDD......DDDD............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 슬라임 — 종 모양 바디 (32×32), DQ슬라임 풍
  // 비대칭: 왼쪽 눈 1px 더 높음, 입 M 1px 우편향
  slime: [[
    "................................",
    "................................",
    "...........DDDDDDDDDD...........",
    ".........DDLLLLLLLLLLDD.........",
    ".......DDLLLLLLLLLLLLLLDD.......",
    "......DLLLLLLLLLLLLLLLLLLD......",
    ".....DLLLLLLLLLLLLLLLLLLLLLD....",
    ".....DLLLEEEEELLLLLLEEEELLLLD...",
    ".....DLLLEEEEELLLLLLEEEELLLLD...",
    ".....DLLLEEEEELLLLLLEEEELLLLD...",
    "....DLLLLLLLLLLLLLLLLLLLLLLLD...",
    "....DLLLLLLLMMMMMMLLLLLLLLLLD...",
    "....DLLLLLLLLLLLLLLLLLLLLLLD....",
    "....DLLLLLLLLLLLLLLLLLLLLLLD....",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "....DLLLLLLLLLLLLLLLLLLLLLLLDD..",
    ".....DLLLLLLLLLLLLLLLLLLLLDD....",
    "......DDLLLLLLLLLLLLLLLLDD......",
    "........DDDDDDDDDDDDDDDD........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    "...........DDDDDDDDDD...........",
    ".........DDLLLLLLLLLLDD.........",
    ".......DDLLLLLLLLLLLLLLDD.......",
    "......DLLLLLLLLLLLLLLLLLLD......",
    ".....DLLLLLLLLLLLLLLLLLLLLLD....",
    ".....DLLLEEEEELLLLLLEEEELLLLD...",
    ".....DLLLEEEEELLLLLLEEEELLLLD...",
    ".....DLLLEEEEELLLLLLEEEELLLLD...",
    "....DLLLLLLLLLLLLLLLLLLLLLLLD...",
    "....DLLLLLLLMMMMMMLLLLLLLLLLD...",
    "....DLLLLLLLLLLLLLLLLLLLLLLD....",
    "....DLLLLLLLLLLLLLLLLLLLLLLD....",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",   // squash frame: base 1줄 wider
    "....DLLLLLLLLLLLLLLLLLLLLLLLDD..",
    ".....DDLLLLLLLLLLLLLLLLLLLDDD...",
    "......DDDDDDDDDDDDDDDDDDDDD.....",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    "...........DDDDDDDDDD...........",
    ".........DDLLLLLLLLLLDD.........",
    ".......DDLLLLLLLLLLLLLLDD.......",
    "......DLLLLLLLLLLLLLLLLLLD......",
    ".....DLLLLLLLLLLLLLLLLLLLLLD....",
    ".....DLLLLLLLLLLLLLLLLLLLLLLD...",   // blink
    ".....DLLLLLLLLLLLLLLLLLLLLLLD...",
    ".....DLLLLLLLLLLLLLLLLLLLLLLD...",
    "....DLLLLLLLLLLLLLLLLLLLLLLLD...",
    "....DLLLLLLLMMMMMMLLLLLLLLLLD...",
    "....DLLLLLLLLLLLLLLLLLLLLLLD....",
    "....DLLLLLLLLLLLLLLLLLLLLLLD....",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "...DLLLLLLLLLLLLLLLLLLLLLLLLLD..",
    "....DLLLLLLLLLLLLLLLLLLLLLLLDD..",
    ".....DLLLLLLLLLLLLLLLLLLLLDD....",
    "......DDLLLLLLLLLLLLLLLLDD......",
    "........DDDDDDDDDDDDDDDD........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 토끼 — 길고 늘어진 귀의 둥근 토끼 (32×32)
  // 비대칭: 왼쪽 귀 살짝 기울어짐 (1px lean), 오른발 앞으로
  bunny: [[
    "....LLDD........DDLL............",
    "....LDLD........DLDL............",
    "...LDDLDL......LDLDD............",
    "...LDDLLLDL..LDLLDD.............",
    "...DLLLLLLLDLLDLLLLD............",
    "...DLLLLLLLLLLLLLLLD............",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLEEEEELLLLEEELD...........",
    "...DLLLEEEEELLLLEEELD...........",
    "...DLLLEEEEELLLLEEELD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLAAALLLLLLLLD...........",
    "...DLLLLLLMMMMLLLLLD............",
    "...DLLLLLLLLLLLLLLLLD...........",
    "....DLLLLLLLLLLLLLLLD...........",
    ".....DLLLLLLLLLLLLLD............",
    "......DDDDDDDDDDDDDD............",
    ".......DLLLLLLLLLD..............",
    ".......DLLLLLLLLLD..............",
    ".......DDDDDDDDDDDD.............",
    ".......DD........DD.............",
    ".......DD........DD.............",
    "......DDDD......DDDD............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "....LLDD........DDLL............",
    "....LDLD........DLDL............",
    "...LDDLDL......LDLDD............",
    "...LDDLLLDL..LDLLDD.............",
    "...DLLLLLLLDLLDLLLLD............",
    "...DLLLLLLLLLLLLLLLD............",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLEEEEELLLLEEELD...........",
    "...DLLLEEEEELLLLEEELD...........",
    "...DLLLEEEEELLLLEEELD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLAAALLLLLLLLD...........",
    "...DLLLLLLMMMMLLLLLD............",
    "...DLLLLLLLLLLLLLLLLD...........",
    "....DLLLLLLLLLLLLLLLD...........",
    ".....DLLLLLLLLLLLLLD............",
    "......DDDDDDDDDDDDDD............",
    ".......DLLLLLLLLLD..............",
    ".......DLLLLLLLLLD..............",
    ".......DDDDDDDDDDDD.............",
    "........DD......DD..............",   // 발 모음
    "........DD......DD..............",
    ".......DDDD....DDDD.............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "....LLDD........DDLL............",
    "....LDLD........DLDL............",
    "...LDDLDL......LDLDD............",
    "...LDDLLLDL..LDLLDD.............",
    "...DLLLLLLLDLLDLLLLD............",
    "...DLLLLLLLLLLLLLLLD............",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",   // blink
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLLLLLLLLLLLLD...........",
    "...DLLLLLAAALLLLLLLLD...........",
    "...DLLLLLLMMMMLLLLLD............",
    "...DLLLLLLLLLLLLLLLLD...........",
    "....DLLLLLLLLLLLLLLLD...........",
    ".....DLLLLLLLLLLLLLD............",
    "......DDDDDDDDDDDDDD............",
    ".......DLLLLLLLLLD..............",
    ".......DLLLLLLLLLD..............",
    ".......DDDDDDDDDDDD.............",
    ".......DD........DD.............",
    ".......DD........DD.............",
    "......DDDD......DDDD............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 토끼 — 통통하고 귀가 길게 위로 (bunny 와 차별: 직립 귀, 작은 꼬리)
  rabbit: [[
    "...DD......DD...",
    "..DLLD....DLLD..",
    "..DLLD....DLLD..",
    "..DLLD....DLLD..",
    "..DLLDDDDDDLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLLLLAALLLLLD.",
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLDLL",
    "..DLLLLLLLLLLDL.",
    "..DLLLLLLLLLLD..",
    "...DDDDDDDDDD...",
    "....DD....DD....",
    "...DDD....DDD...",
  ], [
    "...DD......DD...",
    "..DLLD....DLLD..",
    "..DLLD....DLLD..",
    "..DLLD....DLLD..",
    "..DLLDDDDDDLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLLLLAALLLLLD.",
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLDLL",
    "..DLLLLLLLLLLDL.",
    "..DLLLLLLLLLLD..",
    "...DDDDDDDDDD...",
    "....DD.....DD...",
    "....DDD...DDD...",
  ]],
  // 별 — 5-point 기하학 별 (32×32), Pokémon Gen-2 Staryu 실루엣
  // 비대칭: 위 점 1px 왼쪽 기울음, 왼쪽 팔 2px 더 넓음
  star: [[
    "................................",
    "................................",
    "..............DDDD..............",
    ".............DLLLLD.............",
    "............DLLLLLLD............",
    "...........DLLLLLLLD............",
    "....DDDDDDLLLLLLLLLLDDDDDD......",
    "...DDDLLLLLLLLLLLLLLLLLLDDD.....",
    "...DLLLLLLEEEEELLLLEEEEELLD.....",
    "...DLLLLLLEEEEELLLLEEEEELLD.....",
    "...DLLLLLLEEEEELLLLEEEEELLD.....",
    "...DLLLLLLLLLLLLLLLLLLLLLLD.....",
    "...DLLLLLLLLMMMMMMLLLLLLLLD.....",
    "...DLLLLLLLLLLLLLLLLLLLLLLD.....",
    "....DDDDDDDDDDDDDDDDDDDDDD......",
    ".........DLLLLLLLLLLLD..........",
    "........DLLLLLLLLLLLLD..........",
    ".......DLLLLLLLLLLLLLD..........",
    "......DDLLLLLLLLLLLLDDD.........",
    "......DDDD........DDDD..........",
    ".......DD..........DD...........",
    ".......DD..........DD...........",
    "......DDDD........DDDD..........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    "..............DDDD..............",
    ".............DLLLLD.............",
    "............DLLLLLLD............",
    "...........DLLLLLLLD............",
    "....DDDDDDLLLLLLLLLLDDDDDD......",
    "...DDDLLLLLLLLLLLLLLLLLLDDD.....",
    "...DLLLLLLEEEEELLLLEEEEELLD.....",
    "...DLLLLLLEEEEELLLLEEEEELLD.....",
    "...DLLLLLLEEEEELLLLEEEEELLD.....",
    "...DLLLLLLLLLLLLLLLLLLLLLLD.....",
    "...DLLLLLLLLMMMMMMLLLLLLLLD.....",
    "...DLLLLLLLLLLLLLLLLLLLLLLD.....",
    "....DDDDDDDDDDDDDDDDDDDDDD......",
    ".........DLLLLLLLLLLLD..........",
    "........DLLLLLLLLLLLLD..........",
    ".......DLLLLLLLLLLLLLD..........",
    "......DDLLLLLLLLLLLLDDD.........",
    "......DDDD........DDDD..........",
    ".......DD..........DD...........",
    "........DD........DD............",   // 살짝 모임 (twinkle)
    ".......DDDD......DDDD...........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 개구리/두꺼비 — 짧고 넓적 (32×32)
  // 비대칭: 왼쪽 눈 봉우리 1px 더 높음, 오른발 앞으로
  frog: [[
    "................................",
    "................................",
    ".....DDDD..........DDDD.........",
    "....DLLLLDD......DDLLLD.........",
    "....DLEEELLD....DLEEEELD........",
    "....DLEEELLD....DLEEEELD........",
    "....DLLLLLDLLLLLDLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLLD.......",
    "....DLLLLLLLLLLLLLLLLLLLD.......",
    "....DLLLLLLAAAALLLLLLLLD........",
    "....DLLLLLMMMMMMLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    ".....DLLLLLLLLLLLLLLLLLD........",
    "......DDDDDDDDDDDDDDDDDD........",
    ".......DLLLLLLLLLLLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    "......DDDLLLLLLLLLLLDDD.........",
    ".....DDD....DDDD....DDD.........",
    ".....DD......DD......DD.........",
    ".....DD......DD......DD.........",
    "....DDDD....DDDD....DDDD........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    ".....DDDD..........DDDD.........",
    "....DLLLLDD......DDLLLD.........",
    "....DLEEELLD....DLEEEELD........",
    "....DLEEELLD....DLEEEELD........",
    "....DLLLLLDLLLLLDLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLLD.......",
    "....DLLLLLLLLLLLLLLLLLLLD.......",
    "....DLLLLLLAAAALLLLLLLLD........",
    "....DLLLLLMMMMMMLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    ".....DLLLLLLLLLLLLLLLLLD........",
    "......DDDDDDDDDDDDDDDDDD........",
    ".......DLLLLLLLLLLLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    "......DDDLLLLLLLLLLLDDD.........",
    "......DDD..DDDD....DDD..........",   // 발 hop 안쪽
    "......DD....DD......DD..........",
    "......DD....DD......DD..........",
    ".....DDDD..DDDD....DDDD.........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    ".....DDDD..........DDDD.........",
    "....DLLLLDD......DDLLLD.........",
    "....DLLLLLD......DLLLLLLD.......",   // blink
    "....DLLLLLD......DLLLLLLD.......",
    "....DLLLLLDLLLLLDLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLLD.......",
    "....DLLLLLLLLLLLLLLLLLLLD.......",
    "....DLLLLLLAAAALLLLLLLLD........",
    "....DLLLLLMMMMMMLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    ".....DLLLLLLLLLLLLLLLLLD........",
    "......DDDDDDDDDDDDDDDDDD........",
    ".......DLLLLLLLLLLLLLLD.........",
    ".......DLLLLLLLLLLLLLLD.........",
    "......DDDLLLLLLLLLLLDDD.........",
    ".....DDD....DDDD....DDD.........",
    ".....DD......DD......DD.........",
    ".....DD......DD......DD.........",
    "....DDDD....DDDD....DDDD........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 알 (egg) — 빈 세션 placeholder
  // frame2: 상단 1px 오른쪽 기울기 (살짝 흔들림 — 알이 깨어날 것 같은 느낌)
  egg: [[
    "................",
    "................",
    ".......LL.......",
    "......LDDL......",
    ".....LDLLDL.....",
    "....LDLLLLDL....",
    "...LDLLBBLLDL...",
    "..LDLLLLLLLLDL..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLLBBLLBBLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DDLLLLLLDD...",
    "....DDDDDDDD....",
    "................",
  ], [
    "................",
    "................",
    "........LL......",   // 상단 1px 오른쪽 (rock right)
    ".......LDDL.....",
    "......LDLLDL....",
    ".....LDLLLLDL...",
    "....LDLLBBLLDL..",
    "...LDLLLLLLLLDL.",
    "..DLLLLLLLLLLD..",   // 하단 기준 유지
    ".DLLLLLLLLLLLLD.",
    ".DLLLBBLLBBLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DDLLLLLLDD...",
    "....DDDDDDDD....",
    "................",
  ]],
  // 사람 (세션의 주인공) — 32w × 32h, chubby chibi 2프레임
  // 얼굴: 눈 5×5 (rows6-10), 입 6×2 (rows12-13). D 색으로 또렷.
  // 비율: 머리 22w × 16h (rows0-15), 몸+팔 16w (rows18-22), 다리 3w + 발 5w.
  // 픽셀 정사각형 (1.5×1.5 at scale3). hair 16×20 overlay 와 같은 48×48 캔버스 차지.
  human: [[
    ".......DDDDDDDDDDDDDDDDDD.......",   // 00 head top 18w (cols 7-24)
    "......DLLLLLLLLLLLLLLLLLLD......",   // 01 forehead taper 20w
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 02 forehead full 22w (cols 5-26)
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 03
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 04
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 05
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 06 forehead (eyebrows removed — read as mask)
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 07 forehead (gap before eyes)
    ".....DLLLDDDDLLLLLLDDDDLLLD.....",   // 08 eyes 4×4
    ".....DLLLDDDDLLLLLLDDDDLLLD.....",   // 09
    ".....DLLLDDDDLLLLLLDDDDLLLD.....",   // 10
    ".....DLBBLLLLLLLLLLLLLLBBLD.....",   // 11 blush dots (B = peach)
    ".....DLLLLLLLLDDDDLLLLLLLLD.....",   // 12 mouth 4w (smaller, dumbo)
    ".....DLLLLLLLLDDDDLLLLLLLLD.....",   // 13
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 14 chin
    "......DLLLLLLLLLLLLLLLLLLD......",   // 15 jaw taper
    ".......DDDDDDDDDDDDDDDDDD.......",   // 16 jaw bottom 18w
    ".............DLLLLLD............",   // 17 neck 5w (cols 14-18)
    ".........DCCCCCCCCCCCCCD........",   // 18 shoulder body 14w (cols 9-22)
    ".......DCCCCCCCCCCCCCCCCD.......",   // 19 body+arms 18w (cols 7-24)
    ".......DCCCCCCCCCCCCCCCCD.......",   // 20
    ".......DCCCCCCCCCCCCCCCCD.......",   // 21
    ".......DCCCCCCCCCCCCCCCCD.......",   // 22 arms end
    ".........DCCCCCCCCCCCCCD........",   // 23 body bottom
    ".........DDDDDDDDDDDDDDD........",   // 24 hem (dark)
    "..........DDD......DDD..........",   // 25 legs 3w each, gap 6w
    "..........DDD......DDD..........",   // 26
    "..........DDD......DDD..........",   // 27
    "..........DDD......DDD..........",   // 28
    ".........DDDDD....DDDDD.........",   // 29 feet 5w each, gap 4w
    "................................",   // 30
    "................................",   // 31
  ], [
    ".......DDDDDDDDDDDDDDDDDD.......",   // 00 same head
    "......DLLLLLLLLLLLLLLLLLLD......",   // 01
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 02
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 03
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 04
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 05
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 06 forehead (face static)
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 07 gap
    ".....DLLLDDDDLLLLLLDDDDLLLD.....",   // 08 eyes
    ".....DLLLDDDDLLLLLLDDDDLLLD.....",   // 09
    ".....DLLLDDDDLLLLLLDDDDLLLD.....",   // 10
    ".....DLBBLLLLLLLLLLLLLLBBLD.....",   // 11 blush
    ".....DLLLLLLLLDDDDLLLLLLLLD.....",   // 12 mouth
    ".....DLLLLLLLLDDDDLLLLLLLLD.....",   // 13
    ".....DLLLLLLLLLLLLLLLLLLLLD.....",   // 14
    "......DLLLLLLLLLLLLLLLLLLD......",   // 15
    ".......DDDDDDDDDDDDDDDDDD.......",   // 16
    ".............DLLLLLD............",   // 17
    ".........DCCCCCCCCCCCCCD........",   // 18
    ".......DCCCCCCCCCCCCCCCCD.......",   // 19 body+arms same
    ".......DCCCCCCCCCCCCCCCCD.......",   // 20
    ".......DCCCCCCCCCCCCCCCCD.......",   // 21
    ".......DCCCCCCCCCCCCCCCCD.......",   // 22
    ".........DCCCCCCCCCCCCCD........",   // 23
    ".........DDDDDDDDDDDDDDD........",   // 24
    "........DDD..........DDD........",   // 25 walk: legs shift outward 2 cols (cols 8-10, 21-23)
    "........DDD..........DDD........",   // 26
    "........DDD..........DDD........",   // 27
    "........DDD..........DDD........",   // 28
    ".......DDDDD........DDDDD.......",   // 29 feet wider stance (cols 7-11, 20-24)
    "................................",   // 30
    "................................",   // 31
  ]],
  // 머리카락 오버레이 — 16w × 20h, 머리 영역(rows 1-8)만 색, 나머지 투명
  // H = hair-light (--hair), K = hair-dark (--hair-dark) — frontend-dev 가 CSS 변수 추가 예정
  'hair-short': [[
    "......K.........",   // 0 ahoge — 1px hair tip 위로 (chibi 시그니처)
    "...KKKKKKKKKK...",   // 1 정수리 outline
    "..KKHHHHHHHHKK..",   // 2 크라운 interior H (머리 상단 shading, 얼굴 위)
    "..KKKKKKKKKKKK..",   // 3 bangs K only (얼굴 위치 — H 띠 X)
    ".KKKKKKKKKKKKKK.",   // 4 bangs wider K
    "..K..........K..",   // 5 side wisps
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "......K.........",   // frame2 = frame1 (hair static)
    "...KKKKKKKKKK...",
    "..KKHHHHHHHHKK..",
    "..KKKKKKKKKKKK..",
    ".KKKKKKKKKKKKKK.",
    "..K..........K..",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  'hair-long': [[
    "................",
    "...KKKKKKKKKK...",   // 1 정수리 outline
    "..KKHHHHHHHHKK..",   // 2 크라운 interior H (머리 상단 shading)
    ".KKKKKKKKKKKKKK.",   // 3 bangs K only (얼굴 위치)
    ".KK..........KK.",   // 4 side curtain — 가운데 비움
    ".KK..........KK.",   // 5
    ".KK..........KK.",   // 6
    ".KK..........KK.",   // 7 longest curtain
    "..KK........KK..",   // 8 안쪽 taper
    "................",   // 9
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "................",
    "...KKKKKKKKKK...",   // frame2 same as frame1
    "..KKHHHHHHHHKK..",
    ".KKKKKKKKKKKKKK.",
    ".KK..........KK.",
    ".KK..........KK.",
    ".KK..........KK.",
    ".KK..........KK.",
    "..KK........KK..",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  'hair-bun': [[
    ".....KKKK.......",   // 0 묶음 윗부분 (bun top)
    "....KKHHKK......",   // 1 묶음 본체 (H interior — bun shading)
    "...KKKKKKKKKK...",   // 2 정수리 outline
    "..KKHHHHHHHHKK..",   // 3 크라운 interior H
    "..KKKKKKKKKKKK..",   // 4 bangs K only (얼굴 위치)
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    ".....KKKK.......",   // frame2 same as frame1
    "....KKHHKK......",
    "...KKKKKKKKKK...",
    "..KKHHHHHHHHKK..",
    "..KKKKKKKKKKKK..",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 스파이크 헤어 오버레이 — 16w × 20h, rows 0-3 만 사용
  // 4개 스파이크, 각 2px 폭 (no single-pixel tips), 비대칭: 4번째 스파이크 오른쪽에 큰 간격
  'hair-spiky': [[
    "..KK.KK.KK..KK..",   // 0 스파이크 팁 (4 spikes, asymm)
    "..KKKKKKKKKKKK..",   // 1 스파이크 베이스 outline
    "..KKHHHHHHHHKK..",   // 2 헤드 인테리어 H (머리 상단 shading)
    ".KKKKKKKKKKKKKK.",   // 3 앞머리 K only (얼굴 위치)
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "..KK.KK.KK..KK..",   // frame2 same as frame1
    "..KKKKKKKKKKKK..",
    "..KKHHHHHHHHKK..",
    ".KKKKKKKKKKKKKK.",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 포니테일 헤어 오버레이 — 16w × 20h
  // 오른쪽으로 빠진 묶음 (asymmetry: 오른쪽 전용), 끝부분 2px 캡
  'hair-ponytail': [[
    "................",
    "...KKKKKKKKKK...",   // 1 정수리 outline
    "..KKHHHHHHHHKK..",   // 2 헤드 인테리어 H (머리 상단 shading)
    "..KKKKKKKKKKKK..",   // 3 앞머리 K only (얼굴 위치)
    ".............KKK",   // 4 포니테일 상단 (오른쪽)
    ".............KKK",   // 포니테일 중단
    "..............KK",   // 포니테일 끝 (2px 캡)
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "................",   // frame2 same as frame1
    "...KKKKKKKKKK...",
    "..KKHHHHHHHHKK..",
    "..KKKKKKKKKKKK..",
    ".............KKK",
    ".............KKK",
    "..............KK",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 비니 액세서리 오버레이 — 16w × 20h
  // A = 비니 본체(강조색), K = 브림/심 라인, pom-pom 오른쪽 치우쳐 비대칭
  // frontend-dev: A는 --accessory-beanie CSS var 필요 (hair H/K 와 구분)
  'accessory-beanie': [[
    "........KK......",   // pom-pom — 2px, 중앙 오른쪽 치우침 = 비대칭
    "..AAAAAAAAAAAAA.",   // 비니 탑 — 오른쪽 1px 넓어 (2+13+1=16, 비대칭)
    "..AAAAAAAAAAAA..",   // 비니 몸통 (12 wide)
    "..KKKKKKKKKKKK..",   // 브림 심 라인 (seam, K = dark)
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "........KK......",   // frame2 same as frame1 — beanie static
    "..AAAAAAAAAAAAA.",
    "..AAAAAAAAAAAA..",
    "..KKKKKKKKKKKK..",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 브랜드 하우스 아이콘 — 뾰족 지붕 + 직사각 몸통 + 문
  'brand-house': [
    "................",
    "........D.......",
    ".......DLD......",
    "......DLLLD.....",
    ".....DLLLLLLD...",
    "....DLLLLLLLL...",
    "...DLLLLLLLLLLD.",
    "..DDDDDDDDDDDD..",
    "..DLLLLLLLLLLD..",
    "..DLLLDDDLLLLD..",
    "..DLLLDDDDLLLD..",
    "..DLLLDDDLLLLD..",
    "..DLLLDDDDLLLD..",
    "..DLLLLLLLLLL...",
    "..DDDDDDDDDDDD..",
    "................",
  ],
  // 문 아이콘 — 세로 직사각형, 둥근 상단, 손잡이
  door: [
    "................",
    "....DDDDDDDD....",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLL.LLLD...",
    "...DLLLLDLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DDDDDDDDDD...",
    "................",
  ],
  // 톱니바퀴 — 6-tooth, 가운데 구멍
  cog: [
    "......DDD.......",
    "....DDLLLDD.....",
    "....DLLLLLLD....",
    "..DDDLLLLLLDDD..",
    "..DLLLLLLLLLLD..",
    "..DLLL.DDD.LLD..",
    "..DLLL.D.D.LLD..",
    "..DLLL.DDD.LLD..",
    "..DLLLLLLLLLLD..",
    "..DDLLLLLLLLDD..",
    "....DLLLLLLD....",
    "....DDLLLDD.....",
    "......DDD.......",
    "................",
    "................",
    "................",
  ],
  // 뒤로가기 화살표 — 왼쪽 화살표 + 가로 막대
  'arrow-back': [
    "................",
    "................",
    "....D...........",
    "...DD...........",
    "..DDD...........",
    ".DDDD..DDDDDDD..",
    "DDDDDDDDDDDDDDD.",
    ".DDDD..DDDDDDD..",
    "..DDD...........",
    "...DD...........",
    "....D...........",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  // 벽시계 — 원형 외곽, 시침/분침, 눈금
  'wall-clock': [
    "................",
    "....DDDDDDDD....",
    "...DLL....LLD...",
    "..DLL.DDDD.LLD..",
    "..DL.DLLLLD.LD..",
    "..DL.DLLLLL.LD..",
    "..DL.DLLLLDDLD..",
    "..DL.DLL...LLD..",
    "..DL..DDDDLLLD..",
    "..DLL......LLD..",
    "...DLL....LLD...",
    "....DDDDDDDD....",
    "................",
    "................",
    "................",
    "................",
  ],
  // 침엽수 — 삼각형 잎 + 좁은 줄기
  'tree-pine': [
    ".......DD.......",
    ".......DLD......",
    "......DLLLD.....",
    ".....DLLLLL.....",
    "....DLLLLLLLD...",
    "...DLLLLLLLLL...",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLL..",
    "DLLLLLLLLLLLLLLD",
    ".DLLLLLLLLLLLLD.",
    "..DDLLLLLLLDD...",
    "....DLLLLLD.....",
    ".....DLLLLD.....",
    ".....DLLLLLD....",
    "......DDDDDD....",
    "................",
  ],
  // 둥근 덤불 — 낮고 넓은 블롭
  'tree-bush': [
    "................",
    "................",
    "................",
    "....DDDDDDD.....",
    "...DLLLLLLLLD...",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLLD",
    ".DLLLLLLLLLLLLLD",
    ".DLLLLLLLLLLLLLD",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDLLLLLLLDD..",
    ".....DLLLLD.....",
    ".....DLLLLD.....",
    "......DDDDDD....",
    "................",
  ],
  // 풀 다발 — 아래쪽 1/3만 사용
  'grass-tuft': [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...D.....D......",
    "..DLD...DLD.....",
    ".DLLD..DLLD.....",
    "DLLLD.DLLLD.....",
    "DLLLLDDLLLD.....",
    "DLLLLLLLLD......",
    "DDDDDDDDD.......",
    "................",
  ],
  // 작은 구름 — 위쪽 절반만 사용
  'cloud-small': [
    "................",
    "...DDDDD........",
    "..DLLLLLDD......",
    ".DLLLLLLLLD.....",
    "DLLLLLLLLLLDD...",
    "DLLLLLLLLLLLLD..",
    "DLLLLLLLLLLLLLD.",
    ".DDDDDDDDDDDDDD.",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  // 벽 액자 — 가로형 프레임, 가운데 L 캔버스
  'painting-frame': [
    "................",
    "................",
    "...DDDDDDDDDD...",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLDLLLLDLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLDLLLLDLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDDDDDDDDD...",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  // 책장 — 세로형, 가로 칸막이 2개로 책줄 표현
  bookshelf: [
    "................",
    "....DDDDDDDD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DDDDDDDD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DDDDDDDD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DDDDDDDD....",
    "................",
    "................",
  ],
  // 화분 — 아래 화분(D 외곽) + 위 잎사귀(L + D 가지)
  'plant-pot': [
    "................",
    "................",
    ".....DDDDD......",
    "....DLLLLLD.....",
    "...DLLLDLLLD....",
    "...DLLLDLLLD....",
    "....DLLLLLLD....",
    ".....DLLLLLD....",
    "......DDDDD.....",
    "......DLLLD.....",
    ".....DDLLLDD....",
    ".....DLLLLLD....",
    ".....DLLLLD.....",
    "......DDDDD.....",
    "................",
    "................",
  ],
  // 카펫 — 아래쪽 1/3, 가로형, 술 장식
  rug: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "DDDDDDDDDDDDDDDD",
    "DLLLLLLLLLLLLLLD",
    "DLLLLLLLLLLLLLLD",
    "DLLLLLLLLLLLLLLD",
    "DLLLLLLLLLLLLLLD",
    "DDDDDDDDDDDDDDDD",
    "D.D.D.D.D.D.D.DD",
  ],
  // 꽃 — 아래쪽 절반, 줄기(D) + 꽃잎(L)
  flower: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "......LLL.......",
    ".....LLLLL......",
    "......DLD.......",
    "......DLD.......",
    ".....DLLLD......",
    "......DLD.......",
    ".......D........",
    ".......D........",
    ".......D........",
    "......DDD.......",
    "................",
  ],
  // 디딤돌 — 아래쪽 절반, 납작 자연석
  'path-stone': [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...DDDDDDDDDD...",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDDDDDDDDD...",
    "................",
    "................",
  ],
  // 울타리 기둥 — 5~6w 캡 + 4w 폴, 마을 경계
  'fence-post': [
    "................",
    "................",
    "................",
    ".....DDDDD......",
    "....DLLLLD......",
    ".....DLLLD......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DLLD.......",
    ".....DDDD.......",
    "................",
  ],
  // 이정표 — 표지판(8w) + 기둥(3w)
  signpost: [
    "................",
    "................",
    "....DDDDDDDD....",
    "....DLLLLLLD....",
    "....DLMLLMLD....",
    "....DDDDDDDD....",
    ".....DLD........",
    ".....DLD........",
    ".....DLD........",
    ".....DLD........",
    ".....DLD........",
    ".....DLD........",
    ".....DLD........",
    ".....DLD........",
    ".....DDD........",
    "................",
  ],
  // 가로등 — 1px 기둥(D) + top 랜턴박스(3w), 불빛 A
  'lantern-post': [
    "................",
    "......DDD.......",
    "......DAD.......",
    "......DAD.......",
    "......DDD.......",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    ".......D........",
    "................",
  ],
  // 우물 — 지붕(L+D) + 돌 베이스(D) + 구멍(E)
  well: [
    "................",
    ".......LL.......",
    "......DLLD......",
    ".....DLLLLLD....",
    "....DDDDDDDD....",
    "....DLEEELLD....",
    "....DLLLLLLD....",
    "....DLLLLLLD....",
    "....DDDDDDDD....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  // 고양이 — 납작 옆얼굴, 삼각귀, 긴 꼬리
  cat: [[
    "................................",
    "................................",
    "....DDDD............DDDD........",
    "....DLLDD..........DLLDD........",
    "....DLLLDDDDDDDDDDLLLLDD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLDD.......",
    "....DLLLEEEEELLLLLEEEELLD.......",
    "....DLLLEEEEELLLLLEEEELLD.......",
    "....DLLLEEEEELLLLLEEEELLD.......",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLAAALLLLLLLLLLD........",
    "....DLLLLMMMMMMLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLDD........",
    ".....DLLLLLLLLLLLLLLLLLD........",
    "......DDDDDDDDDDDDDDDDDD........",
    ".......DLLLLLLLLLLLLLD..........",
    ".......DLLLLLLLLLLLLLD..........",
    ".......DDDDDDDDDDDDDDDD.........",
    ".......DD............DD.........",   // 꼬리 힌트 오른쪽
    ".......DD...........DDD.........",
    "......DDDD.........DDDDD........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ], [
    "................................",
    "................................",
    "....DDDD............DDDD........",
    "....DLLDD..........DLLDD........",
    "....DLLLDDDDDDDDDDLLLLDD........",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLLDD.......",
    "....DLLLEEEEELLLLLEEEELLD.......",
    "....DLLLEEEEELLLLLEEEELLD.......",
    "....DLLLEEEEELLLLLEEEELLD.......",
    "....DLLLLLLLLLLLLLLLLLLD........",
    "....DLLLLLAAALLLLLLLLLLD........",
    "....DLLLLMMMMMMLLLLLLLLD........",
    "....DLLLLLLLLLLLLLLLLLD.........",
    "....DLLLLLLLLLLLLLLLLLDD........",
    ".....DLLLLLLLLLLLLLLLLLD........",
    "......DDDDDDDDDDDDDDDDDD........",
    ".......DLLLLLLLLLLLLLD..........",
    ".......DLLLLLLLLLLLLLD..........",
    ".......DDDDDDDDDDDDDDDD.........",
    "........DD...........DD.........",   // 발 모음 (walk frame)
    "........DD...........DD.........",
    ".......DDDD.........DDDD........",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]],
  // 버섯 — 넓은 돔 캡 + 가는 자루, 캡에 반점
  // 버섯 — 넓은 돔 캡 + 가는 자루, 캡 반점 비대칭 (왼쪽 AAA 3px, 오른쪽 AA 2px)
  // frame2: 자루 밑동 1px 오른쪽 흔들림 (walk lean)
  mushroom: [[
    "................",
    "....DDDDDDDD....",
    "...DLLLLLLLLD...",
    "..DLLAAALLAALD..",
    "..DLLLLLLLLLLLD.",
    ".DLLLAALLAALLLLD",
    ".DLLLLLLLLLLLLD.",
    "..DDDDDDDDDDDD..",
    "....DLLLLLLLD...",
    "...DLEELLEELD...",
    "...DLLLMMLLLLD..",
    "....DLLLLLLLD...",
    ".....DDDDDDD....",
    "................",
    "................",
    "................",
  ], [
    "................",
    "....DDDDDDDD....",
    "...DLLLLLLLLD...",
    "..DLLAAALLAALD..",
    "..DLLLLLLLLLLLD.",
    ".DLLLAALLAALLLLD",
    ".DLLLLLLLLLLLLD.",
    "..DDDDDDDDDDDD..",
    "....DLLLLLLLD...",
    "...DLEELLEELD...",
    "...DLLLMMLLLD...",
    "....DLLLLLLLD...",
    "......DDDDDDD...",
    "................",
    "................",
    "................",
  ]],
  // 고스트 퍼프 — 둥근 상단, 아랫단 스캘럽(3 드립)
  'ghost-puff': [[
    "................",
    ".....DDDDDD.....",
    "....DLLLLLLD....",
    "...DLLLLLLLLD...",
    "..DLLLEELLLLD...",
    "..DLLLEELLLLD...",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDLDDLDDLD...",
    "....D.D.D.D.....",
    "................",
    "................",
    "................",
  ], [
    "................",
    ".....DDDDDD.....",
    "....DLLLLLLD....",
    "...DLLLLLLLLD...",
    "..DLLLEELLLLD...",
    "..DLLLEELLLLD...",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDLDDLDDLD...",
    "....D.D.D.D.....",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 물고기 — 수평 물방울 몸통, 꼬리 지느러미 왼쪽, 등지느러미 위
  fish: [[
    "................",
    "................",
    "................",
    "DD..............",
    "DLDD............",
    "DLLLDDDDDDDDD...",
    "DLLLLLLLLLLLLD..",
    "DLLLEELLLLLLLD..",
    "DLLLLLLLLLLLLD..",
    "DLLLLDDDDDDDD...",
    "DLDD............",
    "DD..............",
    "................",
    "................",
    "................",
    "................",
  ], [
    "................",
    "................",
    "................",
    ".DD.............",
    "DDLDD...........",
    "DLLLDDDDDDDDD...",
    "DLLLLLLLLLLLLD..",
    "DLLLEELLLLLLLD..",
    "DLLLLLLLLLLLLD..",
    "DLLLLDDDDDDDD...",
    "DDLDD...........",
    ".DD.............",
    "................",
    "................",
    "................",
    "................",
  ]],
  // ── 진화형 (evolved) ──────────────────────────────────────────────
  // 각 종의 호출 20+ 시 표시. 16×16 그리드 그대로, footprint 더 크게.
  bunny_evolved: [[
    "..DD........DD..",   // 좌우 대칭 직립 귀 (rabbit-style)
    "..DLD......DLD..",
    "..DLD......DLD..",
    "..DLD......DLD..",
    "..DLDDDDDDDDLD..",   // 귀 base + 머리 연결
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",   // 큰 눈
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",   // 볼터치 BB + 코 AA
    ".DLLLLMMMMLLLLD.",   // 입 4 wide 대칭
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DLLLLLLLLD...",
    "...DDD....DDD...",   // 발
  ], [
    "..DD........DD..",
    "..DLD......DLD..",
    "..DLD......DLD..",
    "..DLD......DLD..",
    "..DLDDDDDDDDLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DLLLLLLLLD...",
    "....DDDDDDDD....",
  ]],
  bird_evolved: [[
    "................",
    "....LLLLLLLL....",
    "...LDDDDDDDDL...",
    "..LDLLLLLLLLDL..",
    "..DLLLLAALLLLD..",   // 부리 가운데 (대칭)
    "DLLLEELLLLEELLLD",   // 큰 눈 좌우 대칭
    "DLLLEELLLLEELLLD",
    ".DLLLLAAAALLLLD.",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",   // 날개 통일 (핑크 BB 제거)
    "..DLLLLLLLLLLD..",
    "...DDLLLLLLDD...",
    ".....DDDDDD.....",
    "....DD....DD....",
    "...DDD....DDD...",
    "................",
  ], [
    "................",
    "....LLLLLLLL....",
    "...LDDDDDDDDL...",
    "..LDLLLLLLLLDL..",
    "..DLLLLAALLLLD..",
    "DLLLEELLLLEELLLD",
    "DLLLEELLLLEELLLD",
    ".DLLLLAAAALLLLD.",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDLLLLLLDD...",
    ".....DDDDDD.....",
    "...DDD....DDD...",   // 발 모음 (walk frame)
    "................",
    "................",
  ]],
  slime_evolved: [[
    "......A..A......",   // 크라운 뾰족 2점 (왕 슬라임)
    "......AAAA......",   // 크라운 base
    ".....DDDDDD.....",   // dome head
    "...DDLLLLLLDD...",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",   // 큰 눈
    ".DLLEELLLLEELLD.",
    "DLLLLLLLLLLLLLLD",
    "DLLBBLLMMLLBBLLD",   // 볼터치 BB + 가운데 입 MM (가슴 점 X)
    "DLLLLLLLLLLLLLLD",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DDLLLLLLDD...",
    ".....DDDDDD.....",   // 둥근 base
    "................",
  ], [
    "......A..A......",
    "......AAAA......",
    ".....DDDDDD.....",
    "...DDLLLLLLDD...",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    "DLLLLLLLLLLLLLLD",
    "DLLBBLLMMLLBBLLD",
    "DLLLLLLLLLLLLLLD",
    "DLLLLLLLLLLLLLLD",   // frame2 — base 한 줄 wider squash
    ".DLLLLLLLLLLLLD.",
    "..DDLLLLLLLLDD..",
    "....DDDDDDDD....",
    "................",
  ]],
  frog_evolved: [[
    "......AAAA......",   // 머리 위 sparkle A (왕-frog 시그니처)
    "...DD......DD...",   // 눈 봉우리 top (frog base 와 동일 구조)
    "..DLLD....DLLD..",
    ".DLEELD..DLEELD.",   // 봉우리 안 EE 큰 눈 (몰지 않음 — 두 봉우리 분리)
    ".DLLLLDLLDLLLLD.",   // 봉우리 base 끊김 (눈썹 한 줄 X)
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLBBLLAALLBBLD.",   // 볼터치 BB + 코 AA (evolved 시그니처)
    ".DLLLLLMMLLLLLD.",   // 작은 입 (frog base 와 일관 derpy)
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "..DDLLLLLLLLDD..",
    "..DD........DD..",   // 발 두 개 (대칭)
    "................",
    "................",
  ], [
    "......AAAA......",
    "...DD......DD...",
    "..DLLD....DLLD..",
    ".DLEELD..DLEELD.",
    ".DLLLLDLLDLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLBBLLAALLBBLD.",
    ".DLLLLLMMLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "..DDLLLLLLLLDD..",
    "...DD......DD...",   // 발 안쪽 (hop frame 2)
    "................",
    "................",
  ]],
  // star_evolved — 더 큰 5-point 별 + 후광 A 반짝이 2점
  star_evolved: [[
    "A..............A",   // 좌우상단 sparkle 대칭
    "......DDDD......",   // 둥근 상단 꼭지
    ".....DLLLLD.....",
    "....DLLLLLLD....",
    ".DDDDLLLLLLDDDD.",
    "DDDLLLLLLLLLLDDD",   // 팔 풀폭 둥근 bulb
    ".DLEELLLLLLEELD.",   // 큰 눈
    ".DLEELLLLLLEELD.",
    ".DLBBLLAALLBBLD.",   // 볼터치 BB + 코 AA (귀여움 강화)
    "..DLLLLMMLLLLD..",   // 작은 입
    "..DLLLLAALLLLD..",
    "...DDLLLLLLDD...",
    "...DLD....DLD...",
    "..DLD......DLD..",
    "..DD........DD..",   // 다리 끝 bulb
    "A..............A",   // 하단 sparkle 대칭
  ], [
    "A..............A",
    "......DDDD......",
    ".....DLLLLD.....",
    "....DLLLLLLD....",
    ".DDDDLLLLLLDDDD.",
    "DDDLLLLLLLLLLDDD",
    ".DLEELLLLLLEELD.",
    ".DLEELLLLLLEELD.",
    ".DLBBLLAALLBBLD.",
    "..DLLLLMMLLLLD..",
    "..DLLLLAALLLLD..",
    "...DDLLLLLLDD...",
    "...DLD....DLD...",
    "..DD........DD..",
    "................",
    "A..............A",
  ]],
  blob_evolved: [[
    "..LL........LL..",   // 양 옆 점박이 (대칭)
    ".LDDL......LDDL.",
    ".LDLLDDDDDDLLDL.",   // 양 옆 + 머리 연결
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",   // 볼터치 + 코 (콧물 BMMB 제거)
    ".DLLLLLMMLLLLLD.",   // 작은 입 MM 2px (derpy) 대칭
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DLLLLLLLLD...",
    "....DD....DD....",
    "................",
  ], [
    "..LL........LL..",
    ".LDDL......LDDL.",
    ".LDLLDDDDDDLLDL.",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DLLLLLLLLD...",
    "....DDDDDDDD....",
    "................",
  ]],
  pup_evolved: [[
    ".......AA.......",   // 머리 위 별빛 hint
    "..DD........DD..",   // 귀 (pup base 와 동일 silhouette)
    "..DLD......DLD..",
    "..DLLDDDDDDLLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",   // 양 볼 BB + 코 AA (가운데)
    ".DLLLLMMMMLLLLD.",   // 입 4 wide
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DLLLLLLLLD...",
    "...DDD....DDD...",
    "................",
  ], [
    ".......AA.......",
    "..DD........DD..",
    "..DLD......DLD..",
    "..DLLDDDDDDLLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "...DLLLLLLLLD...",
    "....DDDDDDDD....",
    "................",
  ]],
  cat_evolved: [[
    "................",
    "...D........D...",
    "..DLD......DLD..",
    "..DLLDDDDDDLLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",   // 볼터치 BB + 코 AA
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DDLLLLLLLLDD..",
    "..DD........DD..",
    "................",
  ], [
    "................",
    "...D........D...",
    "..DLD......DLD..",
    "..DLLDDDDDDLLD..",
    "..DLLLLLLLLLLD..",
    ".DLLLLLLLLLLLLD.",
    ".DLLEELLLLEELLD.",
    ".DLLEELLLLEELLD.",
    ".DLBBLLAALLBBLD.",
    ".DLLLLMMMMLLLLD.",
    ".DLLLLLLLLLLLLD.",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DDLLLLLLLLDD..",
    "...DDD....DDD...",
    "................",
  ]],
  mushroom_evolved: [[
    "................",
    "....DDDDDDDD....",   // 갓 outline top (핑크 BB 제거)
    "..DDLLLLLLLLDD..",
    ".DLLLAALLAALLLD.",   // 갓 점박이 2개 대칭
    "DLLLLLLLLLLLLLLD",   // 갓 wider
    "DLLLAALLLLAALLLD",   // 점박이 4개
    "DLLLLLLLLLLLLLLD",
    ".DDDDDDDDDDDDDD.",   // 갓 base
    "....DLLLLLLD....",   // 자루 top
    "...DLEELLEELD...",   // 큰 눈
    "...DLEELLEELD...",
    "..DLLLMMMMLLLD..",   // 입 가운데
    "...DLLLLLLLLD...",   // 자루 body
    "....DDDDDDDD....",   // 자루 base
    "................",
    "................",
  ], [
    "................",
    "....DDDDDDDD....",
    "..DDLLLLLLLLDD..",
    ".DLLLAALLAALLLD.",
    "DLLLLLLLLLLLLLLD",
    "DLLLAALLLLAALLLD",
    "DLLLLLLLLLLLLLLD",
    ".DDDDDDDDDDDDDD.",
    "....DLLLLLLD....",
    "...DLEELLEELD...",
    "...DLEELLEELD...",
    "..DLLLMMMMLLLD..",
    "...DLLLLLLLLD...",
    ".....DDDDDD.....",   // 자루 base 흔들림 frame2
    "................",
    "................",
  ]],
  ghost_puff_evolved: [[
    "...........DDDD.",
    "..........DLLLD.",
    "..........DLELD.",
    "..........DLLDD.",
    "................",
    "....DDDDDDDD....",
    "...DLLLLLLLLD...",
    "..DLLLLLLLLLLD..",
    "..DLLLEELLLLD...",
    "..DLLLEELLLLD...",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDLDDLDDLD...",
    "....D.D.D.D.....",
  ], [
    "............DDD.",
    "...........DLLLD",
    "...........DLELD",
    "...........DLLDD",
    "................",
    "....DDDDDDDD....",
    "...DLLLLLLLLD...",
    "..DLLLLLLLLLLD..",
    "..DLLLEELLLLD...",
    "..DLLLEELLLLD...",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",
    "...DDLDDLDDLD...",
    "....D.D.D.D.....",
    "................",
  ]],
  fish_evolved: [[
    "DD.......D......",
    "DD......DLD.....",
    "DD.....DLLLD....",
    "DLLLLDDDDDDDDDD.",
    "DLLLLLLLLLLLLD..",
    "DLLLLEELLLLLLD..",
    "DLLLLLLLLLLLLD..",
    "DLLLBLLBLLBLLD..",
    "DLLLLDDDDDDDD...",
    "DLDD............",
    "DD..............",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "DD.......D......",
    "DD......DLD.....",
    "DD.....DLLLD....",
    "DLLLLDDDDDDDDDD.",
    "DLLLLLLLLLLLLD..",
    "DLLLLEELLLLLLD..",
    "DLLLLLLLLLLLLD..",
    "DLLLBLLBLLBLLD..",
    "DLLLLDDDDDDDD...",
    ".DLDD...........",
    ".DD.............",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  dragon_baby_evolved: [[
    "....KK....KK....",   // base 와 동일 뿔 silhouette
    "...KKLK..KLKK...",
    "..KKLLDDDDLLKK..",
    "..DLLLLLLLLLLD..",
    "..DLLEELLEELLLD.",   // 눈 (base 의도적 비대칭 유지)
    "..DLBBLLAALLBBLD",   // *변경*: 볼터치 BB + 코 AA (evolved 시그니처)
    "..DLLLLMMLLLLLD.",   // 입 (base 동일)
    "AA.DLLLLLLLLD.AA",   // 날개 (base 동일)
    "AAADLLLLLLLLDAAA",   // 날개 풀폭
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLDKKK.",   // 꼬리 K (base 동일)
    "..DLLLLLLLLLDK.K",
    "..DLLLLLLLLLLDK.",
    "...DDDDDDDDDD...",
    "....DD....DD....",   // 발
    "...DDD....DDD...",
  ], [
    "....KK....KK....",
    "...KKLK..KLKK...",
    "..KKLLDDDDLLKK..",
    "..DLLLLLLLLLLD..",
    "..DLLEELLEELLLD.",
    "..DLBBLLAALLBBLD",
    "..DLLLLMMLLLLLD.",
    "AA.DLLLLLLLLD.AA",
    "AAADLLLLLLLLDAAA",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLDKKK.",
    "..DLLLLLLLLLDK.K",
    "..DLLLLLLLLLLDK.",
    "...DDDDDDDDDD...",
    "....DD.....DD...",   // 발 frame2 흔들림 (base frame2 동일)
    "...DDD.....DDD..",
  ]],
  // ── prop 스프라이트 (단일 프레임, CSS transform 으로 모션) ──────
  prop_magnifier: [[
    "................",
    "......DDDD......",
    "....DDLLLLDD....",
    "...DLBLLLLBLD...",
    "...DLLLLLLLLD...",
    "...DLBLLLLBLD...",
    "....DDLLLLDD....",
    "......DDDD......",
    ".........DD.....",
    "..........ADD...",
    "...........ADD..",
    "...........AAD..",
    "................",
    "................",
    "................",
    "................",
  ]],
  prop_hammer: [[
    "................",
    "..DDDDDD........",
    "..DLLLLD........",
    "..DLLLLDA.......",
    "..DLLLLAAD......",
    "..DDDDDDAA......",
    "........DAA.....",
    ".........AA.....",
    "..........A.....",
    "..........AA....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  prop_brush: [[
    "..BBB...........",
    ".BBBBD..........",
    ".DBBBD..........",
    "..DBBD..........",
    "...DLD..........",
    "....DLD.........",
    ".....DLD........",
    "......DLD.......",
    ".......DAAD.....",
    "........AAAD....",
    ".........AAD....",
    "..........AD....",
    "................",
    "................",
    "................",
    "................",
  ]],
  prop_compass: [[
    "................",
    ".....DDDDDD.....",
    "....DLLLLLLLD...",
    "...DLLLCLLLLLD..",
    "..DLLLCLALLLLD..",
    "..DLLLLALLLLLLD.",
    "..DLLLLBLLLLLLD.",
    "..DLLLCBLCLLLLD.",
    "..DLLLLLLLLLLLD.",
    "...DLLLLLLLLLD..",
    "....DDDDDDDDDD..",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  prop_thought: [[
    "................",
    "....DDDDDDD.....",
    "...DLLLLLLLD....",
    "..DLLLLLLLLLLD..",
    "..DLLLAALLLLLLD.",
    "..DLLLALLLLLLLD.",
    "..DLLLLLLLLLLLD.",
    "...DLLLLLLLLD...",
    "....DDDDDDD.....",
    ".........DD.....",
    "..........DD....",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  prop_laptop: [[
    "................",
    ".DDDDDDDDDDDDDD.",   // screen top (14px)
    ".DBBLLLLLLLLLLD.",   // screen row 1 — B cluster top-left (2×2 highlight)
    ".DBBLLLLLLLLLLD.",   // screen row 2
    ".DLLLLLLLLLLLLD.",   // screen row 3
    ".DLLLLLLLLLLLLD.",   // screen row 4
    ".DDDDDDDDDDDDDD.",   // screen bottom
    ".DAAAAAAAAAAAAD.",   // hinge seam (A = lighter fold line)
    ".DCCCCCCCCCCCCD.",   // keyboard top fill
    ".DCDDCDDCDDCDDD.",   // key row 1 (4 DD-pairs, C gaps)
    ".DCDDCDDCDDCDDD.",   // key row 2 (same = symmetric)
    ".DDDDDDDDDDDDDD.",   // keyboard base
    "................",
    "................",
    "................",
    "................",
  ]],
  prop_sparkle: [[
    "................",
    "................",
    ".......L........",
    "......LAL.......",
    ".....LAAAAL.....",
    "....LAAAAAAL....",
    ".....LAAAAL.....",
    "......LAL.......",
    ".......L........",
    "...L.......L....",
    "...L.......L....",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 책상 가구 — 3/4 뷰, 윗판 + 앞면 + 다리 2개, 책 1권 (A)
  deco_desk: [
    "................",
    "................",
    "................",
    "................",
    ".DDDDDDDDDDDDD..",   // desk top border (13px, slight 3/4 taper)
    ".DLLLLLLLLLLD...",   // desk top surface
    ".DLLLAAAAALLLD..",   // surface with book (A cover 5px)
    ".DDDDDDDDDDDD...",   // seam / front-face shadow
    ".DLLLLLLLLLLD...",   // front face
    ".DDDDDDDDDDD....",   // front face bottom
    "..D.........D...",   // leg spacing
    "..DD.......DD...",   // legs (2px each)
    "..DD.......DD...",
    "..DD.......DD...",
    "..DDD.....DDD...",   // foot (3px)
    "................",
  ],
  // 말풍선 — chat 태그용, 뾰족 꼬리 (speech), 내부 A 점 3개
  prop_speech: [[
    "................",
    "...DDDDDDDDDD...",   // bubble top (10px, cols 3-12)
    "..DLLLLLLLLLLD..",   // bubble body
    "..DLLLALALLALD..",   // "..." dots (A at cols 6,8,11)
    "..DLLLLLLLLLLD..",   // bubble body
    "..DLLLLLLLLLLD..",   // bubble body
    "...DDDDDDDDDD...",   // bubble bottom
    "..DD............",   // tail (2px, cols 2-3)
    ".DD.............",   // tail (2px, cols 1-2)
    "DD..............",   // tail tip (2px, cols 0-1) — intentional
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 시계 — wait 태그용 원형 시계, 분침+시침 각 2px
  prop_clock: [[
    "................",
    "....DDDDDDDD....",   // top arc (8px, cols 4-11)
    "...DLLLLLLLLD...",   // transition (10px, cols 3-12)
    "..DLLLLLDLLLLD..",   // face — 12 o'clock tick D at col 8
    "..DLLLLDDLLLLD..",   // minute hand DD (cols 7-8 = ~11 o'clock)
    "..DLLLLDDLLLLD..",   // minute hand continues
    "..DLLLLDLLLLLD..",   // center pivot D at col 7
    "..DLLLLLDDLLLD..",   // hour hand DD (cols 8-9 = ~2 o'clock)
    "..DLLLLLLLLLLD..",   // interior clear
    "..DLLLLDLLLLLD..",   // 6 o'clock tick D at col 7
    "...DLLLLLLLLD...",   // transition (10px)
    "....DDDDDDDD....",   // bottom arc (8px)
    "................",
    "................",
    "................",
    "................",
  ]],
  // 파티 모자 — celebrate 태그용 삼각형 + 술(pom-pom) + 챙
  prop_party: [[
    "......LLLL......",   // pom-pom top (L, 4px)
    "......AAAA......",   // pom-pom body (A accent)
    ".......DD.......",   // hat apex (2px)
    "......DAAD......",   // hat (4px)
    ".....DAAAAD.....",   // hat (6px)
    "....DAAAAAAAD...",   // hat (8px)
    "...DALAAAAALD...",   // hat (10px, L stripes)
    "..DALAAAAAAALD..",   // hat (12px, L stripes)
    ".DALAAAAAAAAALD.",   // hat (14px, L stripes)
    ".DAAAAAAAAAAAD.",    // brim A accent (14px: D+12A+D+. = 16 chars)
    ".DLLLLLLLLLLLLD.",   // brim interior
    ".DDDDDDDDDDDDDD.",   // brim base
    "................",
    "................",
    "................",
    "................",
  ]],
  // 아기 드래곤 — 둥근 몸, 작은 날개 돌출, 뿔 2개
  // dragon-baby — 뿔 스텁 DLD(3px), 날개 스텁 AA 양옆 row7, 꼬리 훅 row12
  // 실루엣: 뿔(row1) + 날개(row7-8) + 꼬리(row10-12) = "용" 인식 가능
  'dragon-baby': [[
    "....KK....KK....",
    "...KKLK..KLKK...",
    "..KKLLDDDDLLKK..",
    "..DLLLLLLLLLLD..",
    "..DLLEELLEELLLD.",
    "..DLLLLAALLLLLD.",
    "..DLLLLMMLLLLLD.",
    "AA.DLLLLLLLLD.AA",
    "AAADLLLLLLLLDAAA",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLDKKK.",
    "..DLLLLLLLLLDK.K",
    "..DLLLLLLLLLLDK.",
    "...DDDDDDDDDD...",
    "....DD....DD....",
    "...DDD....DDD...",
  ], [
    "....KK....KK....",
    "...KKLK..KLKK...",
    "..KKLLDDDDLLKK..",
    "..DLLLLLLLLLLD..",
    "..DLLEELLEELLLD.",
    "..DLLLLAALLLLLD.",
    "..DLLLLMMLLLLLD.",
    "AA.DLLLLLLLLD.AA",
    "AAADLLLLLLLLDAAA",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLDKKK.",
    "..DLLLLLLLLLDK.K",
    "..DLLLLLLLLLLDK.",
    "...DDDDDDDDDD...",
    "....DD.....DD...",
    "...DDD.....DDD..",
  ]],
  // 미니 화이트보드 — 가로형 액자, 내부 텍스트 힌트 2줄, 좌상단 마커(A)
  deco_whiteboard: [
    "................",
    "................",
    "..DDDDDDDDDDDD..",   // frame top (12px, cols 2-13)
    "..DALLLLLLLLLD..",   // interior top — A marker at col 3 (asymmetry), L fill
    "..DLLLLLLLLLLD..",   // interior
    "..DLDLDDLDDLLD..",   // text hint row 1 (D dashes)
    "..DLLLLLLLLLLD..",   // interior
    "..DLDDLLDLLLLD..",   // text hint row 2 (different pattern — asymmetric)
    "..DLLLLLLLLLLD..",   // interior
    "..DLLLLLLLLLLD..",   // interior
    "..DDDDDDDDDDDD..",   // frame bottom
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  // 소파 — 3/4 뷰, 등받이 + 좌석 + 다리 2개, 쿠션(A) 왼쪽 치우쳐 비대칭
  deco_couch: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".DDDDDDDDDDDDDD.",   // backrest top (14px, cols 1-14)
    ".DLLLLLLLLLLLLD.",   // backrest interior
    ".DDDDDDDDDDDDDD.",   // seam — backrest / seat boundary (1px D)
    ".DAAALLLLLLLLLD.",   // seat row 1 — A cushion left side (cols 2-4), asymmetry
    ".DLLLLLLLLLLLLD.",   // seat row 2 (plain)
    ".DDDDDDDDDDDDDD.",   // seat front edge
    "..D.........D...",   // leg anchor gap
    "..DD.......DD...",   // legs (2px each — no 1px tip)
    "..DDD.....DDD...",   // feet (3px — wider base)
    "................",
  ],
  // 벽창문 — D 액자 + 십자 분할 + 우측 sill 비대칭. 내부 . 로 CSS sky-color 주입 가능
  deco_window: [
    "................",
    "................",
    "..DDDDDDDDDDDD..",   // frame top (12px, cols 2-13)
    "..D...D......D..",   // left pane + vertical divider at col 6 + right pane + right frame
    "..D...D......D..",
    "..D...D......D..",
    "..DDDDDDDDDDDD..",   // horizontal mid-bar seam
    "..D...D......D..",
    "..D...D......D..",
    "..D...D......D..",
    "..DDDDDDDDDDDD..",   // frame bottom
    "..DDDDDDDDDDDDDD",   // sill top — extends 2px right of frame (asymmetry, cols 2-15)
    "..DLLLLLLLLLLLLD",   // sill face (L interior, D right cap)
    "..DDDDDDDDDDDDDD",   // sill base
    "................",
    "................",
  ],
  // 천체 — frame1: 낮 태양, frame2: 밤 초승달 + 별. data-tod 로 CSS 가 프레임 토글
  deco_sun_moon: [[
    "................",
    "......LLLL......",   // halo top (4px, cols 6-9)
    ".....LDDDDLL....",   // halo + D outline arc (asymmetric: LL right side)
    "....LDAAAAADL...",   // sun body (A = yellow accent, D outline, L halo)
    "....LDAAAALLD...",   // sun body — right halo LL (2px) vs left L (1px) — asymmetry
    ".....LDDDDLL....",   // halo + D outline arc
    "......LLLL......",   // halo bottom
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ], [
    "................",
    "....DDDD........",   // moon arc top (4px, cols 4-7)
    "...DLLLDD.......",   // crescent body: L interior, D right edge curves off
    "..DLLLLL.D......",   // inner concave curve (. = transparent bite)
    "..DLLLLL.D......",   // inner concave curve
    "...DLLLDD.......",   // crescent body
    "....DDDD........",   // moon arc bottom
    "................",
    "..........LL....",   // star (2px min end-cap, cols 10-11)
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]],
  // 키 큰 책장 — 세로 14px × 가로 11px, 4단 선반, 책 3권/단, 하단 base 돌출
  deco_bookshelf_tall: [
    "................",
    "..DDDDDDDDDDD...",   // top border (11px, cols 2-12)
    "..DBBBAALLLLD...",   // shelf 1 books: B=3px, A=2px, L=4px (asymmetric widths)
    "..DBBBAALLLLD...",   // shelf 1 repeat
    "..DDDDDDDDDDD...",   // shelf divider 1 (seam)
    "..DAAAA.BBBBD...",   // shelf 2 books: A=4px, gap, B=4px (gap = asymmetry)
    "..DAAAA.BBBBD...",   // shelf 2 repeat
    "..DDDDDDDDDDD...",   // shelf divider 2 (seam)
    "..DBBBAAALLLD...",   // shelf 3 books: B=3px, A=3px, L=3px
    "..DBBBAAALLLD...",   // shelf 3 repeat
    "..DDDDDDDDDDD...",   // shelf divider 3 (seam)
    "..DLL.AAALLLD...",   // shelf 4 books: L=2px, gap, A=3px, L=3px (leftmost gap)
    "..DLL.AAALLLD...",   // shelf 4 repeat
    "..DDDDDDDDDDD...",   // bottom border
    ".DDDDDDDDDDDDDD.",   // base foot protrusion (13px, cols 1-13 — 1px wider each side)
    "................",
  ],
  // 마을 표지판 — 두꺼운 기둥(5px) + 가로 board(10px). 입구 anchor.
  // CSS 추천: .vb.village-sign svg .px-L { fill: #c9a874 } .px-D { fill: #6e4a25 } .px-M { fill: #4a2a18 }
  deco_village_sign: [
    "................",
    "...DDDDDDDDDD...",   // board top (10px, cols 3-12)
    "...DLLLLLLLLD...",   // board interior
    "...DLMLLMLLLD...",   // text hint — M at cols 5,8 (비대칭 간격)
    "...DLLLLLLLLD...",   // board interior
    "...DDDDDDDDDD...",   // board bottom
    ".....DDDDD......",   // post top cap (5px, cols 5-9)
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DLLLD......",   // post body
    ".....DDDDD......",   // post base
  ],
  // 야외 벤치 — 등받이(2행)+이음새+좌석(2행)+다리
  // CSS 추천: .vb.bench svg .px-L { fill: #c9a874 } .px-D { fill: #6e4a25 } .px-A { fill: #a07a50 }
  deco_bench: [
    "................",
    "................",
    "................",
    "..DDDDDDDDDDDD..",   // backrest top (12px, cols 2-13)
    "..DLLLLLLLLLLD..",   // backrest interior row1
    "..DLLLLLLLLLLD..",   // backrest interior row2
    "..DDDDDDDDDDDD..",   // seam — backrest/seat divide (hinge)
    "..DLLLLLALLLLD..",   // seat row1 — A plank detail at col 9 (비대칭)
    "..DLLLLLLLLLLD..",   // seat row2
    "..DDDDDDDDDDDD..",   // seat front edge
    "................",
    "....DD....DD....",   // legs (2px each, cols 4-5 and 10-11)
    "....DD....DD....",   // legs
    "....DD....DD....",   // legs
    "...DDD....DDD...",   // feet (3px cap)
    "................",
  ],
  // 작은 분수 — 상단 basin + 세로 기둥(2px) + 하단 base. 마을 광장 anchor.
  // CSS 추천: .vb.fountain svg .px-L { fill: #a8c4d8 } .px-D { fill: #5a7a8e } .px-E { fill: #d8eef8 }
  deco_fountain_small: [
    "................",
    ".....DDDDDD.....",   // basin rim top (6px, cols 5-10)
    "....DLLLLLLD....",   // basin (8px, cols 4-11)
    "...DLLLLLLLLLD..",   // basin wider (10px, cols 3-12)
    "...DLLLEELLLLD..",   // water EE reflections at cols 7-8 (비대칭)
    "...DLLLLLLLLLD..",   // basin
    "....DLLLLLLD....",   // basin taper
    ".....DDDDDD.....",   // basin rim bottom
    ".......DD.......",   // pillar (2px, cols 7-8)
    ".......DD.......",   // pillar
    ".......DD.......",   // pillar
    ".....DDDDDD.....",   // base top (6px)
    "....DLLLLLLD....",   // base body
    "....DLLLLLLD....",   // base body
    "....DDDDDDDD....",   // base bottom (8px — wider than top for stability)
    "................",
  ],
  // ── Codex 전용 펫 3종 (originator 매핑: codex-tui / codex_exec / codex_vscode) ──
  // codex-tui-pet — 대화형 Codex 세션. CRT 모니터 + 안테나 + 발 2개.
  // D=dark frame, L=grey body, E=green screen text, A=stand accent
  // Reference family: Pico-8 inanimate-object character (box with face), Stardew prop-as-creature
  'codex-tui-pet': [[
    "................",
    "...DD...........",   // 안테나 (2px tip, cols 3-4 = 왼쪽 치우침 — 비대칭)
    "...DDD..........",   // 안테나 베이스 (3px)
    "...DDDDDDDDDD...",   // 모니터 상단 (D outline, cols 3-12 = 10px)
    "...DLLLLLLLLD...",   // 화면 interior row
    "...DLEEEELLLD...",   // 화면 — E 커서 블록 (4px, cols 5-8)
    "...DLLLLLLLLD...",   // 화면
    "...DLLLLLLLLD...",   // 화면
    "...DLLLLLLLLD...",   // 화면
    "...DDDDDDDDDD...",   // 모니터 하단
    "....DAAAAAAAD...",   // 받침대 상단 (A accent, cols 4-12)
    ".....DLLLLLD....",   // 받침대 몸통 (cols 5-11)
    ".....DDDDDD.....",   // 받침대 하단 (cols 5-10)
    "....DD....DD....",   // 다리 (2px each)
    "...DDD....DDD...",   // 발 (3px cap)
    "................",
  ], [
    "................",
    "...DD...........",
    "...DDD..........",
    "...DDDDDDDDDD...",
    "...DLLLLLLLLD...",
    "...DLLLEEEELD...",   // frame2: E 커서 2칸 오른쪽 이동 (cols 7-10) — 깜빡임
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DLLLLLLLLD...",
    "...DDDDDDDDDD...",
    "....DAAAAAAAD...",
    ".....DLLLLLD....",
    ".....DDDDDD.....",
    "....DD....DD....",
    "...DDD....DDD...",
    "................",
  ]],
  // codex-exec-pet — 배치/자동화 Codex. 클립보드 + 체크리스트 + 눈.
  // D=dark outline, L=paper white, A=check accent, E=eyes, M=mouth
  // Reference family: Pico-8 inanimate-object character
  'codex-exec-pet': [[
    "................",
    ".....DDDD.......",   // 클립 상단 (4px, cols 5-8 = 오른쪽 치우침 — 비대칭)
    ".....DLLD.......",   // 클립 interior (D outline at 5 & 8, LL interior)
    "...DDDDDDDDDD...",   // 종이 상단 (10px, cols 3-12)
    "...DLLLLLLLLD...",   // 종이 interior
    "...DAADLLLLLD...",   // 체크리스트 row1: AA=체크, D=구분자, LLLLL=텍스트
    "...DLLLLLLLLD...",   // 종이
    "...DLEELLEELD...",   // 눈 (EE at cols 5-6, EE at cols 9-10 — 비대칭 여백)
    "...DLLLLLLLLD...",   // 종이
    "...DLLLLMLLLD...",   // 입 (M at col 8 = 오른쪽 치우침)
    "...DLLLLLLLLD...",   // 종이
    "...DALDLLLLLD...",   // 체크리스트 row2: A=체크 하나, D=구분자 (frame1: 1개)
    "...DDDDDDDDDD...",   // 종이 하단
    ".....DD..DD.....",   // 다리 (2px each, cols 5-6 & 9-10)
    "....DDD..DDD....",   // 발 (3px cap)
    "................",
  ], [
    "................",
    ".....DDDD.......",
    ".....DLLD.......",
    "...DDDDDDDDDD...",
    "...DLLLLLLLLD...",
    "...DALDLLLLLD...",   // frame2: row1 체크 줄어듦 (1개)
    "...DLLLLLLLLD...",
    "...DLEELLEELD...",
    "...DLLLLLLLLD...",
    "...DLLLLMLLLD...",
    "...DLLLLLLLLD...",
    "...DAADLLLLLD...",   // frame2: row2 체크 늘어남 (2개) — 완료 표시 애니
    "...DDDDDDDDDD...",
    ".....DD..DD.....",
    "....DDD..DDD....",
    "................",
  ]],
  // codex-vscode-pet — VSCode IDE 확장 Codex. 파란 큐브 + >> 코드심볼 + 눈.
  // D=dark blue outline, L=light blue body, E=eyes, B=>> code accent, M=mouth
  // Reference family: Pico-8 inanimate-object character (cube creature)
  'codex-vscode-pet': [[
    "................",
    "................",
    "..DDDDDDDDDDDD..",   // 큐브 상단 (12px, cols 2-13)
    "..DLLLLLLLLLLD..",   // 큐브 interior (10px interior cols 3-12)
    "..DLEELLLEELLD..",   // 눈 row1 (EE at cols 4-5, EE at cols 9-10 — 비대칭 여백)
    "..DLEELLLEELLD..",   // 눈 row2 = 2×2 눈
    "..DLLLLLLLLLLD..",   // interior
    "..DLLBBLLBBLLD..",   // >> 심볼 row1: BB tips (cols 5-6, 9-10)
    "..DBBLLLLBBLLD..",   // >> 심볼 row2: BB body (cols 3-4, 9-10) — 꺾인 부분
    "..DLLBBLLBBLLD..",   // >> 심볼 row3: BB tips (same as row1)
    "..DLLLLLLLLLLD..",   // interior
    "..DLLLLMLLLLLD..",   // 입 (M at col 7 = 왼쪽 치우침 — 비대칭)
    "..DLLLLLLLLLLD..",   // interior
    "..DDDDDDDDDDDD..",   // 큐브 하단
    "....DD....DD....",   // 다리 (2px each)
    "...DDD....DDD...",   // 발 (3px cap)
  ], [
    "................",
    "................",
    "..DDDDDDDDDDDD..",
    "..DLLLLLLLLLLD..",
    "..DLEELLLEELLD..",
    "..DLEELLLEELLD..",
    "..DLLLLLLLLLLD..",
    "..DLLLLLLLLLLD..",   // frame2: >> 심볼 1행 아래 이동 (breathing 효과)
    "..DLLBBLLBBLLD..",   // frame2: tips (row7→row8)
    "..DBBLLLLBBLLD..",   // frame2: body (row8→row9)
    "..DLLBBLLBBLLD..",   // frame2: tips (row9→row10)
    "..DLLLLMLLLLLD..",
    "..DLLLLLLLLLLD..",
    "..DDDDDDDDDDDD..",
    "....DD....DD....",
    "...DDD....DDD...",
  ]],
};

// 펫 종류별 스프라이트 선택
function spriteFor(subagent_type, calls = 0) {
  const base = (function pickBase(t) {
    t = t || '';
    if (t === '__egg__') return 'egg';
    // 사용자 오버라이드
    if (petConfig[t]?.sprite && SPRITES[petConfig[t].sprite]) return petConfig[t].sprite;
    // Cursor 마을 — 서브에이전트 펫(cursor-agent). MVP: slime 으로 매핑 (전용 스프라이트는 후속).
    if (t === 'cursor' || t.startsWith('cursor-')) return 'slime';
    // Codex 마을 — originator 기반. `codex-tui` / `codex-exec` / `codex-vscode` → `${t}-pet`.
    // alias: `codex-desktop` 도 IDE 계열 → vscode-pet 으로 동일 매핑.
    // 그 외 codex-* → generic blob 폴백 (proposal: unknown originator).
    if (t.startsWith('codex-') || t === 'codex') {
      // IDE originator → 큐브 (codex-vscode-pet)
      if (t === 'codex-desktop' || t === 'codex-vsc' || t === 'codex-ide' || t === 'codex-vscode') {
        return 'codex-vscode-pet';
      }
      // description 버킷 (codex_parser._classify_codex) → 3개 코덱스 스프라이트 분산
      if (t === 'codex-shell') return 'codex-tui-pet';      // ls/cat/grep → 모니터
      if (t === 'codex-edit')  return 'codex-vscode-pet';   // apply_patch → 큐브
      if (t === 'codex-exec')  return 'codex-exec-pet';     // build/test/run → 클립보드
      if (t === 'codex') return 'codex-exec-pet';
      const candidate = `${t}-pet`;
      if (SPRITES[candidate]) return candidate;
      return 'blob';
    }
    // 순서 중요 — 먼저 매칭되는 키워드가 이김. 구체적 → 일반 순.
    if (/scene|tester/i.test(t))                   return 'ghost-puff'; // 둥둥 떠다니며 관찰
    if (/critic|judge/i.test(t))                   return 'mushroom';   // 가만히 비평
    if (/orch|coord|manage/i.test(t))              return 'bird';       // 위에서 조율
    if (/strate|product|architect/i.test(t))       return 'dragon-baby'; // 큰 그림
    if (/explore|scout|recon/i.test(t))            return 'cat';        // 살금살금 정찰
    if (/pixel|art|design|sprite/i.test(t))        return 'star';       // 창작
    if (/research|search|fetch|practice|study/i.test(t)) return 'frog'; // 탐구
    if (/data|parse|stream|db|sql/i.test(t))       return 'fish';       // 데이터 흐름
    if (/dev|code|build|impl|frontend|backend/i.test(t)) return 'pup';  // 구현
    if (/plan|review|guide/i.test(t))              return 'bird';       // 사고
    if (/test|verify|qa|check|tidy|format/i.test(t)) return 'bunny';    // 검증/정리
    if (/secur|guard|defend|magic|special/i.test(t)) return 'star';     // 보안/마법
    // 해시 폴백 (egg 제외, 12 키 풀)
    const keys = ['blob','bird','pup','slime','bunny','star','frog','cat','mushroom','ghost-puff','fish','dragon-baby'];
    return keys[djb2(t) % keys.length];
  })(subagent_type);

  if (calls >= 20) {
    const evolvedKey = base.replace(/-/g, '_') + '_evolved';
    if (SPRITES[evolvedKey]) return evolvedKey;
  }
  return base;
}

function gridToRects(grid, scale, frameClass) {
  const cols = grid[0].length, rows = grid.length;
  const BASE = 16;
  // Canonical output size is always BASE*scale px per axis.
  // For grids larger than BASE (e.g. 32×32), each cell shrinks so the
  // total footprint stays the same as a 16×16 sprite at the same scale.
  // For grids ≤ BASE the formula reduces to the original: cellW = scale.
  const cellW = (BASE * scale) / Math.max(cols, BASE);
  const cellH = (BASE * scale) / Math.max(rows, BASE);
  let rects = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = grid[y][x];
      if (c === '.' || c === ' ') continue;
      rects += `<rect class="px-${c} ${frameClass}" x="${x*cellW}" y="${y*cellH}" width="${cellW}" height="${cellH}"/>`;
    }
  }
  return { rects, w: cols * cellW, h: rows * cellH };
}

// renderSprite 결과 캐시 — (name, scale) 같으면 동일 SVG 문자열 재사용.
// 풀-페이지 렌더에서 같은 sprite 가 수십 번 호출되는 경우(특히 prop·humanoid) JS 비용 제거.
const _spriteCache = new Map();
function renderSprite(name, scale = 4) {
  const key = name + '|' + scale;
  const hit = _spriteCache.get(key);
  if (hit) return hit;
  let raw = SPRITES[name] || SPRITES.blob;
  // 호환: 단일 그리드 or [frame1, frame2] 배열
  const frames = Array.isArray(raw[0]) ? raw : [raw];
  const f1 = gridToRects(frames[0], scale, 'frame frame-1');
  const f2 = frames[1] ? gridToRects(frames[1], scale, 'frame frame-2') : null;
  const f3 = frames[2] ? gridToRects(frames[2], scale, 'frame frame-3') : null;
  const inner = f1.rects + (f2 ? f2.rects : '') + (f3 ? f3.rects : '');
  const klass = `sprite ${f2 ? 'two-frame' : ''} ${f3 ? 'three-frame' : ''}`.trim();
  const W = f1.w, H = f1.h;
  const svg = `<svg class="${klass}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${inner}</svg>`;
  _spriteCache.set(key, svg);
  return svg;
}

// preview 페이지처럼 동일 sprite 가 수십 번 등장하는 경우 — <symbol>+<use> 로 DOM rect 중복을 제거.
// 단일 정의 + N 개 참조 = paint 비용 ~7x 감소 (preview 매트릭스 기준).
// 단 species 별 CSS 색 오버라이드는 <use> shadow scope 때문에 안 먹힘 — 그 종은 인라인 fallback.
const _COLOR_SENSITIVE_SPECIES = new Set(['dragon-baby', 'star', 'dragon_baby_evolved', 'star_evolved']);
const _symbolDefs = new Set();
const _symbolDefMarkup = [];
const _symbolDefDims = {};
function renderSpriteRef(name, scale = 4) {
  // 색 민감 species 는 인라인 (CSS .px-A / .px-K 적용 가능)
  if (_COLOR_SENSITIVE_SPECIES.has(name)) return renderSprite(name, scale);
  const defKey = 'sprite-' + name + '-' + String(scale).replace('.', '_');
  if (!_symbolDefs.has(defKey)) {
    let raw = SPRITES[name] || SPRITES.blob;
    const frames = Array.isArray(raw[0]) ? raw : [raw];
    const f1 = gridToRects(frames[0], scale, 'frame frame-1');
    const f2 = frames[1] ? gridToRects(frames[1], scale, 'frame frame-2') : null;
    const f3 = frames[2] ? gridToRects(frames[2], scale, 'frame frame-3') : null;
    const inner = f1.rects + (f2 ? f2.rects : '') + (f3 ? f3.rects : '');
    const W = f1.w, H = f1.h;
    const klass = `sprite ${f2 ? 'two-frame' : ''} ${f3 ? 'three-frame' : ''}`.trim();
    _symbolDefs.add(defKey);
    _symbolDefMarkup.push(`<symbol id="${defKey}" class="${klass}" viewBox="0 0 ${W} ${H}">${inner}</symbol>`);
    _symbolDefDims[defKey] = { w: W, h: H, klass };
  }
  const dim = _symbolDefDims[defKey];
  return `<svg class="${dim.klass}" width="${dim.w}" height="${dim.h}" shape-rendering="crispEdges"><use href="#${defKey}"/></svg>`;
}
function spriteDefsHTML() {
  return `<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${_symbolDefMarkup.join('')}</defs></svg>`;
}

// 픽셀 chrome 아이콘 — data-icon 속성으로 마운트
function mountIcons(root) {
  (root || document).querySelectorAll('.icon-mount[data-icon]').forEach(el => {
    if (el.dataset.iconMounted === '1') return;
    const name = el.dataset.icon;
    const scale = parseInt(el.dataset.iconScale || '1', 10);
    el.innerHTML = renderSprite(name, scale);
    el.dataset.iconMounted = '1';
  });
}

// 펫 상태 정의
const PET_STATE_LABEL = {
  busy:     '일하는 중',
  done:     '방금 끝남',
  hurt:     '실패함',
  stuck:    '응답 없음',
  sleeping: '자는 중',
  egg:      '부화 대기',
};
const PET_STATE_ICON = {
  busy:     '⚙️',
  done:     '✨',
  hurt:     '🩹',
  stuck:    '🌫️',
  sleeping: '💤',
  egg:      '🥚',
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function fmtDur(s) {
  if (s == null) return '';
  if (s < 1) return '<1초';
  if (s < 60) return Math.round(s) + '초';
  const m = Math.floor(s/60), sec = Math.round(s%60);
  if (m < 60) return m + '분' + (sec ? sec + '초' : '');
  const h = Math.floor(m/60);
  return h + '시간' + (m%60) + '분';
}
function timeSince(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return Math.round(sec) + '초 전';
  if (sec < 3600) return Math.round(sec/60) + '분 전';
  if (sec < 86400) return Math.round(sec/3600) + '시간 전';
  return Math.round(sec/86400) + '일 전';
}
function projectKey(s) { return s.project_display || s.project_slug || s.project_cwd || '?'; }

// ── Day/Night ambient cycle ───────────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 9)  return 'morning';
  if (h >= 9 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}
function applyTimeOfDay() {
  document.documentElement.setAttribute('data-tod', getTimeOfDay());
}

// 매 render 마다 DOM 이 재생성돼도 CSS 애니메이션이 시각적으로 이어지도록
// animation-delay 를 wall-clock 기준으로 계산. 정적 해시 offset 만 쓰면
// 재마운트 시 phase 가 0 으로 리셋돼 "순간이동" 현상.
function wallPhaseSec(periodSec, offsetSec) {
  const periodMs = Math.max(1, periodSec * 1000);
  const offsetMs = ((offsetSec * 1000) % periodMs + periodMs) % periodMs;
  return -(((Date.now() + offsetMs) % periodMs) / 1000);
}

// ── 세션 주인공 (사람) 캐릭터 ────────────────────────────────────
// 옷 색상은 session_id 해시로 결정. 세션마다 다른 사람.
function humanColor(sessionId) {
  const h = djb2(sessionId || '');
  return { hue: h % 360, faceHue: 25 + (h % 30) - 15 };  // 옷 색만 다양
}

function shortAlias(key) {
  const seg = (key || '').split('/').filter(Boolean).pop() || key || '';
  const clean = seg.replace(/^\./, '');
  if (!clean) return '?';
  if (clean.length <= 14) return clean;
  const head = clean.slice(0, 14);
  const m = head.match(/^(.*)[-_]/);
  const cutAt = m && m[1].length >= 7 ? m[1].length : 13;
  return clean.slice(0, cutAt) + '…';
}
function humanCharacterHTML(s, opts = {}) {
  const { x = 50, y = 50, attached = false, secondary = false, labelShift = 0, noBubble = false } = opts;       // % 단위 장면 내 위치 (attached=true 면 부모 CSS 가 위치 결정)
  const labelText = shortAlias(projectKey(s));
  const sidFull = s.session_id || '';
  // breathe (3.6s) 용 phase — wall-clock 동기화
  const phase = wallPhaseSec(3.6, (djb2(s.session_id || '') % 3600) / 1000);
  const hc = humanColor(s.session_id);
  // 활동도: 펫 중 하나라도 busy 면 작업 중 → 살짝 더 활기
  const isWorking = (s.pets || []).some(p => p.state === 'busy');
  const humanTag = isWorking ? humanActivityTagFor(s) : null;
  const idleVariant = isWorking ? '' : ' ' + humanIdleVariant(s.session_id);
  const quest = humanQuestSummary(s);
  const secondaryCls = secondary ? ' secondary' : '';
  const cls = `human-char${isWorking ? ' working' : ''}${humanTag ? ' human-tag-' + humanTag : ''}${idleVariant}${attached ? '' : ' in-scene'}${secondaryCls}`;
  const sprite = renderSprite('human', 3);
  // 머리카락 variant — session_id 해시로 결정
  const HAIR_VARIANTS = ['hair-short', 'hair-long', 'hair-bun', 'hair-spiky', 'hair-ponytail'];
  const hairKey = HAIR_VARIANTS[djb2((s.session_id || '') + 'hair') % HAIR_VARIANTS.length];
  const hairJitter = (djb2((s.session_id || '') + 'hairhue') % 81) - 40;  // [-40, +40]
  const hairHueIdx = (hc.hue + 180 + hairJitter + 360) % 360;
  const hairSvgRaw = renderSprite(hairKey, 3);
  const hairSvg = hairSvgRaw.replace('<svg class="', '<svg class="hair ');
  // accessory (beanie) — ~30% 확률로 일부 세션에 부여
  const hasBeanie = (djb2((s.session_id || '') + 'beanie') % 10) < 3;
  const accessorySvg = hasBeanie
    ? renderSprite('accessory-beanie', 3).replace('<svg class="', '<svg class="accessory ')
    : '';
  // scene-wander 14s (idle) / scene-wander-active 6s (working) — 별도 wall-clock phase
  const wanderPeriod = isWorking ? 6 : 14;
  const wanderOffsetSec = ((djb2((s.session_id || '') + 'w') % 14000) / 1000);
  const wanderPhase = wallPhaseSec(wanderPeriod, wanderOffsetSec);
  const posStyle = attached ? '' : `left:${x}%; top:${y}%; z-index:${Math.floor(y)};`;
  const styleVars =
    `--phase:${phase}s; --wander-phase:${wanderPhase}s; ` +
    `--char:${bodyColor(hc.hue)}; --char-dark:${bodyColorDark(hc.hue)}; ` +
    `--face:${bodyColor(hc.faceHue)}; --face-dark:${bodyColorDark(hc.faceHue)}; ` +
    `--hair:${hairColor(hairHueIdx)}; --hair-dark:${hairColorDark(hairHueIdx)}; ` +
    posStyle;
  const extraClass = attached ? ' attached' : '';
  const bubble = (!noBubble && quest)
    ? `<div class="speech-bubble"><span>${escapeHtml(quest)}</span></div>`
    : '';
  return `
    <div class="${cls}${extraClass}" data-sid="${escapeHtml(s.session_id)}" style="${styleVars}">
      ${bubble}
      <div class="sprite-wrap human-wrap">
        ${sprite}${hairSvg}${accessorySvg}
        ${isWorking ? `<div class="prop-wrap prop-laptop">${renderSprite('prop_laptop', 1.4)}</div>` : ''}
      </div>
      <div class="char-label"${labelShift ? ` style="margin-top:${labelShift}px"` : ''}>${escapeHtml(labelText)}</div>
    </div>`;
}

// ── 펫 활동 태그 (busy 일 때 description 기반 분류) ─────────────────
const ACTIVITY_TAGS = [
  { tag: 'inspect',   re: /(triage|screenshot|scene|verify|test|review|critique|audit|check|inspect|scan|diagnose)/i,           emoji: '🌡', prop: 'prop_magnifier' },
  { tag: 'code',      re: /(code|coding|debug|refactor|write|implement|edit|modify|fix|patch)/i,                                emoji: '💻', prop: 'prop_laptop'    },
  { tag: 'build',     re: /(build|construct|wire|hammer|assemble|install)/i,                                                    emoji: '🛠', prop: 'prop_hammer'    },
  { tag: 'create',    re: /(sprite|paint|draw|design|pixel|art|create|generate|compose)/i,                                     emoji: '🎨', prop: 'prop_brush'     },
  { tag: 'chat',      re: /(chat|reply|respond|response|message|comment|conversation|말|답|대화|얘기)/i,                        emoji: '💬', prop: 'prop_speech'    },
  { tag: 'explore',   re: /(propose|research|explore|search|find|discover|investigate|locate)/i,                                emoji: '🔭', prop: 'prop_compass'   },
  { tag: 'plan',      re: /(plan|architect|strategy|decide|orchestrate|coordinate|dispatch)/i,                                  emoji: '💭', prop: 'prop_thought'   },
  { tag: 'wait',      re: /(wait|sleep|idle|pause|stale|pending|hold|standby|대기|기다|쉬)/i,                                   emoji: '⏰', prop: 'prop_clock'     },
  { tag: 'celebrate', re: /(celebrate|success|complete|finish|done|ship|release|launch|성공|완료|축하|배포)/i,                   emoji: '🎉', prop: 'prop_party'     },
];
const ACTIVITY_LABELS = {
  inspect:   '검사',
  code:      '코딩',
  build:     '구현',
  create:    '창작',
  chat:      '대화',
  explore:   '탐색',
  plan:      '사고',
  wait:      '대기',
  celebrate: '축하',
  work:      '작업',
};

function activityTagFor(p) {
  if (p.state !== 'busy') return null;
  const lr = p.latestRunning;
  const text = ((lr?.description || '') + ' ' + (lr?.prompt_first_line || '')).toLowerCase();
  for (const { tag, re, emoji, prop } of ACTIVITY_TAGS) {
    if (re.test(text)) return { tag, emoji, label: ACTIVITY_LABELS[tag] || tag, prop };
  }
  return { tag: 'work', emoji: '💼', label: '작업', prop: null };
}

// ── humanoid 활동 태그 — 세션의 최근 running 이벤트 기반 ────────────
function humanActivityTagFor(s) {
  const events = s.events || [];
  const running = events.filter(e => e.status === 'running');
  const latest = running.length
    ? running.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0]
    : events.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0];
  if (!latest) return null;
  const text = ((latest.description || '') + ' ' + (latest.prompt_first_line || '')).toLowerCase();
  for (const { tag, re } of ACTIVITY_TAGS) {
    if (re.test(text)) return tag;
  }
  return null;
}

// ── 말풍선용 현재 임무 요약 — running 이벤트의 description 우선 ─────
// _STALE_AFTER_SEC=600 (서버) 이라 running 상태가 최대 10분 유지 → bubble 이
// 작업 끝난 후에도 한참 떠 있는 문제. 클라이언트에서 더 짧은 TTL(180s) 적용.
const BUBBLE_TTL_SEC = 180;
function humanQuestSummary(s) {
  const events = s.events || [];
  const running = events.filter(e => e.status === 'running');
  if (!running.length) return null;
  const latest = running.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
  // age_sec 가 snapshot 에 있으면 그것을, 없으면 클라이언트 시계로 계산.
  const ageSec = (typeof latest.age_sec === 'number')
    ? latest.age_sec
    : Math.max(0, (Date.now() - new Date(latest.started_at).getTime()) / 1000);
  if (ageSec > BUBBLE_TTL_SEC) return null;
  const text = (latest.description || latest.prompt_first_line || '').trim();
  if (!text) return null;
  return text.length > 26 ? text.slice(0, 26) + '…' : text;
}

// ── idle 모션 variant — 작업 안 할 때 두리번/기지개/끄적임 중 하나 ──
const HUMAN_IDLE_VARIANTS = ['idle-look', 'idle-stretch', 'idle-doodle', 'idle-pace', 'idle-yawn', 'idle-sip'];
function humanIdleVariant(sessionId) {
  return HUMAN_IDLE_VARIANTS[djb2((sessionId || '') + 'idle') % HUMAN_IDLE_VARIANTS.length];
}

// ── 펫 카드 (캐릭터) ─────────────────────────────────────────────
function petHTML(p, { mini = false } = {}) {
  const isEgg = p.type === '__egg__';
  const st = isEgg ? { hue: 25 } : styleFor(p.type);
  // breathe 3.2s — wall-clock
  const phase = wallPhaseSec(3.2, (djb2(p.type) % 3200) / 1000);
  const state = p.state;
  // 로비 미니: wander 9s / wander-active 4.5s / wobble 3s — state 별
  const wanderPeriod = state === 'busy' ? 4.5 : (isEgg ? 3 : 9);
  const wanderPhase = wallPhaseSec(wanderPeriod, (djb2(p.type + 'w') % 9000) / 1000);
  const actTag = activityTagFor(p);
  const evolved = !isEgg && p.calls >= 20;
  const ascended = !isEgg && p.calls >= 50;  // 3rd tier — 50+ 호출 시 ascended (전설)
  const cls = `character pet pet-${state}${actTag ? ' tag-' + actTag.tag : ''}${mini ? ' mini' : ''}${evolved ? ' evolved' : ''}${ascended ? ' ascended' : ''}`;
  const latest = p.latestRunning || p.latest;
  const quest = (latest?.description || latest?.prompt_first_line || '').trim();
  const questShort = quest.length > 40 ? quest.slice(0, 40) + '…' : quest;
  const labelText = isEgg ? '아직 호출 없음' : getPetDisplay(p.type);
  const tooltip = isEgg
    ? '이 세션은 아직 서브에이전트를 호출하지 않았어요'
    : `${p.type} — ${PET_STATE_LABEL[state]} (총 ${p.calls}회 호출)${quest ? '\n최근 임무: ' + quest : ''}`;
  const scale = mini ? 2 : 4;
  const sprite = renderSprite(spriteFor(p.type, p.calls), scale);
  const styleVars = `--phase:${phase}s; --wander-phase:${wanderPhase}s; --char:${bodyColor(st.hue)}; --char-dark:${bodyColorDark(st.hue)};`;
  return `
    <div class="${cls}" data-pet="${escapeHtml(p.type)}" style="${styleVars}">
      ${(!mini && state === 'busy' && questShort) ? `<div class="bubble">${escapeHtml(questShort)}</div>` : ''}
      ${(!mini && state === 'sleeping') ? `<div class="zzz">💤</div>` : ''}
      ${actTag ? `<div class="activity-chip"><span class="chip-text">${actTag.label}</span></div>` : ''}
      <div class="avatar${mini ? ' mini' : ''}">
        <div class="shadow"></div>
        <div class="sprite-wrap">${sprite}</div>
        ${(state === 'busy' && actTag?.prop) ? `<div class="prop-wrap prop-${actTag.tag}">${renderSprite(actTag.prop, mini ? 1 : scale - 1)}</div>` : ''}
        ${(!mini && !isEgg && p.calls > 0) ? `<div class="${p.calls >= 50 ? 'badge ascended' : (p.calls >= 20 ? 'badge evolved' : (p.calls >= 15 ? 'badge near-evolution' : 'badge'))}">🔁 ${p.calls}</div>` : ''}
        ${(!isEgg && isPetFav(p.type)) ? `<div class="fav-star">★</div>` : ''}
      </div>
      ${mini ? '' : `<div class="char-label" data-pet-type="${escapeHtml(p.type)}">${escapeHtml(labelText)}<button class="fav-toggle" data-pet-type="${escapeHtml(p.type)}">${isPetFav(p.type) ? '★' : '☆'}</button></div>`}
      ${mini ? '' : `<div class="char-state">${PET_STATE_ICON[state]} ${PET_STATE_LABEL[state]}</div>`}
    </div>`;
}

// ── 데이터 모델 (펫) ─────────────────────────────────────────────
// 정책:
//  - 세션은 last_activity 가 최근 1시간 내면 "활성" — 그 세션의 펫 명단을 표시.
//  - 펫 명단 = 그 세션이 호출했던 모든 distinct subagent_type.
//  - 펫 상태 = 그 펫의 최근 활동 결과 (busy / done / hurt / stuck / sleeping).
const SESSION_ALIVE_MS = 60 * 60 * 1000;
const JUST_DONE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_PROBLEM_MS = 30 * 60 * 1000;    // 30분 — 그 안에 실패/끊김 이력 있으면 펫 상태 hurt/stuck

function eventTime(e) {
  return new Date(e.finished_at || e.started_at || 0).getTime();
}
function ageMs(e, now) {
  const t = eventTime(e);
  if (isNaN(t) || t === 0) return Infinity;
  return now - t;
}
function isSessionAlive(s, now) {
  if (!s.last_activity) return false;
  const t = new Date(s.last_activity).getTime();
  return !isNaN(t) && (now - t) <= SESSION_ALIVE_MS;
}

// 세션 안의 펫 명단 + 각 펫의 상태 + 통계.
function petsOf(s, now) {
  // 서브에이전트 호출이 한 번도 없는 세션은 펫 자체가 없음.
  if (!s.events || s.events.length === 0) return [];
  const byType = new Map();
  for (const e of (s.events || [])) {
    const t = e.subagent_type || '익명';
    let p = byType.get(t);
    if (!p) {
      p = { type: t, calls: 0, running: 0, latest: null, latestRunning: null, latestProblem: null };
      byType.set(t, p);
    }
    p.calls += 1;
    const evTime = eventTime(e);
    if (!p.latest || evTime > eventTime(p.latest)) p.latest = e;
    if (e.status === 'running') {
      p.running += 1;
      if (!p.latestRunning || evTime > eventTime(p.latestRunning)) p.latestRunning = e;
    }
    if ((e.status === 'failed' || e.status === 'stale') && ageMs(e, now) <= RECENT_PROBLEM_MS) {
      if (!p.latestProblem || evTime > eventTime(p.latestProblem)) p.latestProblem = e;
    }
  }
  return [...byType.values()].map(p => ({ ...p, state: petState(p, now) }))
    .sort((a, b) => {
      const fa = isPetFav(a.type) ? 1 : 0;
      const fb = isPetFav(b.type) ? 1 : 0;
      return fb - fa;
    });
}

function petState(p, now) {
  if (p.running > 0) return 'busy';
  if (p.latestProblem) {
    return p.latestProblem.status === 'failed' ? 'hurt' : 'stuck';
  }
  if (p.latest && p.latest.status === 'done' && ageMs(p.latest, now) <= JUST_DONE_WINDOW_MS) {
    return 'done';
  }
  return 'sleeping';
}

function groupByProject(snap, town) {
  // town == null/'' → 현재 town 사용. 'all' → 필터 안 함 (디버그용).
  const t = town === undefined ? currentTown() : town;
  const out = {};
  const now = Date.now();
  for (const s of (snap.sessions || [])) {
    // Claude Code 가 서브에이전트 자체 실행을 위해 만든 보조 세션 제외
    const proj = (s.project_display || s.project_slug || '').toLowerCase();
    if (proj === 'subagents' || proj === '-subagents') continue;
    // project_slug 가 비어 있으면 어디 소속인지 모름 → lobby 미표시
    // (Codex chat-only rollout 처럼 events 가 없는 파일은 cwd 도 없음)
    if (!s.project_slug) continue;
    if (!isSessionAlive(s, now)) continue;
    // town 필터 — 기본값 'claude' 로 back-compat
    const sTool = s.tool || 'claude';
    if (t && t !== 'all' && sTool !== t) continue;
    (out[projectKey(s)] ||= []).push({
      ...s,
      pets: petsOf(s, now),
    });
  }
  return out;
}

// town 별 alive 세션 수 — signpost UI 가 사용
function townCounts(snap) {
  const counts = { claude: 0, codex: 0, cursor: 0 };
  const now = Date.now();
  for (const s of (snap.sessions || [])) {
    const proj = (s.project_display || s.project_slug || '').toLowerCase();
    if (proj === 'subagents' || proj === '-subagents') continue;
    if (!s.project_slug) continue;
    if (!isSessionAlive(s, now)) continue;
    const t = s.tool || 'claude';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}
function projectStats(sessions) {
  let busy = 0, hurt = 0, stuck = 0, sleeping = 0, totalPets = 0, lastAct = '';
  for (const s of sessions) {
    if ((s.last_activity||'') > lastAct) lastAct = s.last_activity || '';
    for (const p of (s.pets || [])) {
      totalPets++;
      if (p.state === 'busy') busy++;
      else if (p.state === 'hurt') hurt++;
      else if (p.state === 'stuck') stuck++;
      else sleeping++;
    }
  }
  return { sessions: sessions.length, busy, hurt, stuck, sleeping, totalPets, last_activity: lastAct };
}

// ── 로비 렌더 ────────────────────────────────────────────────────
function renderLobby(snap) {
  const grouped = groupByProject(snap);
  const keys = Object.keys(grouped).sort((a, b) => {
    const sa = projectStats(grouped[a]);
    const sb = projectStats(grouped[b]);
    if ((sa.running > 0) !== (sb.running > 0)) return sa.running > 0 ? -1 : 1;
    return (sb.last_activity || '').localeCompare(sa.last_activity || '');
  });

  const filteredKeys = keys.filter(k => {
    if (lobbyFilterActive && projectStats(grouped[k]).busy === 0) return false;
    if (lobbySearchQuery && !k.toLowerCase().includes(lobbySearchQuery.toLowerCase())) return false;
    return true;
  });

  const lobbyControls = `
    <div class="lobby-controls">
      <input type="text" class="lobby-search" id="lobby-search"
             placeholder="/ 검색…" value="${escapeHtml(lobbySearchQuery)}"
             aria-label="프로젝트 검색">
      <button class="lobby-filter-btn${lobbyFilterActive ? ' active' : ''}" id="lobby-filter-btn"
              title="f: 활성 방만 보기">
        ${lobbyFilterActive ? '● 활성만' : '○ 전체'}
      </button>
    </div>`;

  if (filteredKeys.length === 0 && keys.length === 0) {
    return `${lobbyControls}<div class="lobby-empty">
      <div class="big">🌙</div>
      <div>마을이 조용해요.</div>
      <div class="muted">최근 1시간 안에 활동한 집이 없습니다. Claude Code 세션이 시작되면 마을에 집이 생겨요.</div>
    </div>`;
  }

  if (filteredKeys.length === 0) {
    return `${lobbyControls}<div class="lobby-empty">
      <div class="big">🔍</div>
      <div>검색 결과가 없어요.</div>
      <div class="muted">"${escapeHtml(lobbySearchQuery || '')}" 에 해당하는 프로젝트가 없습니다.</div>
    </div>`;
  }

  const cards = filteredKeys.map(k => {
    const sessions = grouped[k];
    const stats = projectStats(sessions);
    // 미리보기 펫: 모든 세션의 펫 중 일하는 펫 우선, 호출 많은 순.
    const allPets = sessions.flatMap(s => s.pets || []);
    const sortedPets = [...allPets].sort((a, b) => {
      const aBusy = a.state === 'busy' ? 1 : 0;
      const bBusy = b.state === 'busy' ? 1 : 0;
      if (aBusy !== bBusy) return bBusy - aBusy;
      return b.calls - a.calls;
    });
    const preview = sortedPets.slice(0, 6);
    const more = allPets.length - preview.length;
    const since = timeSince(stats.last_activity);
    const isActive = stats.busy > 0;

    // 대표 세션 (가장 최근 활동) — 카드 발치에 humanoid 로 표시 (집 주인)
    const repSession = sessions.slice().sort((a, b) =>
      (b.last_activity || '').localeCompare(a.last_activity || ''))[0];
    const repQuest = repSession ? humanQuestSummary(repSession) : null;
    const lobbyBubble = repQuest
      ? `<div class="speech-bubble lobby-card-bubble"><span>${escapeHtml(repQuest)}</span></div>`
      : '';
    const occupant = repSession
      ? `<div class="card-occupant">${humanCharacterHTML(repSession, { attached: true, noBubble: true })}</div>`
      : '';

    return `
      <div class="room-card${isActive ? ' active' : ''}" data-key="${escapeHtml(k)}">
        ${lobbyBubble}
        <div class="room-title">
          <span class="door">${renderSprite('door', 2)}</span>
          <span>${escapeHtml(k)}</span>
        </div>
        <div class="room-meta">
          ${stats.sessions}명 거주 · 펫 ${stats.totalPets}마리
          ${stats.busy ? ` · <span class="dot running"></span>${stats.busy} 일하는 중` : ''}
          ${stats.hurt ? ` · <span class="dot failed"></span>${stats.hurt} 실패` : ''}
          ${stats.stuck ? ` · <span class="dot stale"></span>${stats.stuck} 응답없음` : ''}
          · ${escapeHtml(since)}
        </div>
        <div class="crowd">
          ${preview.length > 0
            ? preview.map(p => petHTML(p, { mini: true })).join('') + (more > 0 ? `<div class="more">+${more}</div>` : '')
            : '<div class="empty-pets-hint">— 아직 서브에이전트를 부른 적이 없어요 —</div>'}
        </div>
        ${occupant}
      </div>`;
  }).join('');

  const villageBg = `
  <div class="village-bg" aria-hidden="true">
    <!-- 1) 하늘 / 원경 (top 0~30%) — 구름 + card 영역(15~40%) 으로 침투하는 distant 트리 -->
    <div class="vb cloud" style="left: 6%;  top: 4%;">${renderSprite('cloud-small', 2)}</div>
    <div class="vb cloud" style="left: 28%; top: 10%;">${renderSprite('cloud-small', 1)}</div>
    <div class="vb cloud" style="left: 52%; top: 5%;">${renderSprite('cloud-small', 2)}</div>
    <div class="vb cloud behind" style="left: 42%; top: 22%;">${renderSprite('cloud-small', 1)}</div>
    <div class="vb cloud" style="left: 76%; top: 9%;">${renderSprite('cloud-small', 1)}</div>
    <div class="vb cloud behind" style="left: 70%; top: 28%;">${renderSprite('cloud-small', 2)}</div>
    <div class="vb cloud" style="left: 92%; top: 3%;">${renderSprite('cloud-small', 2)}</div>
    <!-- distant 트리: card zone (15-40%) 으로 top 이 들어가 card 와 시각적으로 겹침 -->
    <div class="vb tree distant" style="left: 4%;  top: 32%;">${renderSprite('tree-pine', 2)}</div>
    <div class="vb tree distant" style="left: 95%; top: 30%;">${renderSprite('tree-pine', 2)}</div>
    <div class="vb tree distant" style="left: 38%; top: 28%;">${renderSprite('tree-bush', 2)}</div>
    <div class="vb tree distant" style="left: 62%; top: 30%;">${renderSprite('tree-bush', 2)}</div>
    <div class="vb tree distant" style="left: 18%; top: 34%;">${renderSprite('tree-pine', 1)}</div>
    <div class="vb tree distant" style="left: 82%; top: 34%;">${renderSprite('tree-pine', 1)}</div>

    <!-- 2) 중경 (top 30~55%) — 큰 나무 crown + lantern + signpost + fence line -->
    <div class="vb tree"  style="left: 8%;  top: 38%;">${renderSprite('tree-pine', 2)}</div>
    <div class="vb tree"  style="left: 90%; top: 36%;">${renderSprite('tree-pine', 2)}</div>
    <div class="vb tree"  style="left: 22%; top: 50%;">${renderSprite('tree-bush', 2)}</div>
    <div class="vb tree"  style="left: 78%; top: 52%;">${renderSprite('tree-bush', 2)}</div>
    <div class="vb lantern" style="left: 14%; top: 48%;">${renderSprite('lantern-post', 2)}</div>
    <div class="vb lantern" style="left: 86%; top: 48%;">${renderSprite('lantern-post', 2)}</div>
    <div class="vb signpost" style="left: 44%; top: 54%;">${renderSprite('signpost', 2)}</div>

    <!-- 3) 전경 (top 60~95%) — fence line + 큰 나무 + 우물 + 풀/꽃/돌 -->
    <div class="vb tree"  style="left: 2%;  top: 62%;">${renderSprite('tree-pine', 3)}</div>
    <div class="vb tree"  style="left: 96%; top: 60%;">${renderSprite('tree-pine', 3)}</div>
    <div class="vb tree"  style="left: 50%; top: 70%;">${renderSprite('tree-pine', 2)}</div>
    <div class="vb fence" style="left: 16%; top: 76%;">${renderSprite('fence-post', 2)}</div>
    <div class="vb fence" style="left: 22%; top: 76%;">${renderSprite('fence-post', 2)}</div>
    <div class="vb fence" style="left: 28%; top: 76%;">${renderSprite('fence-post', 2)}</div>
    <div class="vb fence" style="left: 72%; top: 76%;">${renderSprite('fence-post', 2)}</div>
    <div class="vb fence" style="left: 78%; top: 76%;">${renderSprite('fence-post', 2)}</div>
    <div class="vb fence" style="left: 84%; top: 76%;">${renderSprite('fence-post', 2)}</div>
    <div class="vb well"  style="left: 64%; top: 80%;">${renderSprite('well', 3)}</div>
    <div class="vb grass" style="left: 12%; top: 82%;">${renderSprite('grass-tuft', 1)}</div>
    <div class="vb grass" style="left: 32%; top: 86%;">${renderSprite('grass-tuft', 1)}</div>
    <div class="vb grass" style="left: 58%; top: 84%;">${renderSprite('grass-tuft', 1)}</div>
    <div class="vb grass" style="left: 88%; top: 84%;">${renderSprite('grass-tuft', 1)}</div>
    <div class="vb flower" style="left: 20%; top: 78%;">${renderSprite('flower', 2)}</div>
    <div class="vb flower" style="left: 38%; top: 88%;">${renderSprite('flower', 2)}</div>
    <div class="vb flower" style="left: 56%; top: 90%;">${renderSprite('flower', 2)}</div>
    <div class="vb flower" style="left: 82%; top: 88%;">${renderSprite('flower', 2)}</div>
    <div class="vb stone"  style="left: 28%; top: 92%;">${renderSprite('path-stone', 2)}</div>
    <div class="vb stone"  style="left: 50%; top: 94%;">${renderSprite('path-stone', 2)}</div>
    <div class="vb stone"  style="left: 72%; top: 92%;">${renderSprite('path-stone', 2)}</div>
    <!-- 4) 로비 deco — 마을 소품 (fallback: signpost/lantern-post/well) -->
    <div class="lobby-deco lobby-village-sign" style="left:8%; bottom:5%;">${renderSprite('deco_village_sign', 3) || renderSprite('signpost', 3)}</div>
    <div class="lobby-deco lobby-bench" style="right:12%; bottom:8%;">${renderSprite('deco_bench', 3) || renderSprite('lantern-post', 3)}</div>
    <div class="lobby-deco lobby-fountain" style="left:50%; transform:translateX(-50%); bottom:3%;">${renderSprite('deco_fountain_small', 3) || renderSprite('well', 3)}</div>
    <!-- 5) 구름 drift — sky zone 에 추가 cloud -->
    <div class="cloud-small-deco vb cloud" style="left:15%; top:8%;">${renderSprite('cloud-small', 2)}</div>
    <div class="cloud-small-deco vb cloud" style="left:60%; top:14%; animation-duration:80s; animation-direction:reverse;">${renderSprite('cloud-small', 1)}</div>
  </div>`;
  // humanoid 는 이제 각 card 내부 .card-occupant 에 렌더 — 카드 발치에 자리잡음.
  return `<div class="lobby-wrap">${villageBg}${lobbyControls}<div class="rooms">${cards}</div></div>`;
}

// ── 일별 시간대 히스토그램 ────────────────────────────────────────
function buildHourlyHistogram(sessions) {
  const counts = Array(24).fill(0);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const s of (sessions || [])) {
    for (const e of (s.events || [])) {
      const t = new Date(e.started_at || 0).getTime();
      if (isNaN(t) || t < todayStart) continue;
      const h = new Date(t).getHours();
      counts[h] += 1;
    }
  }
  return counts;
}

function buildRibbonHTML(sessions) {
  const hourly = buildHourlyHistogram(sessions);
  const currentHour = new Date().getHours();
  const cells = hourly.map((c, h) => {
    const isCurrent = h === currentHour ? ' is-current' : '';
    const barDisplay = c === 0 ? 'display:none;' : '';
    const barH = Math.min(100, c * 12);
    return `<div class="hour-cell${isCurrent}" data-hour="${h}" data-count="${c}" title="${h}시: ${c}회">` +
      `<div class="hour-bar" style="height:${barH}%;${barDisplay}"></div>` +
      `<span class="hour-tick">${h % 6 === 0 ? h : ''}</span>` +
      `</div>`;
  }).join('');
  return `<div class="hour-ribbon" aria-label="오늘 시간대별 호출">${cells}</div>`;
}

// ── 화이트보드 통계 텍스트 회전 ──────────────────────────────────
function buildBoardLines(s) {
  const pets = s.pets || [];
  const totalCalls = pets.reduce((sum, p) => sum + (p.calls || 0), 0);
  const busyCount = pets.filter(p => p.state === 'busy').length;
  const topPet = [...pets].sort((a, b) => (b.calls || 0) - (a.calls || 0))[0];
  return [
    `호출 ${totalCalls}회`,
    busyCount > 0 ? `작업중 ${busyCount}` : '모두 휴식',
    topPet ? `★ ${getPetDisplay(topPet.type).slice(0, 8)}` : '',
  ].filter(Boolean);
}

let _boardLineIdx = 0;
function rotateBoards() {
  document.querySelectorAll('.whiteboard-text[data-project]').forEach(el => {
    const proj = el.dataset.project;
    const grouped = lastSnap ? groupByProject(lastSnap) : {};
    const sessions = grouped[proj] || [];
    // gather all lines from all sessions in this project
    const allLines = sessions.flatMap(s => buildBoardLines(s));
    if (!allLines.length) { el.textContent = ''; return; }
    el.textContent = allLines[_boardLineIdx % allLines.length];
  });
  _boardLineIdx++;
}
if (!window._boardRotator) {
  window._boardRotator = setInterval(rotateBoards, 4000);
}

// ── 방 안 렌더 ───────────────────────────────────────────────────
function renderRoom(snap, projectKeyName) {
  const grouped = groupByProject(snap);
  let sessions = grouped[projectKeyName];
  if (!sessions) {
    // 현재 town 에 없으면 다른 town 에서 찾기 (URL 슬러그가 raw slug 인 케이스 포함)
    const allGrouped = groupByProject(snap, 'all');
    // 1) 정확 일치
    if (allGrouped[projectKeyName]) {
      const other = allGrouped[projectKeyName][0];
      const otherTown = other.tool || 'claude';
      // 자동 town 전환 + 라우팅 보정
      const enc = encodeURIComponent(projectKeyName);
      location.hash = (otherTown === 'claude') ? '#room/' + enc : '#town/' + otherTown + '/room/' + enc;
      return '<div class="lobby-empty"><div class="muted">마을 이동 중…</div></div>';
    }
    // 2) project_slug 로 매칭 (사용자가 URL 에 raw slug 입력한 경우)
    for (const key of Object.keys(allGrouped)) {
      const sample = allGrouped[key][0];
      if (sample && (sample.project_slug === projectKeyName || sample.project_display === projectKeyName)) {
        const otherTown = sample.tool || 'claude';
        const correctKey = projectKey(sample);
        const enc = encodeURIComponent(correctKey);
        location.hash = (otherTown === 'claude') ? '#room/' + enc : '#town/' + otherTown + '/room/' + enc;
        return '<div class="lobby-empty"><div class="muted">마을 이동 중…</div></div>';
      }
    }
    return `<div class="lobby-empty">
      <div class="big">🏚️</div>
      <div>그 집은 보이지 않아요.</div>
      <button class="back-btn" onclick="window.goLobby()"><span class="back-arrow">${renderSprite('arrow-back', 1)}</span> 마을로</button>
    </div>`;
  }

  // 세션을 방 안에 배치 — 가로로 분포, 같은 세션의 펫은 주인공 옆에.
  // 세션이 N개면 가로로 등분, 세로는 약간 zig-zag 로 자연스럽게.
  const _orderedAll = [...sessions].sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));
  // 렉 방지: 한 방에 렌더할 휴머노이드 상한 (초과분은 "+N 더" 로 표기). 최근 활동순으로 cap.
  const ROOM_CAP = 60;
  const ordered = _orderedAll.slice(0, ROOM_CAP);
  const roomHidden = _orderedAll.length - ordered.length;
  const N = ordered.length;

  const entities = []; // 장면 위에 배치할 모든 캐릭터 HTML

  // First pass: compute all humanoid x/y positions so we can detect label collisions.
  const humanoidPositions = ordered.map((s, idx) => {
    const isPrimary = idx === 0;
    let slotX;
    if (N === 1 || isPrimary) {
      slotX = 12 + (djb2(s.session_id + 'sx') % 77);
    } else {
      const secIdx = idx - 1;
      const secCount = N - 1;
      if (secCount === 1) {
        slotX = 80;
      } else {
        const halfPoint = Math.ceil(secCount / 2);
        if (secIdx < halfPoint) {
          slotX = 12 + (secIdx / Math.max(1, halfPoint - 1)) * 26;
        } else {
          const rIdx = secIdx - halfPoint;
          const rCount = secCount - halfPoint;
          slotX = 62 + (rCount > 1 ? (rIdx / (rCount - 1)) * 26 : 13);
        }
      }
    }
    const jitter = ((djb2(s.session_id + 'jx') % 100) / 100 * 5) - 2.5;
    const defaultX = Math.max(8, Math.min(92, slotX + jitter));
    const defaultY = isPrimary
      ? 62 + (djb2(s.session_id + 'hy') % 12)
      : 78 + (idx % 2) * 4;
    const savedHuman = getScenePos(s.session_id, 'human');
    const xPct = savedHuman ? savedHuman.x : defaultX;
    const yPct = Math.min(82, savedHuman ? savedHuman.y : defaultY);
    return { s, idx, xPct, yPct, isPrimary };
  });

  // Label-collision offset: sort by x, bump labels that share a close x baseline.
  // Threshold: 4% of scene width (≈ 36px at 900px wide) — matches ~30px spec.
  const LABEL_X_THRESHOLD = 4;
  const LABEL_SHIFT_PX = 14;
  const labelShiftMap = new Map(); // session_id → px shift
  const sortedByX = [...humanoidPositions].sort((a, b) => a.xPct - b.xPct);
  let groupStart = 0;
  for (let i = 1; i <= sortedByX.length; i++) {
    const isLast = i === sortedByX.length;
    const gap = isLast ? Infinity : sortedByX[i].xPct - sortedByX[i - 1].xPct;
    if (gap > LABEL_X_THRESHOLD) {
      // close group: [groupStart .. i-1]
      const group = sortedByX.slice(groupStart, i);
      if (group.length > 1) {
        // Alternate shifts: 0, +14, -14, +28, -28 … keeps first label natural.
        group.forEach((item, gi) => {
          const half = Math.ceil(gi / 2);
          const shift = gi === 0 ? 0 : (gi % 2 === 1 ? half * LABEL_SHIFT_PX : -(half * LABEL_SHIFT_PX));
          labelShiftMap.set(item.s.session_id, shift);
        });
      }
      groupStart = i;
    }
  }

  ordered.forEach((s, idx) => {
    const pos = humanoidPositions[idx];
    const { xPct, yPct, isPrimary } = pos;
    entities.push(humanCharacterHTML(s, { x: xPct, y: yPct, secondary: !isPrimary, labelShift: labelShiftMap.get(s.session_id) || 0 }));

    // 그 세션의 펫들 — 저장된 위치 우선, 없으면 floor zone hash-grid 분포
    const pets = [...(s.pets || [])];
    pets.forEach((p, j) => {
      const seed = djb2(p.type + s.session_id);
      const cellX = seed % 6;
      const cellY = Math.floor(seed / 6) % 3;
      const jx = ((seed >> 8) & 0x7f) / 127 * 6 - 3;
      const jy = ((seed >> 16) & 0x7f) / 127 * 5 - 2.5;
      const defaultPx = Math.max(8, Math.min(92, 10 + cellX * 16 + jx));
      const defaultPy = Math.max(64, Math.min(84, 66 + cellY * 10 + jy));
      const savedPet = getScenePos(s.session_id, `pet:${p.type}`);
      let px, py;
      if (savedPet) {
        px = savedPet.x;
        // Clamp saved y: pet sprite ~70px div, half=35px + 16px wander → cap at 84 (matches seed max).
        py = Math.min(84, savedPet.y);
      } else if (p.state === 'sleeping') {
        // sleeping 펫 절반은 floor 옆 (기존), 절반은 upper-zone 가구 위에 — 거주(inhabit) 메타포.
        const upperSlot = djb2(p.type + s.session_id + j + 'u') % 100;
        if (upperSlot < 50) {
          // upper zone — 가구 좌표 풀 (bookshelf, desk-top, bookshelf-tall, whiteboard 아래 선반)
          const spots = [
            [12, 38],  // bookshelf 위 (left:10% top:30% 의 살짝 오른쪽 위)
            [25, 50],  // deco_desk 위 (left:23% top:58% 의 책상 윗면)
            [40, 28],  // painting-frame 옆 (left:37% top:15% 의 살짝 아래)
            [62, 32],  // deco_window 옆 빈 벽
            [78, 30],  // 우측 painting-frame 옆
            [88, 55],  // deco_bookshelf_tall (left:88% top:65%) 상단 선반
          ];
          const [sx, sy] = spots[djb2(p.type + s.session_id + j + 's') % spots.length];
          px = sx; py = sy;
        } else {
          // floor 옆 — 기존 로직 그대로
          px = Math.max(8, Math.min(92, xPct + (djb2(p.type + s.session_id + j) % 14) - 7));
          py = 74 + (djb2(p.type + s.session_id + j + 'y') % 11);  // 74..84 (micro-depth for sleeping cluster)
        }
      } else {
        // Active pets: distribute across 15–85% of floor independently of owner xPct.
        // seed includes session_id + index so same-type pets across sessions don't stack.
        // ownerPull reduced to 0.12 so owner association is felt without causing centre-bias.
        const baseSpread = 5 + (djb2(p.type + s.session_id + j) % 91);  // 5..95% raw spread — 좌·우 extreme 까지 inhabit
        const ownerPull = 0;                                               // owner-independent; room canvas is wide
        const blended = baseSpread * (1 - ownerPull) + xPct * ownerPull;
        px = Math.max(8, Math.min(92, blended));
        py = 52 + (djb2(p.type + s.session_id + j + 'y') % 33);  // 52..84 (full floor depth spread, unique per pet)
      }
      entities.push(petInSceneHTML(p, s.session_id, { x: px, y: py }));
    });
  });

  const totalPets = ordered.reduce((sum, s) => sum + (s.pets?.length || 0), 0);
  const busyCount = ordered.reduce((sum, s) => sum + (s.pets || []).filter(p => p.state === 'busy').length, 0);

  return `
    <div class="room-header">
      <button class="back-btn" onclick="window.goLobby()"><span class="back-arrow">${renderSprite('arrow-back', 1)}</span> 마을</button>
      <div class="room-title-big">${renderSprite('door', 2)} ${escapeHtml(projectKeyName)}</div>
      <div class="room-meta-line muted">
        ${sessions.length}명 거주${roomHidden > 0 ? ` <span class="room-cap-note">(최근 ${ROOM_CAP}명 표시 · +${roomHidden})</span>` : ''} · 펫 ${totalPets}마리
        ${busyCount > 0 ? ` · ${busyCount}마리 일하는 중` : ''}
      </div>
    </div>
    <div class="scene">
      <div class="floor"></div>
      <div class="wall-decor wall-tall" style="left: 10%; top: 30%;">${renderSprite('bookshelf', 3)}</div>
      <div class="wall-decor" style="left: 23%; top: 18%;">${renderSprite('wall-clock', 3)}</div>
      <div class="wall-decor" style="left: 37%; top: 15%;">${renderSprite('painting-frame', 3)}</div>
      <div class="deco-window" style="left:50%; top:15%;"><div class="window-sky"></div>${renderSprite('deco_window', 3)}</div>
      <div class="deco-sky-body" style="left:60%; top:6%;">${renderSprite('deco_sun_moon', 2)}</div>
      <div class="wall-decor" style="left: 74%; top: 18%;">${renderSprite('painting-frame', 2)}</div>
      <div class="deco-whiteboard" style="left:88%; top:12%;">${renderSprite('deco_whiteboard', 4)}<div class="whiteboard-text" data-project="${escapeHtml(projectKeyName)}"></div></div>
      <div class="floor-decor" style="left: 14%; top: 88%;">${renderSprite('plant-pot', 2)}</div>
      <div class="floor-decor" style="left: 88%; top: 88%;">${renderSprite('plant-pot', 2)}</div>
      <div class="floor-decor floor-rug" style="left: 50%; top: 92%;">${renderSprite('rug', 3)}</div>
      <div class="deco-desk" style="left:23%; top:58%;">${renderSprite('deco_desk', 3)}</div>
      <div class="deco-couch" style="left:12%; top:75%;">${renderSprite('deco_couch', 3)}</div>
      <div class="deco-bookshelf-tall" style="left:88%; top:65%;">${renderSprite('deco_bookshelf_tall', 3)}</div>
      ${entities.join('')}
      ${buildRibbonHTML(ordered)}
    </div>`;
}

// 장면 안에 절대 위치로 배치되는 펫 (룸 뷰 전용)
function petInSceneHTML(p, sessionId, opts = {}) {
  const { x = 50, y = 50 } = opts;
  // 기존 petHTML 재사용 + 위치 스타일 추가
  const isEgg = p.type === '__egg__';
  const st = isEgg ? { hue: 25 } : styleFor(p.type);
  // breathe 3.2s 용
  const phase = wallPhaseSec(3.2, (djb2(p.type + sessionId) % 3200) / 1000);
  const state = p.state;
  // scene-wander 9s / scene-wander-active 4.5s / scene-wobble 3.5s — state 별 period
  const wanderPeriod = state === 'busy' ? 4.5 : (isEgg ? 3.5 : 9);
  const wanderOffsetSec = ((djb2(p.type + sessionId + 'w') % 9000) / 1000);
  const wanderPhase = wallPhaseSec(wanderPeriod, wanderOffsetSec);
  const actTag = activityTagFor(p);
  const evolved = !isEgg && p.calls >= 20;
  const ascended = !isEgg && p.calls >= 50;
  const cls = `character pet pet-${state}${actTag ? ' tag-' + actTag.tag : ''} in-scene${evolved ? ' evolved' : ''}${ascended ? ' ascended' : ''}`;
  const latest = p.latestRunning || p.latest;
  const quest = (latest?.description || latest?.prompt_first_line || '').trim();
  const questShort = quest.length > 40 ? quest.slice(0, 40) + '…' : quest;
  const labelText = isEgg ? '아직 호출 없음' : getPetDisplay(p.type);
  const tooltip = isEgg
    ? '이 세션은 아직 서브에이전트를 호출하지 않았어요'
    : `${p.type} — ${PET_STATE_LABEL[state]} (총 ${p.calls}회 호출)${quest ? '\n최근 임무: ' + quest : ''}`;
  const sprite = renderSprite(spriteFor(p.type, p.calls), 3);
  const styleVars =
    `--phase:${phase}s; --wander-phase:${wanderPhase}s; --char:${bodyColor(st.hue)}; --char-dark:${bodyColorDark(st.hue)}; ` +
    `left:${x}%; top:${y}%; z-index:${Math.floor(y)};`;
  return `
    <div class="${cls}" data-pet="${escapeHtml(p.type)}" data-sid="${escapeHtml(sessionId)}" style="${styleVars}">
      ${(state === 'busy' && questShort) ? `<div class="bubble">${escapeHtml(questShort)}</div>` : ''}
      ${(state === 'sleeping') ? `<div class="zzz">💤</div>` : ''}
      ${actTag ? `<div class="activity-chip"><span class="chip-text">${actTag.label}</span></div>` : ''}
      <div class="avatar">
        <div class="shadow"></div>
        <div class="sprite-wrap">${sprite}</div>
        ${(state === 'busy' && actTag?.prop) ? `<div class="prop-wrap prop-${actTag.tag}">${renderSprite(actTag.prop, 2)}</div>` : ''}
        ${(!isEgg && p.calls > 0) ? `<div class="badge">🔁 ${p.calls}</div>` : ''}
        ${(!isEgg && isPetFav(p.type)) ? `<div class="fav-star">★</div>` : ''}
      </div>
      <div class="char-label" data-pet-type="${escapeHtml(p.type)}">${escapeHtml(labelText)}<button class="fav-toggle" data-pet-type="${escapeHtml(p.type)}">${isPetFav(p.type) ? '★' : '☆'}</button></div>
    </div>`;
}

// ── 장면 드래그-앤-드롭 ─────────────────────────────────────────
function attachSceneDrag(sceneEl, sessionId) {
  if (!sceneEl || sceneEl._dragWired) return;
  sceneEl._dragWired = true;
  let dragState = null;

  sceneEl.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.pet.in-scene, .human-char.in-scene');
    if (!target) return;
    const isHuman = target.classList.contains('human-char');
    const entityKey = isHuman ? 'human' : `pet:${target.dataset.pet}`;
    const sid = target.dataset.sid || sessionId;  // 펫은 data-sid 직접, humanoid 는 sessionId 폴백
    const rect = sceneEl.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const originX = tRect.left + tRect.width / 2 - rect.left;
    const originY = tRect.top + tRect.height / 2 - rect.top;
    dragState = { el: target, entityKey, sid, startX: e.clientX, startY: e.clientY, originX, originY, rect };
    target.classList.add('dragging');
    target.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  sceneEl.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const newCX = dragState.originX + dx;
    const newCY = dragState.originY + dy;
    const xPct = Math.max(5, Math.min(95, (newCX / dragState.rect.width) * 100));
    // Cap at 82% so that even a tall humanoid (120px sprite + label, half=71px)
    // stays fully inside the scene at min height (540px) including max wander (+16px).
    const yPct = Math.max(50, Math.min(82, (newCY / dragState.rect.height) * 100));
    // scene-wander uses translate(-50%, -50%) so left/top is center-point
    dragState.el.style.left = xPct + '%';
    dragState.el.style.top  = yPct + '%';
  });

  sceneEl.addEventListener('pointerup', (e) => {
    if (!dragState) return;
    const cx = parseFloat(dragState.el.style.left);
    const cy = parseFloat(dragState.el.style.top);
    if (!isNaN(cx) && !isNaN(cy)) {
      setScenePos(dragState.sid, dragState.entityKey, cx, cy);
    }
    dragState.el.classList.remove('dragging');
    dragState.el.releasePointerCapture(e.pointerId);
    dragState = null;
  });

  sceneEl.addEventListener('pointercancel', () => {
    if (dragState) { dragState.el.classList.remove('dragging'); dragState = null; }
  });
}

// ── 상세 패널 (펫 기준) ─────────────────────────────────────────
// openDetail = "<sessionId>::<petType>"
function findPet(snap, key) {
  if (!key) return null;
  const [sid, ...rest] = key.split('::');
  const petType = rest.join('::');
  const now = Date.now();
  for (const s of snap.sessions || []) {
    if (s.session_id !== sid) continue;
    const pet = (petsOf(s, now)).find(p => p.type === petType);
    if (pet) return { pet, session: s };
  }
  return null;
}
function findSession(snap, sid) {
  if (!sid) return null;
  for (const s of (snap.sessions || [])) {
    if (s.session_id === sid) return s;
  }
  return null;
}
function sessionDetailHTML(s) {
  const now = Date.now();
  const pets = petsOf(s, now);
  const totalCalls = pets.reduce((a, p) => a + (p.calls || 0), 0);
  const runningCalls = pets.reduce((a, p) => a + (p.running || 0), 0);
  const tool = s.tool || 'claude';
  const projectDisplay = s.project_display || s.project_slug || '?';
  const events = (s.events || []).slice().sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  const runningEvents = events.filter(e => e.status === 'running').slice(0, 3);
  const recentDone = events.filter(e => e.status === 'done' || e.status === 'failed').slice(0, 5);
  const fmtRow = (e) => {
    const dur = fmtDur(e.duration_sec) || '-';
    const desc = (e.description || e.prompt_first_line || '').slice(0, 60);
    const sub = e.subagent_type ? `<span class="log-sub">${escapeHtml(e.subagent_type)}</span>` : '';
    return `<div class="log-item s-${e.status}">
      <span class="log-status">${e.status}</span>
      <span class="log-dur">${escapeHtml(dur)}</span>
      ${sub}
      <span class="log-desc">${escapeHtml(desc)}</span>
    </div>`;
  };
  const lastAct = s.last_activity ? new Date(s.last_activity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
  return `
    <aside class="detail open">
      <button class="detail-close" onclick="closeDetail()">×</button>
      <h3>세션 정보 <span class="muted" style="font-size:11px;">(${escapeHtml(tool)})</span></h3>
      <div class="row"><div class="key">프로젝트</div><div class="val">${escapeHtml(projectDisplay)}</div></div>
      <div class="row"><div class="key">세션 ID</div><div class="val"><code>${escapeHtml((s.session_id || '').slice(0, 24))}</code></div></div>
      <div class="row"><div class="key">마지막 활동</div><div class="val">${escapeHtml(lastAct)}</div></div>
      <div class="row"><div class="key">총 호출</div><div class="val">${totalCalls}회 (지금 ${runningCalls}건 진행)</div></div>
      <div class="row"><div class="key">펫</div><div class="val">${pets.length}마리</div></div>
      ${runningEvents.length ? `<h4 style="margin-top:14px;font-size:13px;">진행 중</h4><div class="log">${runningEvents.map(fmtRow).join('')}</div>` : ''}
      <h4 style="margin-top:14px;font-size:13px;">최근 완료</h4>
      <div class="log">${recentDone.map(fmtRow).join('') || '<div class="muted">없음</div>'}</div>
    </aside>`;
}
function detailHTML(snap) {
  if (!openDetail) return '';
  // session-level detail: key = "<sid>::__session__"
  if (openDetail.endsWith('::__session__')) {
    const sid = openDetail.slice(0, -('::__session__').length);
    const sess = findSession(snap, sid);
    if (!sess) return '';
    return sessionDetailHTML(sess);
  }
  const found = findPet(snap, openDetail);
  if (!found) return '';
  const { pet: p, session: s } = found;
  const latest = p.latestRunning || p.latest;
  const recentCalls = (s.events || [])
    .filter(e => e.subagent_type === p.type)
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
    .slice(0, 5);
  const callsLog = recentCalls.map(e => {
    const dur = fmtDur(e.duration_sec) || '-';
    const desc = (e.description || e.prompt_first_line || '').slice(0, 50);
    return `<div class="log-item s-${e.status}">
      <span class="log-status">${e.status}</span>
      <span class="log-dur">${escapeHtml(dur)}</span>
      <span class="log-desc">${escapeHtml(desc)}</span>
    </div>`;
  }).join('');
  return `
    <aside class="detail open">
      <button class="detail-close" onclick="closeDetail()">×</button>
      <div class="preview">
        ${petHTML(p, { mini: false })}
        <div>
          <h3>${escapeHtml(p.type)}</h3>
          <div class="muted">${PET_STATE_ICON[p.state]} ${PET_STATE_LABEL[p.state]} · ${p.calls}회 호출됨</div>
        </div>
      </div>
      <div class="row"><div class="key">최근 임무</div><div class="val">${escapeHtml(latest?.description || latest?.prompt_first_line || '-')}</div></div>
      <div class="row"><div class="key">소속 세션</div><div class="val">${escapeHtml((s.session_id || '').slice(0, 12))}</div></div>
      <div class="row"><div class="key">총 호출</div><div class="val">${p.calls}회 (지금 ${p.running}건 진행)</div></div>
      <h4 style="margin-top:18px;font-size:13px;">최근 호출 로그</h4>
      <div class="log">${callsLog || '<div class="muted">없음</div>'}</div>
    </aside>`;
}
window.closeDetail = () => { openDetail = null; render(lastSnap); };

// ── 설정 패널 ───────────────────────────────────────────────────
const AVAILABLE_SPRITES = ['blob','bird','pup','slime','bunny','rabbit','star','frog','cat','mushroom','ghost-puff','fish','dragon-baby'];

function distinctSubagentTypes(snap) {
  const set = new Set();
  for (const s of (snap?.sessions || [])) {
    for (const e of (s.events || [])) {
      const t = e.subagent_type;
      if (t) set.add(t);
    }
  }
  return [...set].sort();
}

function settingsHTML(snap) {
  const types = distinctSubagentTypes(snap);
  const rows = types.map(t => {
    const cfg = petConfig[t] || {};
    const baseHue = NAMED[t] ? NAMED[t].hue : (djb2(t) % 360);
    const sprite = cfg.sprite || spriteFor(t);
    const hue = cfg.hue ?? baseHue;
    const label = cfg.label ?? '';
    const isOverridden = !!(cfg.sprite || cfg.hue != null || cfg.label);
    const styleVars = `--char:${bodyColor(hue)}; --char-dark:${bodyColorDark(hue)};`;
    return `
      <div class="settings-row${isOverridden ? ' overridden' : ''}" data-type="${escapeHtml(t)}">
        <div class="settings-preview" style="${styleVars}">${renderSprite(sprite, 2)}</div>
        <div class="settings-fields">
          <div class="settings-name"><code>${escapeHtml(t)}</code>${isOverridden ? ' <span class="muted">(커스텀)</span>' : ''}</div>
          <label class="field">
            <span>스프라이트</span>
            <select data-field="sprite">
              ${AVAILABLE_SPRITES.map(opt =>
                `<option value="${opt}"${opt === sprite ? ' selected' : ''}>${opt}</option>`
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span>색상</span>
            <input type="range" min="0" max="360" step="5" value="${hue}" data-field="hue">
            <span class="hue-val">${hue}°</span>
          </label>
          <label class="field">
            <span>이름</span>
            <input type="text" placeholder="${escapeHtml(t)}" value="${escapeHtml(label)}" data-field="label" maxlength="32">
          </label>
          ${isOverridden ? `<button class="reset-row" data-field="reset">기본값 복원</button>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="settings-panel open">
      <div class="settings-head">
        <h2><span class="icon-mount" data-icon="cog" data-icon-scale="1"></span> 펫 설정</h2>
        <button class="detail-close" onclick="window.closeSettings()">×</button>
      </div>
      <p class="muted settings-help">발견된 서브에이전트마다 스프라이트/색상/이름을 직접 정할 수 있어요. 저장은 자동.</p>
      ${types.length === 0 ? '<div class="muted" style="padding:30px;text-align:center">아직 발견된 펫이 없어요. Agent 도구를 한 번이라도 호출하면 여기 나타납니다.</div>' : rows}
      ${types.length > 0 ? '<div class="settings-actions"><button onclick="window.resetAllPetConfig()">전체 초기화</button></div>' : ''}
    </div>`;
}

function renderSettings() {
  const el = document.getElementById('settings-root');
  if (!el) return;
  if (!settingsOpen) { el.innerHTML = ''; return; }
  el.innerHTML = settingsHTML(lastSnap);
  mountIcons(el);
  // 입력 핸들러
  el.querySelectorAll('.settings-row').forEach(row => {
    const t = row.dataset.type;
    row.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      const handler = (ev) => {
        petConfig[t] = petConfig[t] || {};
        if (field === 'sprite')      petConfig[t].sprite = ev.target.value;
        else if (field === 'hue')    petConfig[t].hue    = parseInt(ev.target.value, 10);
        else if (field === 'label')  {
          const v = ev.target.value.trim();
          if (v) petConfig[t].label = v; else delete petConfig[t].label;
        } else if (field === 'reset') {
          delete petConfig[t];
        }
        // 빈 객체 정리
        if (petConfig[t] && Object.keys(petConfig[t]).length === 0) delete petConfig[t];
        savePetConfig();
        renderSettings();           // 패널 자체 갱신
        if (lastSnap) render(lastSnap);  // 메인 화면도 반영
      };
      // hue range 슬라이더: 드래그 중에는 패널/메인 재렌더 X (~146 sprite 전부 다시 그리면 느려짐).
      // CSS var 와 표시 텍스트만 갱신하고, 드래그 끝(change)에서 한 번만 풀 렌더.
      if (input.tagName === 'INPUT' && input.type === 'range' && field === 'hue') {
        const previewEl = row.querySelector('.settings-preview');
        const hueValEl  = row.querySelector('.hue-val');
        input.addEventListener('input', (ev) => {
          const hue = parseInt(ev.target.value, 10);
          if (previewEl) {
            previewEl.style.setProperty('--char',      bodyColor(hue));
            previewEl.style.setProperty('--char-dark', bodyColorDark(hue));
          }
          if (hueValEl) hueValEl.textContent = hue + '°';
        });
        input.addEventListener('change', handler);
      } else {
        input.addEventListener('change', handler);
      }
      if (input.tagName === 'BUTTON' && field === 'reset') input.addEventListener('click', handler);
    });
  });
}

window.openSettings = () => { settingsOpen = true; renderSettings(); };
window.closeSettings = () => { settingsOpen = false; renderSettings(); };
window.resetAllPetConfig = () => {
  if (!confirm('모든 펫 커스터마이즈를 지울까요?')) return;
  petConfig = {};
  savePetConfig();
  renderSettings();
  if (lastSnap) render(lastSnap);
};

// ── 라우팅 + 렌더 ───────────────────────────────────────────────
// URL 스킴:
//   `` (빈 hash)                       → claude lobby (default town)
//   `#town/claude` / `#town/codex`      → 해당 마을 lobby
//   `#room/<key>`                       → claude room (back-compat)
//   `#town/<t>/room/<key>`              → 해당 마을 room
const VALID_TOWNS = ['claude', 'codex', 'cursor'];
function currentTown() {
  const h = location.hash || '';
  const m1 = h.match(/^#town\/([a-z]+)(\/room\/.+)?$/);
  if (m1 && VALID_TOWNS.includes(m1[1])) return m1[1];
  return 'claude';  // default
}
function currentRoom() {
  const h = location.hash || '';
  const m1 = h.match(/^#town\/[a-z]+\/room\/(.+)$/);
  if (m1) return decodeURIComponent(m1[1]);
  const m2 = h.match(/^#room\/(.+)$/);
  if (m2) return decodeURIComponent(m2[1]);
  return null;
}
function setTown(t) {
  if (!VALID_TOWNS.includes(t)) return;
  location.hash = (t === 'claude') ? '' : '#town/' + t;
}
function navigateToRoom(projectKey, town) {
  const t = town || currentTown();
  const enc = encodeURIComponent(projectKey);
  location.hash = (t === 'claude') ? '#room/' + enc : '#town/' + t + '/room/' + enc;
}
// back-btn (마을로) — 현재 마을의 로비로
window.goLobby = () => {
  const t = currentTown();
  location.hash = (t === 'claude') ? '' : '#town/' + t;
};
function renderSignpost(snap) {
  const el = document.getElementById('town-signpost');
  if (!el) return;
  const counts = townCounts(snap || { sessions: [] });
  const cur = currentTown();
  const make = (t, label) => {
    const c = counts[t] || 0;
    const liveDot = c > 0 ? `<span class="signpost-dot" title="${c} 활성"></span>` : '';
    const active = (t === cur) ? ' active' : '';
    return `<button class="signpost-link${active}" data-town="${t}" type="button">
      ${liveDot}<span class="signpost-label">${label}</span>
      <span class="signpost-count">${c}</span>
    </button>`;
  };
  const TOWN_LABELS = { claude: 'Claude town', codex: 'Codex town', cursor: 'Cursor town' };
  // 비어있는 마을 (0 카운트) 은 숨김 — "transit hub" 가 아닌 마을 sign 미감.
  // 단, 현재 진입한 마을은 0 이어도 visible 유지(돌아갈 경로 보존).
  const visibleTowns = VALID_TOWNS.filter(t => (counts[t] || 0) > 0 || t === cur);
  const tabs = visibleTowns
    .map(t => make(t, TOWN_LABELS[t] || t))
    .join('<span class="signpost-sep">·</span>');
  el.innerHTML = `
    <div class="signpost-frame">
      <span class="signpost-arrow signpost-arrow-l">◀</span>
      ${tabs}
      <span class="signpost-arrow signpost-arrow-r">▶</span>
    </div>`;
  el.querySelectorAll('.signpost-link').forEach(btn => {
    btn.addEventListener('click', () => {
      setTown(btn.dataset.town);
    });
  });
  // 좌우 화살표 클릭 — 마을 순환 (claude · codex · cursor)
  const idx = Math.max(0, VALID_TOWNS.indexOf(cur));
  const n = VALID_TOWNS.length;
  el.querySelector('.signpost-arrow-l')?.addEventListener('click',
    () => setTown(VALID_TOWNS[(idx - 1 + n) % n]));
  el.querySelector('.signpost-arrow-r')?.addEventListener('click',
    () => setTown(VALID_TOWNS[(idx + 1) % n]));
}

// ── Preview 모드 ─────────────────────────────────────────────
function renderPreviewPage() {
  const previewRoot = document.querySelector('#root') || document.body;

  const TAG_LIST = ['inspect','code','build','create','chat','explore','plan','wait','celebrate','work'];
  const PET_SPECIES = ['bunny','rabbit','bird','slime','frog','star','blob','pup','cat','mushroom','ghost-puff','fish','dragon-baby'];

  // preview 매트릭스는 sprite 중복이 심함 (12종 × 10태그 = 120 펫 sprite + 같은 prop 가 12회 반복).
  // <symbol>+<use> 로 DOM rect 수를 ~7x 줄여 paint 비용 감소.
  const previewCell = (species, tag) => {
    const tagInfo = ACTIVITY_TAGS.find(t => t.tag === tag);
    const label = tagInfo ? (ACTIVITY_LABELS[tag] || tag) : (ACTIVITY_LABELS[tag] || tag);
    const sprite = renderSpriteRef(species, 3);
    const prop = tagInfo?.prop ? `<div class="prop-wrap prop-${tag}">${renderSpriteRef(tagInfo.prop, 2)}</div>` : '';
    return `
      <div class="character pet pet-busy tag-${tag}" data-pet="${species}">
        <div class="avatar">
          <div class="shadow"></div>
          <div class="sprite-wrap">${sprite}</div>
          ${prop}
        </div>
        <div class="activity-chip"><span class="chip-text">${label}</span></div>
      </div>
    `;
  };

  const humanIdle = `
    <div class="preview-cell">
      <div class="character human-char">
        <div class="avatar">
          <div class="shadow"></div>
          <div class="sprite-wrap human-wrap">${renderSpriteRef('human', 3)}</div>
        </div>
      </div>
      <span>idle</span>
    </div>`;

  const humanWorking = `
    <div class="preview-cell">
      <div class="character human-char working">
        <div class="avatar">
          <div class="shadow"></div>
          <div class="sprite-wrap human-wrap">
            ${renderSpriteRef('human', 3)}
            <div class="prop-wrap prop-laptop">${renderSpriteRef('prop_laptop', 1.4)}</div>
          </div>
        </div>
      </div>
      <span>working (+laptop)</span>
    </div>`;

  const previewCharacter = (species, evolved) => {
    const spriteKey = evolved
      ? species.replace(/-/g, '_') + '_evolved'
      : species;
    const finalKey = SPRITES[spriteKey] ? spriteKey : species;
    return `
      <div class="character pet pet-sleeping${evolved ? ' evolved' : ''}" data-pet="${species}">
        <div class="avatar">
          <div class="shadow"></div>
          <div class="sprite-wrap">${renderSpriteRef(finalKey, 3)}</div>
        </div>
      </div>
    `;
  };

  // 모든 sprite 가 renderSpriteRef 로 등록되도록 먼저 body 부터 빌드 → 그 후 defs 주입.
  const bodyHTML = `
    <div class="preview-page">
      <header class="preview-header">
        <h1>Agentville — 모션 프리뷰</h1>
        <p>모든 펫 종 × 모든 활동 태그 매트릭스. 라이브 데이터 없음.</p>
        <a class="preview-back" href="/">← 메인으로</a>
      </header>
      <section class="preview-humans">
        <h2>Humanoid</h2>
        <div class="preview-row">${humanIdle}${humanWorking}</div>
      </section>
      <section class="preview-pets">
        <h2>Pets × Activities</h2>
        <table class="preview-matrix">
          <thead><tr>
            <th>Species</th>
            ${TAG_LIST.map(t => `<th>${t}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${PET_SPECIES.map(sp => `
              <tr>
                <th>${sp}</th>
                ${TAG_LIST.map(t => `<td>${previewCell(sp, t)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
      <section class="preview-evolved">
        <h2>Evolved Forms (calls ≥ 20)</h2>
        <p class="preview-note">서브에이전트 호출 20회 이상이면 진화. 좌=기본, 우=진화형.</p>
        <div class="preview-evolved-grid">
          ${PET_SPECIES.map(sp => `
            <div class="preview-evolved-row">
              <div class="preview-evolved-label">${sp}</div>
              <div class="preview-evolved-pair">
                <div class="preview-cell">
                  ${previewCharacter(sp, false)}
                  <span>기본</span>
                </div>
                <div class="preview-arrow">→</div>
                <div class="preview-cell">
                  ${previewCharacter(sp, true)}
                  <span>진화</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
  // 모든 renderSpriteRef 호출이 누적된 defs 를 본문 앞에 1회만 주입.
  previewRoot.innerHTML = spriteDefsHTML() + bodyHTML;
}

// /?preview=humans — humanoid 자가 피드백 루프용 large-scale view.
// 두 프레임을 정적으로 동시에 보고, 모든 hair variant 를 한눈에 점검.
// 사용: 브라우저에서 /?preview=humans 또는 node /tmp/agentville-test/shot-humans.js
function renderHumansPreview() {
  const previewRoot = document.querySelector('#root') || document.body;
  const SCALE = 8;
  const HAIRS = ['(none)', 'hair-short', 'hair-long', 'hair-bun', 'hair-spiky', 'hair-ponytail'];
  const HUE_SAMPLES = [
    { name: 'pink',   char: '#d96aa8', dark: '#7a3563', face: '#f0c8a0', hair: '#3a8a55', hairDark: '#1d4a2c' },
    { name: 'teal',   char: '#5fb8a8', dark: '#356e64', face: '#f0c8a0', hair: '#a8674c', hairDark: '#5a3525' },
    { name: 'amber',  char: '#d4924a', dark: '#7a5025', face: '#f0c8a0', hair: '#4a6a8c', hairDark: '#2a3e54' },
  ];
  const humanCell = (hairKey, hue, frameLabel, frameClass) => {
    const styleVars =
      `--char:${hue.char}; --char-dark:${hue.dark}; --face:${hue.face}; ` +
      `--hair:${hue.hair}; --hair-dark:${hue.hairDark};`;
    const sprite = renderSprite('human', SCALE);
    const hairSvg = (hairKey !== '(none)')
      ? renderSprite(hairKey, SCALE).replace('<svg class="', '<svg class="hair ')
      : '';
    return `
      <div class="hpreview-cell ${frameClass}">
        <div class="human-char" style="${styleVars}">
          <div class="sprite-wrap human-wrap">
            ${sprite}${hairSvg}
          </div>
        </div>
        <div class="hpreview-label">${hairKey} · ${hue.name} · ${frameLabel}</div>
      </div>`;
  };
  const rows = HAIRS.map(hk =>
    `<section class="hpreview-row">
      <h3>${hk}</h3>
      <div class="hpreview-grid">
        ${HUE_SAMPLES.map(hue =>
          `${humanCell(hk, hue, 'frame1', 'pin-f1')}${humanCell(hk, hue, 'frame2', 'pin-f2')}`
        ).join('')}
      </div>
    </section>`
  ).join('');
  previewRoot.innerHTML = `
    <style>
      body { background:#2a2a2a; color:#eee; font-family:-apple-system,monospace; padding:20px; }
      h1 { margin:0 0 4px; font-size:18px; }
      .hpreview-note { opacity:.6; font-size:11px; margin-bottom:20px; }
      .hpreview-back { color:#88c; font-size:12px; }
      .hpreview-row { margin-bottom:28px; padding:12px; background:#1f1f1f; border-radius:6px; }
      .hpreview-row h3 { margin:0 0 12px; font-size:13px; opacity:.8; }
      .hpreview-grid { display:grid; grid-template-columns:repeat(6, 1fr); gap:12px; }
      .hpreview-cell { background:#e8d5b8; padding:10px 6px 6px; border-radius:4px; text-align:center; min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; }
      .hpreview-cell .human-char { animation:none !important; }
      .hpreview-cell .sprite-wrap { animation:none !important; }
      /* freeze frames — override the tick-on/tick-off opacity animation */
      .hpreview-cell.pin-f1 .sprite.two-frame .frame-1 { animation:none !important; opacity:1 !important; }
      .hpreview-cell.pin-f1 .sprite.two-frame .frame-2 { animation:none !important; opacity:0 !important; }
      .hpreview-cell.pin-f2 .sprite.two-frame .frame-1 { animation:none !important; opacity:0 !important; }
      .hpreview-cell.pin-f2 .sprite.two-frame .frame-2 { animation:none !important; opacity:1 !important; }
      .hpreview-label { font-size:10px; color:#4a3a25; margin-top:6px; opacity:.7; }
    </style>
    <h1>Humanoid sprite preview — scale ${SCALE}</h1>
    <p class="hpreview-note">두 frame 정적, 모든 hair variant × 3 hue. <a class="hpreview-back" href="/">← 메인</a></p>
    ${rows}
  `;
}

// /?preview=codex — codex 3종 자가 피드백 루프용.
function renderCodexPreview() {
  const previewRoot = document.querySelector('#root') || document.body;
  const SCALE = 8;
  const PETS = ['codex-tui-pet', 'codex-exec-pet', 'codex-vscode-pet'];
  const HUE_SAMPLES = [
    { name: 'red',   char: '#c45f4a', dark: '#7a3525', face: '#f0c8a0' },
    { name: 'amber', char: '#d4924a', dark: '#7a5025', face: '#f0c8a0' },
    { name: 'blue',  char: '#5a8fb8', dark: '#2a4a6e', face: '#f0c8a0' },
  ];
  const petCell = (petKey, hue, frameLabel, frameClass) => {
    const styleVars =
      `--char:${hue.char}; --char-dark:${hue.dark}; --face:${hue.face};`;
    const sprite = renderSprite(petKey, SCALE);
    return `
      <div class="cpreview-cell ${frameClass}">
        <div class="character pet" style="${styleVars}">
          <div class="sprite-wrap">${sprite}</div>
        </div>
        <div class="cpreview-label">${petKey} · ${hue.name} · ${frameLabel}</div>
      </div>`;
  };
  const rows = PETS.map(pk =>
    `<section class="cpreview-row">
      <h3>${pk}</h3>
      <div class="cpreview-grid">
        ${HUE_SAMPLES.map(hue =>
          `${petCell(pk, hue, 'frame1', 'pin-f1')}${petCell(pk, hue, 'frame2', 'pin-f2')}`
        ).join('')}
      </div>
    </section>`
  ).join('');
  previewRoot.innerHTML = `
    <style>
      body { background:#2a2a2a; color:#eee; font-family:-apple-system,monospace; padding:20px; }
      h1 { margin:0 0 4px; font-size:18px; }
      .cpreview-note { opacity:.6; font-size:11px; margin-bottom:20px; }
      .cpreview-back { color:#88c; font-size:12px; }
      .cpreview-row { margin-bottom:28px; padding:12px; background:#1f1f1f; border-radius:6px; }
      .cpreview-row h3 { margin:0 0 12px; font-size:13px; opacity:.8; }
      .cpreview-grid { display:grid; grid-template-columns:repeat(6, 1fr); gap:12px; }
      .cpreview-cell { background:#dfd0bb; padding:10px 6px 6px; border-radius:4px; text-align:center; min-height:200px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; }
      .cpreview-cell .sprite-wrap { animation:none !important; }
      .cpreview-cell.pin-f1 .sprite.two-frame .frame-1 { animation:none !important; opacity:1 !important; }
      .cpreview-cell.pin-f1 .sprite.two-frame .frame-2 { animation:none !important; opacity:0 !important; }
      .cpreview-cell.pin-f2 .sprite.two-frame .frame-1 { animation:none !important; opacity:0 !important; }
      .cpreview-cell.pin-f2 .sprite.two-frame .frame-2 { animation:none !important; opacity:1 !important; }
      .cpreview-label { font-size:10px; color:#4a3a25; margin-top:6px; opacity:.7; }
    </style>
    <h1>Codex pet preview — scale ${SCALE}</h1>
    <p class="cpreview-note">3 codex 종 × 3 hue × 2 frame. <a class="cpreview-back" href="/">← 메인</a></p>
    ${rows}
  `;
}

// 다발성 render 호출을 rAF 로 합치는 throttle wrapper.
// SSE snapshot · 3s interval · 클릭 핸들러 가 빠르게 연쇄될 때
// DOM 풀-재구축이 1프레임당 한 번만 발생하도록 보장.
let _pendingSnap = null;
let _rafScheduled = false;
function render(snap) {
  if (snap) _pendingSnap = snap;
  if (_rafScheduled) return;
  _rafScheduled = true;
  requestAnimationFrame(() => {
    _rafScheduled = false;
    const s = _pendingSnap;
    _pendingSnap = null;
    if (s) _renderImpl(s);
  });
}

function _renderImpl(snap) {
  if (!snap) return;
  // 마을 signpost — body 위에 항상 표시
  renderSignpost(snap);
  // data-town 어트리뷰트로 CSS 가 마을별 톤 분기 가능 (Codex 는 살짝 차가운 톤)
  document.body.dataset.town = currentTown();
  const grouped = groupByProject(snap);
  const totals = Object.values(grouped).flat().reduce((acc, s) => {
    for (const p of (s.pets || [])) {
      if (p.state === 'busy') acc.busy++;
      else if (p.state === 'hurt') acc.hurt++;
      else if (p.state === 'stuck') acc.stuck++;
      else acc.sleeping++;
    }
    return acc;
  }, { busy: 0, hurt: 0, stuck: 0, sleeping: 0 });
  const updated = snap.generated_at ? new Date(snap.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const sessionCount = Object.values(grouped).flat().length;
  const parts = [
    `${Object.keys(grouped).length}개 프로젝트`,
    `${sessionCount}개 세션`,
    `${totals.busy} 일하는 중`,
    `${totals.sleeping} 자는 중`,
  ];
  if (totals.hurt) parts.push(`${totals.hurt} 실패`);
  if (totals.stuck) parts.push(`${totals.stuck} 응답없음`);
  parts.push(updated);
  summary.textContent = parts.join(' · ');

  const room = currentRoom();
  const view = room ? renderRoom(snap, room) : renderLobby(snap);
  root.innerHTML = view + detailHTML(snap);
  mountIcons();

  // 화이트보드 초기 텍스트
  if (room) rotateBoards();

  // 방 안에서 드래그-앤-드롭 활성화
  if (room) {
    const sceneEl = root.querySelector('.scene');
    if (sceneEl) attachSceneDrag(sceneEl, room);
  }

  // 로비 검색창 / 필터 버튼
  const _searchInput = root.querySelector('#lobby-search');
  if (_searchInput) {
    _searchInput.addEventListener('input', (e) => {
      lobbySearchQuery = e.target.value;
      render(lastSnap);
    });
  }
  const _filterBtn = root.querySelector('#lobby-filter-btn');
  if (_filterBtn) {
    _filterBtn.addEventListener('click', () => {
      lobbyFilterActive = !lobbyFilterActive;
      render(lastSnap);
    });
  }

  root.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      navigateToRoom(card.dataset.key);
    });
  });
  // 펫 클릭 → 상세 패널.
  root.querySelectorAll('.pet[data-pet]').forEach(node => {
    // in-scene 모드에선 data-sid 가 펫 노드에 직접, 로비 미니에선 부모 카드 무시.
    const sid = node.dataset.sid || node.closest('[data-sid]')?.dataset.sid;
    if (!sid) return;
    node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openDetail = `${sid}::${node.dataset.pet}`;
      render(lastSnap);
    });
  });
  // humanoid 클릭 → 세션 정보 패널 (primary + secondary 모두)
  root.querySelectorAll('.human-char[data-sid]').forEach(node => {
    const sid = node.dataset.sid;
    if (!sid) return;
    node.style.cursor = 'pointer';
    node.addEventListener('click', (ev) => {
      // 드래그가 발생했으면 클릭으로 처리 안 함 (attachSceneDrag 가 처리)
      if (node.dataset.dragging === '1') {
        delete node.dataset.dragging;
        return;
      }
      ev.stopPropagation();
      openDetail = `${sid}::__session__`;
      render(lastSnap);
    });
  });
}

// ── SSE 연결 ────────────────────────────────────────────────────
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (ev) => {
    conn.classList.remove('bad');
    try {
      lastSnap = JSON.parse(ev.data);
      render(lastSnap);
    } catch (e) { console.error('parse error', e); }
  });
  es.addEventListener('ping', () => conn.classList.remove('bad'));
  es.onerror = () => {
    conn.classList.add('bad');
    summary.textContent = '연결 끊김 — 재시도 중…';
    es.close();
    setTimeout(connect, 2000);
  };
}

window.addEventListener('hashchange', () => { openDetail = null; render(lastSnap); });

// ── 키보드 단축키 ────────────────────────────────────────────────
// / → 검색창 포커스 · f → 필터 토글 · Esc → expanded 패널 닫기
// input/textarea 포커스 중엔 Esc 외 단축키 무시
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const inInput = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;

  if (e.key === 'Escape') {
    if (openDetail) { openDetail = null; render(lastSnap); return; }
    if (settingsOpen) { window.closeSettings?.(); return; }
    if (lobbySearchQuery) { lobbySearchQuery = ''; render(lastSnap); return; }
    return;
  }

  if (inInput) return;

  if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const searchEl = document.getElementById('lobby-search');
    if (searchEl) searchEl.focus();
    return;
  }

  if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !currentRoom()) {
    lobbyFilterActive = !lobbyFilterActive;
    render(lastSnap);
    return;
  }
});

// 시간 기반 필터(30초 잔잔, 1시간 윈도우)가 자연스럽게 사라지게 하려면
// 데이터 변경이 없어도 주기적으로 다시 그려야 함.
mountIcons(); // 정적 header chrome (brand-house, cog) 초기 마운트

// ── Day/Night 초기 적용 + 10분마다 갱신 ──────────────────────────
applyTimeOfDay();
setInterval(applyTimeOfDay, 10 * 60 * 1000);

// ── Claude 토큰 사용량 헤더 표시 ─────────────────────────────────
(function initUsageBar() {
  const el = document.getElementById('usage-bar');
  if (!el) return;

  function pctClass(pct) {
    if (pct >= 80) return 'bad';
    if (pct >= 50) return 'warn';
    return 'ok';
  }

  function fmtCountdown(secs) {
    if (!secs || secs <= 0) return '';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function fmtBar(pct, cls) {
    const clamped = Math.min(100, Math.max(0, pct));
    return `<span class="usage-bar-track"><span class="usage-bar-fill ${cls}" style="width:${clamped}%"></span></span>`;
  }

  function fmtPct(p) {
    // 둘째 자리까지 올림 표시 (e.g. 46.001 → 46.01, 6 → 6.00, 100 → 100.00)
    return (Math.ceil(p * 100) / 100).toFixed(2);
  }

  function fmtSegment(label, window) {
    if (!window) return '';
    const pct = window.used_percentage;
    const cls = pctClass(pct);
    const countdown = (pct >= 50 && window.seconds_until_reset)
      ? ` <span class="usage-countdown ${cls}">(${fmtCountdown(window.seconds_until_reset)})</span>`
      : '';
    return `<span class="usage-seg-row"><span class="usage-seg-label">${label}</span>${fmtBar(pct, cls)}<span class="usage-segment ${cls}">${fmtPct(pct)}%</span>${countdown}</span>`;
  }

  function toolGroup(label, src) {
    if (!src || src.stale) return { html: '', worst: 0 };
    const fh = fmtSegment('5h', src.five_hour);
    const sd = fmtSegment('7d', src.seven_day);
    if (!fh && !sd) return { html: '', worst: 0 };
    const worst = Math.max(
      src.five_hour ? src.five_hour.used_percentage : 0,
      src.seven_day ? src.seven_day.used_percentage : 0
    );
    const inner = `<span class="usage-tool">${label}</span>` + [fh, sd].filter(Boolean).join('');
    return { html: `<span class="usage-tool-group">${inner}</span>`, worst };
  }

  // Cursor 사용량은 rate-limit % 가 아니라 활동량(24h 요청수·라인변경) — 별도 렌더.
  function cursorGroup(src) {
    if (!src) return { html: '', worst: 0 };
    const req = src.requests_24h || 0;
    const lines = (src.lines_24h && src.lines_24h.total_changed) || 0;
    if (!req && !lines) return { html: '', worst: 0 };
    const inner = `<span class="usage-tool">Cursor</span>`
      + `<span class="usage-seg-row"><span class="usage-seg-label">24h</span>`
      + `<span class="usage-segment ok">${req} req · +${lines} lines</span></span>`;
    return { html: `<span class="usage-tool-group">${inner}</span>`, worst: 0 };
  }

  let _lastUsageData = null;

  function renderUsage(data) {
    if (data) _lastUsageData = data;
    const d = _lastUsageData;
    if (!d) { el.hidden = true; el.removeAttribute('data-severity'); return; }
    const town = (typeof currentTown === 'function') ? currentTown() : 'claude';
    const claude = (town === 'claude') ? toolGroup('Claude', d.claude) : { html: '', worst: 0 };
    const codex  = (town === 'codex')  ? toolGroup('Codex',  d.codex)  : { html: '', worst: 0 };
    // Cursor 의 compact 24h activity 는 항상 표시 — rate-limit bar 가 아니므로
    // 다른 마을에 있어도 ambient 로 표시 가능 (cursorGroup 자체가 데이터 없으면 빈 html).
    const cursor = cursorGroup(d.cursor);
    if (!claude.html && !codex.html && !cursor.html) {
      el.hidden = true;
      el.removeAttribute('data-severity');
      return;
    }
    el.dataset.severity = pctClass(Math.max(claude.worst, codex.worst, cursor.worst));
    el.innerHTML = '<span class="usage-lightning">⚡</span>' + [claude.html, codex.html, cursor.html].filter(Boolean).join('');
    el.hidden = false;
  }

  function fetchUsage() {
    fetch('/api/usage')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) renderUsage(d); })
      .catch(() => {});
  }

  window.addEventListener('hashchange', () => renderUsage(null));

  fetchUsage();
  setInterval(fetchUsage, 30 * 1000);
})();

// ── 펫 이름 편집 (더블클릭) + 즐겨찾기 토글 — 이벤트 위임 ──────────
document.body.addEventListener('dblclick', (e) => {
  const lbl = e.target.closest('.char-label');
  if (!lbl) return;
  const type = lbl.dataset.petType;
  if (!type) return;
  const current = getPetDisplay(type);
  const next = prompt('펫 이름 (비우면 기본값)', current);
  if (next === null) return;
  setPetName(type, next);
  if (lastSnap) render(lastSnap);
});
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('.fav-toggle');
  if (!btn) return;
  e.stopPropagation();
  togglePetFav(btn.dataset.petType);
  if (lastSnap) render(lastSnap);
});

// preview 모드 — URL 쿼리 감지 후 early return (SSE/lobby 코드 미실행)
const _previewMode = new URLSearchParams(window.location.search).get('preview');
if (_previewMode === 'motions') {
  renderPreviewPage();
} else if (_previewMode === 'humans') {
  renderHumansPreview();
} else if (_previewMode === 'codex') {
  renderCodexPreview();
} else {
  setInterval(() => { if (lastSnap) render(lastSnap); }, 3000);
  connect();
}
