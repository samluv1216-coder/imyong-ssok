/* ==========================================================
   임용쏙 — 메인 UI 로직
   ========================================================== */

const STATS_KEY = 'imyongssok_stats_v1';
const NOTES_KEY = 'imyongssok_notes_v1';
const RECENT_KEY = 'imyongssok_recent_v1';

const S = {
  q: null,            // 현재 문항
  phase: 'idle',      // idle | generating | answering | grading | done
  startTime: 0,
  timerInt: null,
};

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = s => esc(s).replace(/\n/g, '<br>');

/* ---------- 탭 ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'stats') renderStats();
  if (name === 'notes') renderNotes();
  if (name === 'concepts') renderConcepts();
  if (name === 'trends') renderTrends();
}

/* ---------- 선택 컨트롤 ---------- */
function populateSelectors() {
  const subj = $('selSubject').value;
  const selType = $('selType');
  const selArea = $('selArea');

  const isMix = subj.indexOf('mix') === 0; // mix-home | mix-lib
  const major = subj === 'lib' || subj === 'mix-lib' ? 'lib'
    : subj === 'edu' ? 'edu' : 'home';

  // 유형
  let typeOpts;
  if (subj === 'edu') {
    typeOpts = [['discourse', '논술형 · 20점 (실전)'], ['essay', '서술형 · 4점 (개념 연습)']];
  } else if (isMix) {
    typeOpts = [['random', '🎲 랜덤 (전공+교육학)']];
  } else { // home | lib (전공 단독)
    typeOpts = [['random', '🎲 랜덤 (기입형+서술형)'], ['short', '기입형 · 2점'], ['essay', '서술형 · 4점']];
  }
  selType.innerHTML = typeOpts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

  // 영역
  if (isMix) {
    selArea.innerHTML = '<option value="random">🎲 자동 (전 영역)</option>';
    selArea.disabled = true;
  } else {
    const pool = poolFor(major);
    selArea.innerHTML = '<option value="random">🎲 랜덤 영역</option>' +
      pool.map(a => `<option value="${a.id}">${a.icon} ${a.name}</option>`).join('');
    selArea.disabled = false;
  }
}

/* ---------- 최근 출제 주제 (중복 회피) ---------- */
function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } }
function pushRecent(topic) {
  const r = getRecent(); r.unshift(topic);
  localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 20)));
}

/* ---------- 문제 출제 ---------- */
async function onGenerate(fixedOpt) {
  if (S.phase === 'generating' || S.phase === 'grading') return;
  if (!hasKey()) { showError(humanizeError(new Error('NOKEY'))); openSettings(); return; }

  // 출제 옵션 결정
  let subject, qtypeId, areaId, topic;
  if (fixedOpt) {
    ({ subject, qtypeId, areaId, topic } = fixedOpt);
  } else {
    subject = $('selSubject').value;
    qtypeId = $('selType').value;
    areaId = $('selArea').value;
  }

  // 전공+교육학 랜덤: 실제 시험 비중 근사 (전공 85% / 교육학 15%)
  if (subject === 'mix-home') {
    subject = Math.random() < 0.85 ? 'home' : 'edu';
    areaId = 'random';
  } else if (subject === 'mix-lib') {
    subject = Math.random() < 0.85 ? 'lib' : 'edu';
    areaId = 'random';
  }
  if (qtypeId === 'random' || !qtypeId) {
    if (subject === 'edu') qtypeId = 'discourse';
    else qtypeId = Math.random() < 0.35 ? 'short' : 'essay';
  }
  if (subject === 'edu' && qtypeId === 'short') qtypeId = 'essay';

  const pool = poolFor(subject);
  const area = (areaId && areaId !== 'random') ? findArea(subject, areaId) : randomPick(pool);
  if (!topic) {
    const recent = getRecent();
    const fresh = area.topics.filter(t => !recent.includes(t));
    topic = randomPick(fresh.length ? fresh : area.topics);
  }
  const qtype = QTYPES[qtypeId];
  const subjectName = subject === 'edu' ? '교육학' : subject === 'lib' ? '문헌정보학(사서)' : '가정 전공';

  // UI 초기화
  S.phase = 'generating';
  stopTimer();
  $('cardQuestion').classList.add('hidden');
  $('cardResult').classList.add('hidden');
  hideError();
  setBusy(`🎲 ${subjectName} · ${area.name} — ${qtype.name} 문제 출제 중...`);

  // 최신 교육 동향을 출제 맥락으로 반영: 교육학, 가정과 교육론, 정책·디지털 연계 사서 영역
  let trendsBlock = '';
  const stg = getSettings();
  const trendAreas = ['edu', 'infoliteracy', 'schoollib'];
  if (stg.useTrends && (subject === 'edu' || trendAreas.indexOf(area.id) >= 0)) {
    trendsBlock = trendsPromptBlock();
  }

  try {
    const genOpt = { subject, subjectName, qtype, area, topic, avoid: getRecent().slice(0, 8), trendsBlock };
    let q;
    try {
      q = await generateQuestion(genOpt);
    } catch (e1) {
      // 응답이 길어 잘려 파싱 실패한 경우 1회 자동 재시도
      if (String(e1 && e1.message).indexOf('JSONPARSE') >= 0) {
        setBusy('⏳ 문제가 길어 다시 출제하는 중... (자동 재시도)');
        q = await generateQuestion(genOpt);
      } else { throw e1; }
    }
    const st = getSettings();
    if (st.verify) {
      setBusy('🔍 검토위원이 문제 오류를 점검하는 중... (2단계 검증)');
      try { q = await verifyQuestion(q); } catch (e) { console.warn('검증 실패, 원본 사용', e); }
    }
    S.q = q;
    pushRecent(topic);
    renderQuestion(q);
    S.phase = 'answering';
  } catch (e) {
    console.error(e);
    S.phase = 'idle';
    showError(humanizeError(e));
  } finally {
    setBusy(null);
  }
}

