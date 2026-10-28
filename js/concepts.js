/* ==========================================================
   임용쏙 — 📚 개념노트
   푼 문제의 핵심 키포인트·해설·이론 정리를 주제별로 누적
   (같은 주제가 여러 번 나오면 하나로 병합)
   ========================================================== */

const CONCEPTS_KEY = 'imyongssok_concepts_v1';
const MAX_CONCEPTS = 400;        // 주제 수 상한
const MAX_KEYPOINTS = 24;        // 주제당 키포인트 상한
const MAX_EXPLANATIONS = 4;      // 주제당 보관 해설 수

// 개념노트 화면 상태 (app.js의 S와 분리)
const CS = { q: '', filter: 'all', sort: 'recent' };

/* ---------- 저장소 ---------- */
function getConcepts() {
  try { return JSON.parse(localStorage.getItem(CONCEPTS_KEY)) || []; } catch (e) { return []; }
}

// 용량 초과 시 오래된 주제부터 버리고 재시도
function putConcepts(arr) {
  arr.sort((a, b) => (b.lastT || b.t) - (a.lastT || a.t));
  let list = arr.slice(0, MAX_CONCEPTS);
  for (let i = 0; i < 6; i++) {
    try { localStorage.setItem(CONCEPTS_KEY, JSON.stringify(list)); return true; }
    catch (e) {
      if (list.length <= 5) { console.warn('개념노트 저장 실패(용량)', e); return false; }
      list = list.slice(0, Math.floor(list.length * 0.7));
    }
  }
  return false;
}

// 키포인트·실수 문구 중복 제거용 정규화
function normLine(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s.,·()'"“”‘’\-–—]/g, '');
}
function mergeLines(oldArr, newArr, cap) {
  const out = Array.isArray(oldArr) ? oldArr.slice() : [];
  const seen = new Set(out.map(normLine));
  (newArr || []).forEach(x => {
    const t = String(x == null ? '' : x).trim();
    if (!t) return;
    const n = normLine(t);
    if (n && !seen.has(n)) { seen.add(n); out.push(t); }
  });
  return out.slice(0, cap);
}

function conceptKey(q) { return (q.areaId || q.areaName || '?') + '|' + (q.topic || '?'); }

/* ---------- 문항 → 개념노트 저장(병합) ---------- */
// g: 채점 결과(없으면 null). 반환: 해당 주제 엔트리
function saveConceptFromQuestion(q, g) {
  if (!q) return null;
  const arr = getConcepts();
  const key = conceptKey(q);
  let e = arr.find(x => x.key === key);
  const now = Date.now();

  if (!e) {
    e = {
      id: now + '_' + Math.random().toString(36).slice(2, 7),
      key, t: now, lastT: now,
      subject: q.subject || '', areaName: q.areaName || '', areaId: q.areaId || '',
      topic: q.topic || '', qtypeId: q.qtypeId || '',
      keyPoints: [], commonMistakes: [], explanations: [], trend: '',
      runs: [], theory: null,
    };
    arr.push(e);
  }

  e.lastT = now;
  e.keyPoints = mergeLines(e.keyPoints, q.keyPoints, MAX_KEYPOINTS);
  e.commonMistakes = mergeLines(e.commonMistakes, q.commonMistakes, 12);
  if (q.trend) e.trend = q.trend;

  // 해설은 회차별로 보관 (같은 주제를 다른 각도로 설명한 것이 복습에 쓸모 있음)
  if (q.explanation) {
    const n = normLine(q.explanation).slice(0, 120);
    if (!e.explanations.some(x => normLine(x.text).slice(0, 120) === n)) {
      e.explanations.unshift({
        t: now,
        text: q.explanation,
        question: String(q.question || '').slice(0, 300),
        type: q.type || '',
      });
      e.explanations = e.explanations.slice(0, MAX_EXPLANATIONS);
    }
  }

  e.runs.unshift({
    t: now,
    score: g && typeof g.score === 'number' ? g.score : null,
    max: g ? g.max : (q.points || null),
  });
  e.runs = e.runs.slice(0, 20);

  putConcepts(arr);
  return e;
}

