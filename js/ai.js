/* ==========================================================
   임용쏙 — AI 호출 (출제·검증·채점)  BYOK: Claude/Gemini/OpenAI
   ========================================================== */

// ---------- 공통 호출 ----------
// opts.search: true면 웹 검색 도구 사용 (Claude·Gemini 지원, OpenAI는 모델 지식으로 폴백)
async function callAI(system, user, maxTokens, opts) {
  const s = getSettings();
  const p = s.provider;
  const key = (s.keys[p] || '').trim();
  if (!key) throw new Error('NOKEY');
  const model = resolveModel(p);
  maxTokens = maxTokens || 4096;
  const useSearch = !!(opts && opts.search);

  if (p === 'claude') {
    const body = {
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: user }],
    };
    if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res, 'Claude');
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('');
  }

  if (p === 'gemini') {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 },
    };
    if (useSearch) body.tools = [{ google_search: {} }];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res, 'Gemini');
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map(x => x.text || '').join('');
  }

  // openai
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw await apiError(res, 'OpenAI');
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function apiError(res, name) {
  let msg = '';
  try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j).slice(0, 200); } catch (e) {}
  const err = new Error(`${name} ${res.status}: ${msg}`);
  err.status = res.status;
  return err;
}

function humanizeError(e) {
  const m = String(e && e.message || e);
  if (m === 'NOKEY') return '⚙️ 우측 상단 [설정]에서 AI API 키를 먼저 등록해 주세요.';
  if (/401|invalid.*key|authentication/i.test(m)) return '🔑 API 키가 유효하지 않습니다. 설정에서 키를 다시 확인해 주세요.\n(' + m + ')';
  if (/429|rate|quota|billing|credit/i.test(m)) return '⏳ 사용량 한도 또는 크레딧 문제입니다. 잠시 후 재시도하거나 결제 상태를 확인해 주세요.\n(' + m + ')';
  if (/404|not.*found|model/i.test(m)) return '🤖 모델 이름이 잘못됐을 수 있습니다. 설정에서 모델을 비우면 기본값을 사용합니다.\n(' + m + ')';
  if (/Failed to fetch|NetworkError|CORS/i.test(m)) return '🌐 네트워크 오류입니다. 인터넷 연결을 확인해 주세요.\n(' + m + ')';
  if (/JSONPARSE/.test(m)) return '📄 AI 응답 해석에 실패했습니다. [문제 출제]를 다시 눌러 주세요.';
  return '⚠️ 오류가 발생했습니다: ' + m;
}

// ---------- JSON 추출 (코드블록/불완전 응답 대응) ----------
function extractJson(text) {
  if (!text) throw new Error('JSONPARSE');
  const block = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const candidates = [];
  if (block) candidates.push(block[1]);
  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { candidates.push(text.slice(start, i + 1)); break; } }
    }
  }
  candidates.push(text);
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch (e) {}
  }
  throw new Error('JSONPARSE');
}