/* ---------- 문항 렌더 ---------- */
function renderQuestion(q) {
  const qt = QTYPES[q.qtypeId] || QTYPES.essay;
  $('qBadges').innerHTML = [
    `<span class="badge b-subject">${esc(q.subject)}</span>`,
    `<span class="badge b-area">${esc(q.areaName)}</span>`,
    `<span class="badge b-type">${esc(q.type || qt.name)}</span>`,
    `<span class="badge b-points">${q.points}점</span>`,
    `<span class="badge b-time">권장 ${qt.minutes}분</span>`,
    q._verified ? `<span class="badge b-verified" title="검토위원 AI가 오류를 점검한 문항입니다">✅ 검증 완료</span>` : '',
  ].join('');

  $('qStimulus').innerHTML = q.stimulus ? `<div class="stimulus-label">〈 자 료 〉</div>${nl2br(q.stimulus)}` : '';
  $('qStimulus').classList.toggle('hidden', !q.stimulus);
  $('qText').innerHTML = nl2br(q.question);

  const conds = q.conditions || [];
  if (conds.length) {
    $('qConditions').innerHTML = `<div class="cond-title">&lt;작성 방법&gt;</div><ul>` +
      conds.map(c => `<li>${esc(c)}</li>`).join('') + '</ul>';
    $('qConditions').classList.remove('hidden');
  } else {
    $('qConditions').classList.add('hidden');
  }

  // 답안 입력칸
  const wrap = $('answerWrap');
  if (q.qtypeId === 'short') {
    wrap.innerHTML = `<input type="text" id="userAnswer" class="answer-input" placeholder="정답 용어를 정확히 쓰세요 (부분점수 없음)" autocomplete="off">`;
  } else {
    const rows = q.qtypeId === 'discourse' ? 18 : 8;
    wrap.innerHTML = `<textarea id="userAnswer" class="answer-area" rows="${rows}" placeholder="${q.qtypeId === 'discourse' ? '서론-본론-결론의 논술 형식으로 작성하세요. (내용 15점 + 구성·표현 5점)' : '<작성 방법>의 조건을 모두 지켜 서술하세요. 핵심 용어를 정확히 쓸수록 득점에 유리합니다.'}"></textarea>
    <div class="char-count" id="charCount">0자</div>`;
    setTimeout(() => {
      const ta = $('userAnswer');
      ta.addEventListener('input', () => { $('charCount').textContent = ta.value.length + '자'; });
    }, 0);
  }

  $('btnGrade').disabled = false;
  $('btnReveal').disabled = false;
  $('cardQuestion').classList.remove('hidden');
  $('cardQuestion').scrollIntoView({ behavior: 'smooth', block: 'start' });
  startTimer(qt.minutes);
}