// AI 이론 정리를 해당 주제에 붙임 (엔트리가 없으면 먼저 만듦)
function attachTheory(q, theory) {
  if (!q || !theory) return;
  const arr = getConcepts();
  const key = conceptKey(q);
  if (!arr.some(x => x.key === key)) {
    saveConceptFromQuestion(q, null);
    return attachTheory(q, theory);
  }
  const list = getConcepts();
  const e = list.find(x => x.key === key);
  e.theory = theory;
  e.theoryT = Date.now();
  e.lastT = Date.now();
  putConcepts(list);
}

function hasTheoryFor(q) {
  if (!q) return null;
  const e = getConcepts().find(x => x.key === conceptKey(q));
  return e && e.theory ? e.theory : null;
}

function deleteConcept(id) {
  if (!confirm('이 주제의 개념 정리를 삭제할까요?')) return;
  putConcepts(getConcepts().filter(x => x.id !== id));
  renderConcepts();
}

function resetConcepts() {
  if (!confirm('개념노트를 모두 삭제할까요? (되돌릴 수 없습니다)')) return;
  localStorage.removeItem(CONCEPTS_KEY);
  renderConcepts();
}

/* ---------- 이론 정리 HTML (결과 화면·개념노트 공용) ---------- */
function conceptTheoryHtml(th, opts) {
  if (!th) return '';
  const small = opts && opts.small;
  let h = `<div class="theory ${small ? 'theory-sm' : ''}">`;
  h += `<div class="th-head"><span class="th-badge">📘 이론 정리</span>
    <span class="th-concept">${esc(th.concept || '')}</span></div>`;
  if (th.oneLine) h += `<div class="th-oneline">${esc(th.oneLine)}</div>`;
  if (th.definition) h += `<div class="th-sec"><div class="th-t">개념 정의</div><p>${nl2br(th.definition)}</p></div>`;
  if (th.scholars) h += `<div class="th-sec"><div class="th-t">학자 · 이론적 배경</div><p>${nl2br(th.scholars)}</p></div>`;

  if (Array.isArray(th.elements) && th.elements.length) {
    h += `<div class="th-sec"><div class="th-t">구성 요소 · 유형</div><ul class="th-list">` +
      th.elements.map(x => `<li><b>${esc(x.name || '')}</b>${x.desc ? ' — ' + esc(x.desc) : ''}</li>`).join('') +
      `</ul></div>`;
  }
  if (Array.isArray(th.compare) && th.compare.length) {
    h += `<div class="th-sec"><div class="th-t">⚠️ 혼동하기 쉬운 개념</div>
      <table class="rubric th-table"><thead><tr><th>개념</th><th>무엇이 다른가</th></tr></thead><tbody>` +
      th.compare.map(x => `<tr><td><b>${esc(x.term || '')}</b></td><td>${esc(x.diff || '')}</td></tr>`).join('') +
      `</tbody></table></div>`;
  }
  if (Array.isArray(th.related) && th.related.length) {
    h += `<div class="th-sec"><div class="th-t">🔗 함께 알아야 할 이론</div><ul class="th-list">` +
      th.related.map(x => `<li><b>${esc(x.name || '')}</b>${x.why ? ' — ' + esc(x.why) : ''}</li>`).join('') +
      `</ul></div>`;
  }
  if (th.examPoint) h += `<div class="th-sec th-exam"><div class="th-t">🎯 임용 출제 포인트</div><p>${nl2br(th.examPoint)}</p></div>`;
  if (Array.isArray(th.memorize) && th.memorize.length) {
    h += `<div class="th-sec th-memo"><div class="th-t">🧠 시험장 암기 문장</div><ul class="th-list">` +
      th.memorize.map(m => `<li>${esc(m)}</li>`).join('') + `</ul></div>`;
  }
  h += `</div>`;
  return h;
}

/* ---------- 개념노트 화면 ---------- */
// ⚠️ 검색·필터 변경 시 목록만 다시 그린다.
// 검색 입력창을 다시 그리면 한글 IME 조합이 끊겨 글자 순서가 뒤집힌다.
function setConceptSearch(v) { CS.q = v; renderConceptList(); }
function setConceptFilter(v) { CS.filter = v; renderConceptList(); }
function setConceptSort(v) { CS.sort = v; renderConceptList(); }