// ---------- 출제 ----------
const GEN_SYSTEM = `당신은 한국 중등교사 임용경쟁시험 출제위원장입니다. 2016~2026학년도 기출문제의 형식·난이도·출제 경향을 정밀하게 반영한 '기출 유사 문제'를 출제합니다.

[실제 시험 형식 — 반드시 준수]
- 기입형(2점): 짧은 제시문(자료·대화·표) 뒤 "쓰시오"로 끝남. 정답은 용어·명칭·수치 1~2개. 부분점수 없음(단, 답 2개 요구 시 각 1점).
- 서술형(4점): 제시문(교수·학습 지도안, 교사·학생 대화, 사례, 실험 결과, 표) + <작성 방법> 조건 2~4개. 채점 요소별 부분점수. 실제 기출처럼 "…을/를 서술할 것", "…의 명칭을 쓰고 그 이유를 제시할 것" 형태의 조건을 사용.
- 논술형(교육학, 20점): 학교 현장 상황 제시문(교사 대화·성찰 일지·연수 자료) + 논술 과제. 배점: 내용 15점(요소별) + 논술의 구성 및 표현 5점. "…에 대해 각각 2가지씩 제시하시오" 형태로 내용 요소를 명시.

[출제 원칙]
1. 실제 기출처럼 구체적 제시문(수업 지도안 일부, 교사-학생 대화, 사례, 데이터 표)을 창작해 포함할 것
2. 정답이 유일하고 명확할 것 — 복수 해석이 가능한 모호한 문제 금지
3. 학문적으로 정확할 것 (전공 서적·교과서 수준으로 검증된 내용만)
4. 교육과정 관련 문항은 2022 개정 교육과정 기준
5. 출력 전 자체 점검: ① 정답 유일성 ② <작성 방법>과 모범답안의 일치 ③ 채점 요소 배점 합계 = 총 배점 ④ 용어의 정확성

[출력 형식 — 아래 JSON만 출력, 다른 텍스트 금지]
{
 "type": "기입형|서술형|논술형",
 "points": 2,
 "question": "발문(마지막 지시문 포함)",
 "stimulus": "제시문/자료 (줄바꿈은 \\n, 없으면 null)",
 "conditions": ["<작성 방법> 조건들 (기입형이면 빈 배열)"],
 "answer": "모범답안 (서술형·논술형은 실제 답안 형태의 완성된 글)",
 "acceptedAnswers": ["기입형일 때 인정 가능한 답안 표현들, 그 외 빈 배열"],
 "grading": [{"element":"채점 요소","points":2}],
 "explanation": "해설 — 개념의 배경과 원리를 수험생 눈높이로 상세히",
 "keyPoints": ["꼭 암기할 키포인트 3~6개"],
 "commonMistakes": ["수험생이 자주 하는 실수 2~4개"],
 "trend": "기출 연계 경향 (예: 이 개념은 2019·2023학년도에 유사 형태로 출제)"
}`;

async function generateQuestion(opt) {
  // opt: {subject:'home'|'edu', subjectName, qtype(QTYPES obj), area(area obj), topic, avoid:[], trendsBlock}
  const user = `[출제 요청]
- 과목: ${opt.subjectName}
- 영역: ${opt.area.name}
- 주제: ${opt.topic}
- 문제 유형: ${opt.qtype.name} (배점 ${opt.qtype.points}점)
- 이 영역의 기출 경향: ${opt.area.trend}
${opt.avoid && opt.avoid.length ? '- 최근 이미 출제한 주제(겹치지 않게 다른 각도로): ' + opt.avoid.join(', ') : ''}
${opt.trendsBlock ? `
[최신 교육 동향 — 출제 맥락에 반영]
${opt.trendsBlock}
→ 실제 임용시험처럼 제시문(교사 대화, 연수 자료, 성찰 일지 등)의 배경 맥락에 위 동향 중 이 주제와 관련 있는 것을 자연스럽게 1가지 녹여 내세요. 단, 채점 요소와 정답은 검증된 이론·개념 중심을 유지하고, 동향 관련 서술은 사실과 다르지 않아야 합니다. 관련 있는 동향이 없으면 무리하게 넣지 마세요.` : ''}

위 주제로 실제 임용시험 스타일의 ${opt.qtype.name} 문제 1개를 출제하세요. 제시문 유형(지도안/대화/사례/표)을 다양하게 활용하고, 자체 점검을 마친 뒤 JSON만 출력하세요.`;
  // 서술형/논술형은 제시문+모범답안+해설이 길어 넉넉한 토큰 필요 (응답 잘림 방지)
  const genTokens = opt.qtype.id === 'discourse' ? 16000 : opt.qtype.id === 'essay' ? 10000 : 6000;
  const raw = await callAI(GEN_SYSTEM, user, genTokens);
  const q = extractJson(raw);
  // 메타 보강
  q.subject = opt.subjectName;
  q.areaName = opt.area.name;
  q.areaId = opt.area.id;
  q.topic = opt.topic;
  q.points = q.points || opt.qtype.points;
  q.qtypeId = opt.qtype.id;
  return q;
}

// ---------- 2단계 검증 (출제 오류 자동 점검) ----------
const VERIFY_SYSTEM = `당신은 한국 중등교사 임용시험 검토위원입니다. 출제된 문항을 다음 기준으로 엄격히 검토합니다.
① 학문적 정확성(개념·용어·수치의 오류) ② 정답의 유일성(다른 답도 정답이 될 수 있는지) ③ <작성 방법> 조건과 모범답안의 일치 ④ 채점 요소 배점 합계 = 총 배점 ⑤ 발문의 명확성.
오류가 없으면 {"ok":true,"issues":[]} 만 출력.
오류가 있으면 {"ok":false,"issues":["발견한 오류들"],"fixed":{수정된 전체 문항 JSON(원본과 동일한 스키마)}} 을 출력.
JSON 외 다른 텍스트 금지.`;