/* ---------- 타이머 ---------- */
function startTimer(recMin) {
  stopTimer();
  S.startTime = Date.now();
  const el = $('qTimer');
  S.timerInt = setInterval(() => {
    const sec = Math.floor((Date.now() - S.startTime) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    el.textContent = `⏱ ${mm}:${ss}`;
    el.classList.toggle('over', sec > recMin * 60);
  }, 1000);
  el.textContent = '⏱ 00:00';
  el.classList.remove('over');
}
function stopTimer() { if (S.timerInt) { clearInterval(S.timerInt); S.timerInt = null; } }
function elapsedSec() { return Math.floor((Date.now() - S.startTime) / 1000); }

/* ---------- 채점 ---------- */
async function onGrade() {
  if (!S.q || S.phase !== 'answering') return;
  const ans = ($('userAnswer').value || '').trim();
  if (!ans) {
    if (confirm('답안이 비어 있습니다.\n채점 없이 정답과 해설을 확인할까요?')) onReveal();
    return;
  }
  S.phase = 'grading';
  stopTimer();
  $('btnGrade').disabled = true;
  $('btnReveal').disabled = true;
  setBusy('✍️ 채점위원이 실제 임용 기준으로 채점하는 중...');
  hideError();
  try {
    const g = await gradeAnswer(S.q, ans);
    S.phase = 'done';
    recordStat(S.q, g);
    // 채점한 모든 문항의 키포인트·해설을 개념노트에 누적 (만점 문항 포함)
    try { saveConceptFromQuestion(S.q, g); } catch (e) { console.warn('개념노트 저장 실패', e); }
    if (g.score < g.max) saveNote(S.q, ans, g);
    renderResult(g, ans);
  } catch (e) {
    console.error(e);
    S.phase = 'answering';
    $('btnGrade').disabled = false;
    $('btnReveal').disabled = false;
    startTimer((QTYPES[S.q.qtypeId] || QTYPES.essay).minutes);
    showError(humanizeError(e));
  } finally {
    setBusy(null);
  }
}

/* ---------- 정답 보기 (채점 없이) ---------- */
function onReveal() {
  if (!S.q) return;
  S.phase = 'done';
  stopTimer();
  renderResult(null, null);
}

/* ---------- 결과 렌더 ---------- */
function renderResult(g, userAnswer) {
  const q = S.q;
  S._lastGrade = g || null;
  S._lastAnswer = userAnswer || null;
  S._savedToNote = !!(g && g.score < g.max); // 감점 문항은 이미 자동 저장됨
  let html = '';

  if (g) {
    const pct = Math.round(g.score / g.max * 100);
    const cls = pct >= 100 ? 'perfect' : pct >= 50 ? 'partial' : 'low';
    html += `<div class="score-hero ${cls}">
      <div class="score-num">${g.score}<span class="score-max"> / ${g.max}점</span></div>
      <div class="score-sub">${pct >= 100 ? '🎉 만점입니다!' : pct >= 50 ? '👍 부분 득점 — 감점 요인을 확인하세요' : '💪 핵심 요소를 다시 정리해 보세요'} · 풀이 시간 ${fmtSec(elapsedSec())}</div>
    </div>`;

    if (Array.isArray(g.elements) && g.elements.length) {
      html += `<div class="sec"><div class="sec-title">📋 채점 기준표 (요소별 득점)</div>
      <table class="rubric"><thead><tr><th>채점 요소</th><th>배점</th><th>득점</th><th>채점 코멘트</th></tr></thead><tbody>` +
        g.elements.map(e => `<tr class="${(Number(e.earned) || 0) >= (Number(e.max) || 0) ? 'ok' : 'miss'}">
          <td>${esc(e.element)}</td><td class="num">${e.max}</td><td class="num">${e.earned}</td><td>${esc(e.comment || '')}</td></tr>`).join('') +
        `</tbody></table></div>`;
    }
    if (g.feedback) html += `<div class="sec"><div class="sec-title">🗒️ 채점위원 총평</div><p>${nl2br(g.feedback)}</p></div>`;
    if (Array.isArray(g.improvement) && g.improvement.length) {
      html += `<div class="sec box-improve"><div class="sec-title">📈 이렇게 쓰면 만점</div><ul>` +
        g.improvement.map(i => `<li>${esc(i)}</li>`).join('') + '</ul></div>';
    }
    if (userAnswer) html += `<div class="sec"><div class="sec-title">✏️ 내가 쓴 답안</div><p class="my-answer">${nl2br(userAnswer)}</p></div>`;
  } else {
    html += `<div class="score-hero skipped"><div class="score-num">정답 확인</div><div class="score-sub">채점 없이 정답을 확인했습니다 (통계 미반영)</div></div>`;
  }

  html += `<div class="sec box-answer"><div class="sec-title">✅ 모범답안</div><p>${nl2br(q.answer)}</p>` +
    ((q.acceptedAnswers || []).length ? `<p class="accepted">인정 답안: ${esc(q.acceptedAnswers.join(', '))}</p>` : '') + `</div>`;

  if (!g && Array.isArray(q.grading) && q.grading.length) {
    html += `<div class="sec"><div class="sec-title">📋 채점 기준</div><ul>` +
      q.grading.map(e => `<li>${esc(e.element)} — <b>${e.points}점</b></li>`).join('') + '</ul></div>';
  }

  if (q.explanation) html += `<div class="sec"><div class="sec-title">📖 해설</div><p>${nl2br(q.explanation)}</p></div>`;
  if ((q.keyPoints || []).length) {
    html += `<div class="sec box-key"><div class="sec-title">💡 핵심 키포인트</div><ul>` +
      q.keyPoints.map(k => `<li>${esc(k)}</li>`).join('') + '</ul></div>';
  }
  if ((q.commonMistakes || []).length) {
    html += `<div class="sec box-mistake"><div class="sec-title">⚠️ 자주 하는 실수</div><ul>` +
      q.commonMistakes.map(m => `<li>${esc(m)}</li>`).join('') + '</ul></div>';
  }
  if (q.trend) html += `<div class="sec"><div class="sec-title">📅 기출 연계 경향</div><p>${nl2br(q.trend)}</p></div>`;
  if (q._issues && q._issues.length) {
    html += `<div class="sec box-verify"><div class="sec-title">🔍 검증 단계에서 수정된 사항</div><ul>` +
      q._issues.map(i => `<li>${esc(i)}</li>`).join('') + '</ul></div>';
  }

  html += `<div id="theoryBox"></div>`;

  $('resultBody').innerHTML = html;

  // 이 주제에 이미 정리된 이론이 있으면 AI 호출 없이 바로 보여줌
  const cached = hasTheoryFor(q);
  const tBtn = $('btnTheory');
  tBtn.disabled = false;
  if (cached) {
    renderTheorySection(cached, true);
    tBtn.textContent = '🔄 이론 다시 정리';
  } else {
    tBtn.textContent = '📘 이 문제 이론 정리';
  }

  // 채점 없이 정답만 본 경우에만 '오답노트에 저장' 버튼 노출 (감점 문항은 자동 저장됨)
  const saveBtn = $('btnSaveNote');
  saveBtn.classList.toggle('hidden', !!g);
  saveBtn.disabled = false;
  saveBtn.textContent = '📥 이 문제 오답노트에 저장';
  $('btnGrade').disabled = true;
  $('btnReveal').disabled = true;
  $('cardResult').classList.remove('hidden');
  $('cardResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 📘 이론 정리 ---------- */
function renderTheorySection(th, fromCache) {
  const box = $('theoryBox');
  if (!box) return;
  box.innerHTML = `<div class="sec">` +
    (fromCache ? `<div class="th-cache">📚 이 주제에 이미 정리해 둔 이론입니다 (AI 호출 없음)</div>` : '') +
    conceptTheoryHtml(th) +
    `<div class="th-saved">✅ 📚 개념노트 · <b>${esc(S.q.areaName)}</b> › <b>${esc(S.q.topic)}</b> 에 저장했습니다</div>
    </div>`;
}

async function onTheory() {
  if (!S.q || S.phase !== 'done') return;
  if (!hasKey()) { showError(humanizeError(new Error('NOKEY'))); openSettings(); return; }
  const btn = $('btnTheory');
  btn.disabled = true;
  setBusy('📘 이 문항의 이론을 교재처럼 정리하는 중...');
  hideError();
  try {
    const th = await explainTheory(S.q);
    // 이 문항의 키포인트·해설도 함께 개념노트에 누적 (미채점 문항 대비)
    try { saveConceptFromQuestion(S.q, S._lastGrade); } catch (e) { console.warn(e); }
    attachTheory(S.q, th);
    S.q._theory = th;
    renderTheorySection(th, false);
    btn.textContent = '🔄 이론 다시 정리';
    $('theoryBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    showError(humanizeError(e));
  } finally {
    btn.disabled = false;
    setBusy(null);
  }
}

/* ---------- 인쇄용 학습지 HTML 생성 ---------- */
function buildPrintSheet(q, g) {
  const qt = QTYPES[q.qtypeId] || QTYPES.essay;
  let h = `<div class="psheet">`;
  h += `<div class="ps-tag">${esc(q.subject)} · ${esc(q.areaName)} · ${esc(q.type || qt.name)} (${q.points}점)</div>`;
  if (q.topic) h += `<div class="ps-topic">주제: ${esc(q.topic)}</div>`;
  if (q.stimulus) h += `<div class="ps-sec"><b>〈 자료 〉</b><div>${nl2br(q.stimulus)}</div></div>`;
  h += `<div class="ps-sec"><b>[ 문제 ]</b><div>${nl2br(q.question)}</div></div>`;
  if ((q.conditions || []).length) h += `<div class="ps-sec"><b>&lt;작성 방법&gt;</b><ul>${q.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>`;
  if (g && typeof g.score === 'number') h += `<div class="ps-sec"><b>[ 내 점수 ]</b> ${g.score} / ${g.max}점</div>`;
  h += `<div class="ps-sec ps-ans"><b>✅ 모범답안</b><div>${nl2br(q.answer)}</div>`;
  if ((q.acceptedAnswers || []).length) h += `<div class="ps-accept">인정 답안: ${esc(q.acceptedAnswers.join(', '))}</div>`;
  h += `</div>`;
  if (q.explanation) h += `<div class="ps-sec"><b>📖 해설</b><div>${nl2br(q.explanation)}</div></div>`;
  if ((q.keyPoints || []).length) h += `<div class="ps-sec"><b>💡 핵심 키포인트</b><ul>${q.keyPoints.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>`;
  // 이론 정리를 받아 둔 문항이면 학습지에도 함께 출력
  const th = q._theory || hasTheoryFor(q);
  if (th) {
    h += `<div class="ps-sec"><b>📘 이론 정리 — ${esc(th.concept || '')}</b>`;
    if (th.oneLine) h += `<div><i>${esc(th.oneLine)}</i></div>`;
    if (th.definition) h += `<div>${nl2br(th.definition)}</div>`;
    if (th.scholars) h += `<div>· 학자·배경: ${nl2br(th.scholars)}</div>`;
    if ((th.elements || []).length) h += `<ul>${th.elements.map(x => `<li><b>${esc(x.name || '')}</b>${x.desc ? ' — ' + esc(x.desc) : ''}</li>`).join('')}</ul>`;
    if ((th.compare || []).length) h += `<div>⚠️ 혼동 개념</div><ul>${th.compare.map(x => `<li><b>${esc(x.term || '')}</b> — ${esc(x.diff || '')}</li>`).join('')}</ul>`;
    if ((th.related || []).length) h += `<div>🔗 관련 이론</div><ul>${th.related.map(x => `<li><b>${esc(x.name || '')}</b>${x.why ? ' — ' + esc(x.why) : ''}</li>`).join('')}</ul>`;
    if (th.examPoint) h += `<div>🎯 출제 포인트: ${nl2br(th.examPoint)}</div>`;
    h += `</div>`;
  }
  if ((q.commonMistakes || []).length) h += `<div class="ps-sec"><b>⚠️ 자주 하는 실수</b><ul>${q.commonMistakes.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  if (q.trend) h += `<div class="ps-sec"><b>📅 기출 연계 경향</b><div>${nl2br(q.trend)}</div></div>`;
  h += `</div>`;
  return h;
}

function doPrint(innerHtml, title) {
  const area = $('printArea');
  area.innerHTML = `<h1 class="ps-title">📝 임용쏙 ${esc(title)}</h1>` + innerHtml;
  window.print();
}

// 현재 결과 1문항 인쇄
function printCurrent() {
  if (!S.q) return;
  doPrint(buildPrintSheet(S.q, S._lastGrade), '학습지');
}

// 오답노트 과목 필터 / 전체선택 / 선택 인쇄
function setNoteFilter(v) { S._noteFilter = v; renderNotes(); }
function toggleAllNotes(checked) {
  document.querySelectorAll('.note-cb').forEach(cb => { cb.checked = checked; });
}
function printSelectedNotes() {
  const notes = getNotes();
  const ids = Array.from(document.querySelectorAll('.note-cb:checked')).map(cb => cb.value);
  let sel;
  if (ids.length) {
    sel = notes.filter(n => ids.indexOf(n.id) >= 0);
  } else {
    const filter = S._noteFilter || 'all';
    const shown = notes.filter(n => filter === 'all' || n.q.subject === filter);
    if (!shown.length) { alert('인쇄할 문항이 없습니다.'); return; }
    if (!confirm(`체크된 문항이 없습니다.\n현재 목록 전체(${shown.length}개)를 인쇄할까요?`)) return;
    sel = shown;
  }
  if (!sel.length) { alert('인쇄할 문항이 없습니다.'); return; }
  const body = sel.map(n => buildPrintSheet(n.q, n.g)).join('');
  doPrint(`<div class="ps-count">인쇄 문항 ${sel.length}개 · 문항당 1페이지</div>` + body, '오답노트 모음');
}

// 채점 없이 본 문제를 오답노트에 저장 (복습용)
function saveRevealToNote() {
  if (!S.q || S._savedToNote) return;
  saveNote(S.q, S._lastAnswer || '(정답만 확인 — 미채점)', { score: '복습', max: S.q.points, reveal: true });
  S._savedToNote = true;
  const b = $('btnSaveNote');
  b.disabled = true;
  b.textContent = '✅ 오답노트에 저장됨';
}

function fmtSec(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}분 ${s}초` : `${s}초`;
}

/* ---------- 통계 ---------- */
function getStats() { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || []; } catch (e) { return []; } }
function recordStat(q, g) {
  const arr = getStats();
  arr.push({ t: Date.now(), subject: q.subject, area: q.areaName, type: q.type, topic: q.topic, score: g.score, max: g.max, sec: elapsedSec() });
  localStorage.setItem(STATS_KEY, JSON.stringify(arr.slice(-1000)));
}

function renderStats() {
  const arr = getStats();
  const el = $('statsBody');
  if (!arr.length) {
    el.innerHTML = `<div class="empty">아직 채점 기록이 없습니다.<br>문제를 풀고 채점하면 여기에 영역별 득점률이 쌓입니다. 📈</div>`;
    return;
  }
  const total = arr.length;
  const sumS = arr.reduce((a, r) => a + r.score, 0);
  const sumM = arr.reduce((a, r) => a + r.max, 0);
  const pct = Math.round(sumS / sumM * 100);
  const perfect = arr.filter(r => r.score >= r.max).length;

  // 유형별
  const byType = {};
  arr.forEach(r => { (byType[r.type] = byType[r.type] || []).push(r); });
  // 영역별
  const byArea = {};
  arr.forEach(r => { (byArea[r.area] = byArea[r.area] || []).push(r); });

  let html = `<div class="stat-cards">
    <div class="stat-card"><div class="sc-num">${total}</div><div class="sc-label">푼 문항</div></div>
    <div class="stat-card"><div class="sc-num">${pct}%</div><div class="sc-label">전체 득점률</div></div>
    <div class="stat-card"><div class="sc-num">${perfect}</div><div class="sc-label">만점 문항</div></div>
    <div class="stat-card"><div class="sc-num">${sumS}<span class="sc-small">/${sumM}</span></div><div class="sc-label">누적 득점</div></div>
  </div>`;

  html += `<div class="sec"><div class="sec-title">유형별 성적</div><table class="rubric"><thead><tr><th>유형</th><th>문항 수</th><th>득점률</th><th>평균 점수</th></tr></thead><tbody>`;
  Object.keys(byType).forEach(t => {
    const rs = byType[t];
    const p = Math.round(rs.reduce((a, r) => a + r.score, 0) / rs.reduce((a, r) => a + r.max, 0) * 100);
    const avg = (rs.reduce((a, r) => a + r.score, 0) / rs.length).toFixed(1);
    html += `<tr><td>${esc(t)}</td><td class="num">${rs.length}</td><td class="num">${p}%</td><td class="num">${avg}점</td></tr>`;
  });
  html += `</tbody></table></div>`;

  html += `<div class="sec"><div class="sec-title">영역별 득점률 (약한 영역을 집중 공략하세요)</div><table class="rubric"><thead><tr><th>영역</th><th>문항 수</th><th>득점률</th><th></th></tr></thead><tbody>`;
  Object.keys(byArea).sort((a, b) => {
    const pa = byArea[a].reduce((x, r) => x + r.score, 0) / byArea[a].reduce((x, r) => x + r.max, 0);
    const pb = byArea[b].reduce((x, r) => x + r.score, 0) / byArea[b].reduce((x, r) => x + r.max, 0);
    return pa - pb;
  }).forEach(a => {
    const rs = byArea[a];
    const p = Math.round(rs.reduce((x, r) => x + r.score, 0) / rs.reduce((x, r) => x + r.max, 0) * 100);
    html += `<tr><td>${esc(a)}</td><td class="num">${rs.length}</td><td class="num">${p}%</td>
      <td class="barcell"><div class="bar"><div class="bar-fill ${p < 50 ? 'weak' : ''}" style="width:${p}%"></div></div></td></tr>`;
  });
  html += `</tbody></table></div>
  <button class="btn-ghost danger" onclick="resetStats()">🗑️ 통계 초기화</button>`;
  el.innerHTML = html;
}

function resetStats() {
  if (confirm('학습 통계를 모두 삭제할까요?')) {
    localStorage.removeItem(STATS_KEY);
    renderStats();
  }
}

/* ---------- 오답노트 ---------- */
function getNotes() { try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch (e) { return []; } }
function saveNote(q, userAnswer, g) {
  const notes = getNotes();
  notes.unshift({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 7), t: Date.now(), q, userAnswer, g });
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes.slice(0, 100)));
}
function deleteNote(id) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(getNotes().filter(n => n.id !== id)));
  renderNotes();
}
function retryNote(id) {
  const n = getNotes().find(x => x.id === id);
  if (!n) return;
  switchTab('solve');
  const subject = n.q.subject === '교육학' ? 'edu'
    : (n.q.subject && n.q.subject.indexOf('사서') >= 0) ? 'lib' : 'home';
  onGenerate({ subject, qtypeId: n.q.qtypeId, areaId: n.q.areaId, topic: n.q.topic });
}