function conceptMatches(e, qstr) {
  if (!qstr) return true;
  const hay = [
    e.topic, e.areaName, e.subject, e.trend,
    (e.keyPoints || []).join(' '),
    (e.commonMistakes || []).join(' '),
    (e.explanations || []).map(x => x.text).join(' '),
    e.theory ? [e.theory.concept, e.theory.oneLine, e.theory.definition, e.theory.scholars,
      (e.theory.elements || []).map(x => x.name + ' ' + x.desc).join(' '),
      (e.theory.compare || []).map(x => x.term + ' ' + x.diff).join(' '),
      (e.theory.related || []).map(x => x.name + ' ' + x.why).join(' '),
      e.theory.examPoint, (e.theory.memorize || []).join(' ')].join(' ') : '',
  ].join(' ').toLowerCase();
  return qstr.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.indexOf(w) >= 0);
}

function shownConcepts() {
  const all = getConcepts();
  return all.filter(e => (CS.filter === 'all' || e.subject === CS.filter) && conceptMatches(e, CS.q));
}

function renderConcepts() {
  const el = $('conceptsBody');
  if (!el) return;
  const all = getConcepts();

  if (!all.length) {
    el.innerHTML = `<div class="card"><div class="empty">개념노트가 비어 있습니다.<br>
      문제를 풀고 <b>채점</b>하면 그 문항의 <b>핵심 키포인트·해설</b>이 주제별로 자동 정리됩니다. 📚<br>
      결과 화면의 <b>「📘 이론 정리」</b>를 누르면 개념 정의·학자·혼동 개념 비교까지 함께 쌓입니다.</div></div>`;
    return;
  }

  const subjects = [];
  all.forEach(e => { if (e.subject && subjects.indexOf(e.subject) < 0) subjects.push(e.subject); });

  el.innerHTML = `<div class="card cn-toolbar">
    <div class="cn-row">
      <input type="search" id="cnSearch" class="cn-search" placeholder="🔍 주제·키포인트·해설 내용 검색"
             value="${esc(CS.q)}" oninput="setConceptSearch(this.value)" autocomplete="off">
      ${subjects.length > 1 ? `<select onchange="setConceptFilter(this.value)">
        <option value="all">전체 과목</option>
        ${subjects.map(s => `<option value="${esc(s)}" ${CS.filter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select>` : ''}
      <select onchange="setConceptSort(this.value)">
        <option value="recent" ${CS.sort === 'recent' ? 'selected' : ''}>최근 학습순</option>
        <option value="most" ${CS.sort === 'most' ? 'selected' : ''}>많이 푼 순</option>
        <option value="topic" ${CS.sort === 'topic' ? 'selected' : ''}>주제 이름순</option>
      </select>
    </div>
    <div class="cn-row cn-row2">
      <span class="cn-stat" id="cnStat"></span>
      <button class="btn-secondary" onclick="printConcepts()">🖨️ 인쇄 · PDF 저장</button>
      <button class="btn-ghost danger" onclick="resetConcepts()">🗑️ 전체 삭제</button>
    </div>
  </div>
  <div id="cnList"></div>`;

  renderConceptList();
}

// 목록 + 개수 줄만 갱신 (검색창은 건드리지 않음 — 한글 IME 보호)
function renderConceptList() {
  const list = $('cnList');
  if (!list) return;
  const all = getConcepts();
  const shown = shownConcepts();
  const theoryCnt = all.filter(e => e.theory).length;

  const stat = $('cnStat');
  if (stat) {
    stat.innerHTML = `주제 <b>${all.length}</b>개 · 이론 정리 <b>${theoryCnt}</b>개` +
      (CS.q || CS.filter !== 'all' ? ` · 검색 결과 <b>${shown.length}</b>개` : '');
  }

  if (!shown.length) {
    list.innerHTML = `<div class="card"><div class="empty">검색 결과가 없습니다.</div></div>`;
    return;
  }

  // 영역별 묶기 — 최근 학습한 영역이 위로
  const groups = {};
  shown.forEach(e => { (groups[e.areaName || '기타'] = groups[e.areaName || '기타'] || []).push(e); });
  const order = Object.keys(groups).sort((a, b) => {
    const la = Math.max.apply(null, groups[a].map(x => x.lastT || x.t));
    const lb = Math.max.apply(null, groups[b].map(x => x.lastT || x.t));
    return lb - la;
  });

  let html = '';
  order.forEach(area => {
    const items = groups[area].slice();
    if (CS.sort === 'most') items.sort((a, b) => (b.runs || []).length - (a.runs || []).length);
    else if (CS.sort === 'topic') items.sort((a, b) => String(a.topic).localeCompare(String(b.topic), 'ko'));
    else items.sort((a, b) => (b.lastT || b.t) - (a.lastT || a.t));

    html += `<div class="cn-group">
      <div class="cn-group-head">${esc(area)} <span class="cn-group-cnt">${items.length}주제</span></div>` +
      items.map(conceptItemHtml).join('') + `</div>`;
  });
  list.innerHTML = html;
}

function conceptItemHtml(e) {
  const d = new Date(e.lastT || e.t);
  const date = `${d.getMonth() + 1}.${d.getDate()}`;
  const runs = (e.runs || []).filter(r => typeof r.score === 'number');
  const sumS = runs.reduce((a, r) => a + r.score, 0);
  const sumM = runs.reduce((a, r) => a + (r.max || 0), 0);
  const pct = sumM ? Math.round(sumS / sumM * 100) : null;

  let h = `<div class="note-item cn-item">
    <div class="note-head" onclick="this.closest('.cn-item').classList.toggle('open')">
      ${e.theory ? '<span class="badge b-theory">📘 이론</span>' : ''}
      <span class="note-topic">${esc(e.topic)}</span>
      <span class="cn-meta">${(e.runs || []).length}회${pct !== null ? ` · ${pct}%` : ''}</span>
      <span class="note-date" title="마지막 학습일">📅 ${date}</span>
      <span class="note-arrow">▾</span>
    </div>
    <div class="note-detail">`;

  if ((e.keyPoints || []).length) {
    h += `<div class="sec box-key"><div class="sec-title">💡 핵심 키포인트 ${e.keyPoints.length}개</div><ul>` +
      e.keyPoints.map(k => `<li>${esc(k)}</li>`).join('') + `</ul></div>`;
  }
  if (e.theory) h += `<div class="sec">${conceptTheoryHtml(e.theory, { small: true })}</div>`;

  if ((e.explanations || []).length) {
    h += `<div class="sec"><div class="sec-title">📖 해설 ${e.explanations.length}개</div>`;
    h += e.explanations.map(x => {
      const dd = new Date(x.t);
      return `<div class="cn-exp"><div class="cn-exp-top">${esc(x.type || '')} · ${dd.getMonth() + 1}.${dd.getDate()}</div>
        ${x.question ? `<div class="cn-exp-q">${nl2br(x.question)}</div>` : ''}
        <p>${nl2br(x.text)}</p></div>`;
    }).join('');
    h += `</div>`;
  }
  if ((e.commonMistakes || []).length) {
    h += `<div class="sec box-mistake"><div class="sec-title">⚠️ 자주 하는 실수</div><ul>` +
      e.commonMistakes.map(m => `<li>${esc(m)}</li>`).join('') + `</ul></div>`;
  }
  if (e.trend) h += `<div class="sec"><div class="sec-title">📅 기출 연계 경향</div><p>${nl2br(e.trend)}</p></div>`;

  h += `<div class="note-actions">
      <button class="btn-mini" onclick="retryConceptTopic('${e.id}')">🎲 이 주제 문제 풀기</button>
      <button class="btn-mini" onclick="printConcepts('${e.id}')">🖨️ 이 주제만 인쇄</button>
      <button class="btn-mini danger" onclick="deleteConcept('${e.id}')">🗑️ 삭제</button>
    </div></div></div>`;
  return h;
}

// 과목 이름 → 출제 과목 id
function subjectIdOf(name) {
  if (name === '교육학') return 'edu';
  if (name && name.indexOf('사서') >= 0) return 'lib';
  return 'home';
}

function retryConceptTopic(id) {
  const e = getConcepts().find(x => x.id === id);
  if (!e) return;
  switchTab('solve');
  onGenerate({ subject: subjectIdOf(e.subject), qtypeId: e.qtypeId, areaId: e.areaId, topic: e.topic });
}

/* ---------- 인쇄 ---------- */
function buildConceptSheet(e) {
  let h = `<div class="csheet">`;
  h += `<div class="ps-tag">${esc(e.subject)} · ${esc(e.areaName)}</div>`;
  h += `<div class="cs-topic">${esc(e.topic)}</div>`;
  if ((e.keyPoints || []).length) {
    h += `<div class="ps-sec"><b>💡 핵심 키포인트</b><ul>${e.keyPoints.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>`;
  }
  const th = e.theory;
  if (th) {
    h += `<div class="ps-sec ps-ans"><b>📘 이론 정리 — ${esc(th.concept || '')}</b>`;
    if (th.oneLine) h += `<div><i>${esc(th.oneLine)}</i></div>`;
    if (th.definition) h += `<div>${nl2br(th.definition)}</div>`;
    if (th.scholars) h += `<div>· 학자·배경: ${nl2br(th.scholars)}</div>`;
    h += `</div>`;
    if ((th.elements || []).length) {
      h += `<div class="ps-sec"><b>구성 요소 · 유형</b><ul>` +
        th.elements.map(x => `<li><b>${esc(x.name || '')}</b>${x.desc ? ' — ' + esc(x.desc) : ''}</li>`).join('') + `</ul></div>`;
    }
    if ((th.compare || []).length) {
      h += `<div class="ps-sec"><b>⚠️ 혼동하기 쉬운 개념</b><ul>` +
        th.compare.map(x => `<li><b>${esc(x.term || '')}</b> — ${esc(x.diff || '')}</li>`).join('') + `</ul></div>`;
    }
    if ((th.related || []).length) {
      h += `<div class="ps-sec"><b>🔗 함께 알아야 할 이론</b><ul>` +
        th.related.map(x => `<li><b>${esc(x.name || '')}</b>${x.why ? ' — ' + esc(x.why) : ''}</li>`).join('') + `</ul></div>`;
    }
    if (th.examPoint) h += `<div class="ps-sec"><b>🎯 임용 출제 포인트</b><div>${nl2br(th.examPoint)}</div></div>`;
    if ((th.memorize || []).length) {
      h += `<div class="ps-sec"><b>🧠 시험장 암기 문장</b><ul>${th.memorize.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
    }
  }
  if ((e.explanations || []).length) {
    h += `<div class="ps-sec"><b>📖 해설</b>` +
      e.explanations.map(x => `<div class="cs-exp">${nl2br(x.text)}</div>`).join('') + `</div>`;
  }
  if ((e.commonMistakes || []).length) {
    h += `<div class="ps-sec"><b>⚠️ 자주 하는 실수</b><ul>${e.commonMistakes.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  }
  if (e.trend) h += `<div class="ps-sec"><b>📅 기출 연계 경향</b><div>${nl2br(e.trend)}</div></div>`;
  h += `</div>`;
  return h;
}

// id를 주면 그 주제만, 없으면 현재 화면에 보이는 전체
function printConcepts(id) {
  let sel;
  if (id) {
    const e = getConcepts().find(x => x.id === id);
    if (!e) return;
    sel = [e];
  } else {
    sel = shownConcepts();
    if (!sel.length) { alert('인쇄할 주제가 없습니다.'); return; }
    if (CS.sort === 'topic') sel.sort((a, b) => String(a.topic).localeCompare(String(b.topic), 'ko'));
    else sel.sort((a, b) => String(a.areaName).localeCompare(String(b.areaName), 'ko') || (b.lastT || b.t) - (a.lastT || a.t));
  }
  const body = sel.map(buildConceptSheet).join('');
  doPrint(`<div class="ps-count">개념 정리 ${sel.length}주제${CS.q ? ` · 검색어 "${esc(CS.q)}"` : ''}</div>` + body, '개념노트');
}