async function verifyQuestion(q) {
  const user = '다음 문항을 검토하세요:\n' + JSON.stringify(q, null, 1);
  // 수정 시 전체 문항 JSON을 재생성하므로 출제와 동등하게 넉넉히 (잘림 방지)
  const vTokens = q.qtypeId === 'discourse' ? 16000 : q.qtypeId === 'essay' ? 10000 : 6000;
  const raw = await callAI(VERIFY_SYSTEM, user, vTokens);
  const v = extractJson(raw);
  if (v.ok === false && v.fixed && v.fixed.question) {
    const fixed = v.fixed;
    // 메타 유지
    fixed.subject = q.subject; fixed.areaName = q.areaName; fixed.areaId = q.areaId;
    fixed.topic = q.topic; fixed.qtypeId = q.qtypeId; fixed.points = fixed.points || q.points;
    fixed._verified = true; fixed._issues = v.issues || [];
    return fixed;
  }
  q._verified = true; q._issues = [];
  return q;
}

// ---------- 채점 (실제 임용 기준) ----------
const GRADE_SYSTEM = `당신은 한국 중등교사 임용시험 채점위원입니다. 실제 임용시험과 동일한 기준으로 엄격하게 채점합니다.

[채점 기준]
- 기입형(2점): 모범답안·인정답안과 동일한 개념의 '정확한 용어'만 정답. 포괄적·애매한 표현, 유사하지만 다른 개념은 0점. 부분점수 없음(단, 답 2개 요구 문항은 항목별 각 1점).
- 서술형(4점): 채점 요소별 부분점수. 핵심 용어가 누락되거나 부정확하면 해당 요소 감점. <작성 방법> 조건을 위반한 요소는 0점 처리. 단순히 관련 있는 말을 늘어놓은 답은 점수를 주지 않음.
- 논술형(20점): 내용 15점(요소별 채점) + 구성·표현 5점(논리적 체계 3점: 서론-본론-결론 구조·과제 순서 준수, 표현 2점: 문장의 명료성). 요구한 개수(예: 2가지)를 채우지 못하면 해당 요소 감점.
- 관대하게 채점하지 말 것. 실제 시험에서 채점위원 2인이 동의할 수준만 득점 인정.
- 빈 답, 문제와 무관한 답은 0점.

[출력 — JSON만]
{
 "score": 3,
 "max": 4,
 "elements": [{"element":"채점 요소","earned":1,"max":2,"comment":"득점/감점 이유를 구체적으로"}],
 "feedback": "총평 — 답안의 강점과 약점을 채점위원 시각에서",
 "improvement": ["다음에 이렇게 쓰면 만점: 구체적 보완 포인트 2~4개"]
}`;

async function gradeAnswer(q, userAnswer) {
  const user = `[문항 정보]
유형: ${q.type} (배점 ${q.points}점)
문제: ${q.question}
제시문: ${q.stimulus || '(없음)'}
작성 방법: ${(q.conditions || []).join(' / ') || '(없음)'}
모범답안: ${q.answer}
인정답안: ${(q.acceptedAnswers || []).join(', ') || '(모범답안 기준)'}
채점 요소: ${JSON.stringify(q.grading || [])}

[수험생 답안]
${userAnswer}

위 답안을 실제 임용시험 기준으로 채점하고 JSON만 출력하세요. score는 요소별 earned 합계와 일치해야 하며 max는 ${q.points}점입니다.`;
  const raw = await callAI(GRADE_SYSTEM, user, q.qtypeId === 'discourse' ? 10000 : 6000);
  const g = extractJson(raw);
  // 안전 보정
  g.max = q.points;
  if (Array.isArray(g.elements) && g.elements.length) {
    const sum = g.elements.reduce((a, e) => a + (Number(e.earned) || 0), 0);
    g.score = Math.min(Math.max(0, sum), q.points);
  } else {
    g.score = Math.min(Math.max(0, Number(g.score) || 0), q.points);
  }
  return g;
}

// ---------- 연결 테스트 ----------
async function testConnection() {
  const txt = await callAI('간단한 연결 테스트입니다.', '"OK"라고만 답하세요.', 16);
  return /ok/i.test(txt);
}