function renderNotes() {
  const notes = getNotes();
  const el = $('notesBody');
  if (!notes.length) {
    el.innerHTML = `<div class="empty">오답노트가 비어 있습니다.<br>채점에서 감점된 문항이 자동으로 저장됩니다. 📕</div>`;
    return;
  }
  // 과목 필터 (전공이 2개일 때 구분)
  const subjects = [];
  notes.forEach(n => { if (subjects.indexOf(n.q.subject) < 0) subjects.push(n.q.subject); });
  const filter = S._noteFilter || 'all';
  const shown = notes.filter(n => filter === 'all' || n.q.subject === filter);
  const filterOpts = ['<option value="all">전체 과목</option>']
    .concat(subjects.map(s => `<option value="${esc(s)}" ${filter === s ? 'selected' : ''}>${esc(s)}</option>`)).join('');

  const header = `<div class="notes-bar">
    <div class="notes-left">
      <label class="note-selall"><input type="checkbox" id="noteSelAll" onchange="toggleAllNotes(this.checked)"> 전체 선택</label>
      ${subjects.length > 1 ? `<select id="noteFilter" onchange="setNoteFilter(this.value)">${filterOpts}</select>` : ''}
      <span class="notes-count">${shown.length}개</span>
    </div>
    <button class="btn-secondary" onclick="printSelectedNotes()">🖨️ 선택 인쇄 · PDF 저장</button>
  </div>
  <div class="notes-hint">☑️ 인쇄할 문항을 체크하세요. 아무것도 안 고르면 현재 목록 전체가 인쇄됩니다. (문항당 1페이지)</div>`;

  el.innerHTML = header + shown.map(n => {
    const d = new Date(n.t);
    const date = `${d.getMonth() + 1}.${d.getDate()}`;
    const scoreLabel = (n.g && n.g.reveal) ? '복습' : `${n.g.score}/${n.g.max}점`;
    const myAnsLabel = (n.g && n.g.reveal) ? '내 답안' : `내 답안 (${n.g.score}점)`;
    const subjTag = n.q.subject ? `<span class="badge b-subject note-subj">${esc(n.q.subject)}</span>` : '';
    return `<div class="note-item">
      <div class="note-topbar">
        <input type="checkbox" class="note-cb" value="${n.id}" title="인쇄 선택">
        <div class="note-head" onclick="this.closest('.note-item').classList.toggle('open')">
        ${subjTag}
        <span class="badge b-area">${esc(n.q.areaName)}</span>
        <span class="note-topic">${esc(n.q.topic)}</span>
        <span class="note-score">${esc(scoreLabel)}</span>
        <span class="note-date" title="오답노트에 저장한 날짜">📅 ${date}</span>
        <span class="note-arrow">▾</span>
      </div>
      </div>
      <div class="note-detail">
        ${n.q.stimulus ? `<div class="stimulus small">${nl2br(n.q.stimulus)}</div>` : ''}
        <p class="note-q">${nl2br(n.q.question)}</p>
        ${(n.q.conditions || []).length ? `<div class="conditions small"><div class="cond-title">&lt;작성 방법&gt;</div><ul>${n.q.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
        <div class="sec"><div class="sec-title">✏️ ${esc(myAnsLabel)}</div><p class="my-answer">${nl2br(n.userAnswer)}</p></div>
        <div class="sec box-answer"><div class="sec-title">✅ 모범답안</div><p>${nl2br(n.q.answer)}</p></div>
        ${(n.q.keyPoints || []).length ? `<div class="sec box-key"><div class="sec-title">💡 키포인트</div><ul>${n.q.keyPoints.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>` : ''}
        <div class="note-actions">
          <button class="btn-mini" onclick="retryNote('${n.id}')">🎲 이 주제 유사 문제 다시 풀기</button>
          <button class="btn-mini danger" onclick="deleteNote('${n.id}')">🗑️ 삭제</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ---------- 교육 트렌드 ---------- */
function renderTrends() {
  const d = getTrendsData();
  const s = getSettings();
  const stale = isTrendsStale();
  const el = $('trendsBody');

  let html = `<div class="card">
    <div class="trend-header">
      <div>
        <div class="sec-title" style="margin-bottom:2px">📰 최신 교육 동향 ${d.items.length}건</div>
        <div class="trend-updated ${stale ? 'stale' : ''}">${esc(trendsUpdatedLabel())}${stale ? ' — 🔄 갱신을 권장합니다' : ''}</div>
      </div>
      <button class="btn-primary" id="btnRefreshTrends">🔄 AI 웹검색으로 갱신</button>
    </div>
    <label class="check-row" style="margin:12px 0 4px">
      <input type="checkbox" id="chkUseTrends" ${s.useTrends ? 'checked' : ''}>
      교육학·가정과 교육론 출제에 최신 동향 반영 (실제 논술처럼 시사 맥락 제시문)
    </label>
    <div class="trend-note">Claude·Gemini는 실시간 웹검색으로 갱신됩니다 (OpenAI는 모델 지식 기준). 갱신 시 AI 호출 1회가 발생하며 웹검색 비용이 추가될 수 있습니다.</div>
    <div class="test-result" id="trendsStatus"></div>
  </div>`;

  html += d.items.map(i => `<div class="card trend-item">
    <div class="trend-title">${esc(i.title)} <span class="trend-date">${esc(i.date || '')}</span></div>
    <p class="trend-summary">${esc(i.summary)}</p>
    <div class="trend-edulink">🎓 임용 연계 — ${esc(i.eduLink)}</div>
  </div>`).join('');

  el.innerHTML = html;
  $('btnRefreshTrends').addEventListener('click', onRefreshTrends);
  $('chkUseTrends').addEventListener('change', e => {
    const st = getSettings();
    st.useTrends = e.target.checked;
    saveSettings(st);
  });
}

async function onRefreshTrends() {
  if (!hasKey()) {
    $('trendsStatus').textContent = '⚙️ 설정에서 AI API 키를 먼저 등록해 주세요.';
    $('trendsStatus').className = 'test-result fail';
    return;
  }
  const btn = $('btnRefreshTrends');
  btn.disabled = true;
  $('trendsStatus').textContent = '🌐 최신 교육 뉴스·정책을 웹에서 검색하는 중... (수십 초 걸릴 수 있어요)';
  $('trendsStatus').className = 'test-result';
  try {
    await fetchTrendsWithAI();
    renderTrends();
    updateTrendsBadge();
    $('trendsStatus').textContent = '✅ 최신 동향으로 갱신했습니다. 이제 출제에 자동 반영됩니다.';
    $('trendsStatus').className = 'test-result ok';
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    $('trendsStatus').textContent = '❌ ' + humanizeError(e);
    $('trendsStatus').className = 'test-result fail';
  }
}

// 교육 트렌드 탭에 갱신 알림 배지 표시 (오래됐을 때)
function updateTrendsBadge() {
  const tab = document.querySelector('.tab-btn[data-tab="trends"]');
  if (!tab) return;
  const old = tab.querySelector('.tab-badge');
  if (old) old.remove();
  if (isTrendsStale()) {
    const b = document.createElement('span');
    b.className = 'tab-badge';
    b.title = '교육 동향 갱신을 권장합니다';
    b.textContent = '갱신';
    tab.appendChild(b);
  }
}

/* ---------- 상태 표시 ---------- */
function setBusy(msg) {
  const el = $('busyBar');
  if (msg) {
    el.innerHTML = `<span class="spinner"></span> ${esc(msg)}`;
    el.classList.remove('hidden');
    $('btnGenerate').disabled = true;
  } else {
    el.classList.add('hidden');
    $('btnGenerate').disabled = false;
  }
}
function showError(msg) {
  const el = $('errorBar');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError() { $('errorBar').classList.add('hidden'); }

/* ---------- 설정 모달 ---------- */
function openSettings() {
  const s = getSettings();
  document.querySelectorAll('input[name="provider"]').forEach(r => { r.checked = r.value === s.provider; });
  $('keyClaude').value = s.keys.claude || '';
  $('keyGemini').value = s.keys.gemini || '';
  $('keyOpenai').value = s.keys.openai || '';
  $('modelInput').value = s.models[s.provider] || '';
  $('chkVerify').checked = s.verify;
  $('testResult').textContent = '';
  $('settingsModal').classList.remove('hidden');
}
function closeSettings() { $('settingsModal').classList.add('hidden'); }

function persistSettings() {
  const s = getSettings();
  const provider = document.querySelector('input[name="provider"]:checked')?.value || 'claude';
  s.provider = provider;
  s.keys.claude = $('keyClaude').value.trim();
  s.keys.gemini = $('keyGemini').value.trim();
  s.keys.openai = $('keyOpenai').value.trim();
  s.models[provider] = $('modelInput').value.trim();
  s.verify = $('chkVerify').checked;
  saveSettings(s);
  return s;
}

async function onTestConnection() {
  persistSettings();
  const el = $('testResult');
  el.textContent = '연결 확인 중...';
  el.className = 'test-result';
  try {
    await testConnection();
    el.textContent = '✅ 연결 성공! 문제를 출제할 수 있습니다.';
    el.className = 'test-result ok';
  } catch (e) {
    el.textContent = '❌ ' + humanizeError(e);
    el.className = 'test-result fail';
  }
}

function onSaveSettings() {
  persistSettings();
  closeSettings();
}

/* ---------- 초기화 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  populateSelectors();
  $('selSubject').addEventListener('change', populateSelectors);
  $('btnGenerate').addEventListener('click', () => onGenerate());
  $('btnGrade').addEventListener('click', onGrade);
  $('btnReveal').addEventListener('click', onReveal);
  $('btnNext').addEventListener('click', () => onGenerate());
  $('btnPrint').addEventListener('click', printCurrent);
  $('btnTheory').addEventListener('click', onTheory);
  $('btnSaveNote').addEventListener('click', saveRevealToNote);
  $('btnSettings').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnSaveSettings').addEventListener('click', onSaveSettings);
  $('btnTest').addEventListener('click', onTestConnection);
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('input[name="provider"]').forEach(r => r.addEventListener('change', () => {
    const s = getSettings();
    $('modelInput').value = s.models[r.value] || '';
    $('modelInput').placeholder = '비우면 기본값: ' + DEFAULT_MODELS[r.value];
  }));

  updateTrendsBadge();

  if (!hasKey()) {
    $('errorBar').textContent = '👋 처음이신가요? 우측 상단 ⚙️ 설정에서 AI API 키를 등록하면 바로 문제를 풀 수 있어요.';
    $('errorBar').classList.remove('hidden');
  }
});
