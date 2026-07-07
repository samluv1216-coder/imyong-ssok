/* ==========================================================
   임용쏙 — 교육 트렌드 모듈
   최신 교육계 뉴스·정책을 교육학 출제에 반영
   ========================================================== */

const TRENDS_KEY = 'imyongssok_trends_v1';
const TRENDS_STALE_DAYS = 14;

// 내장 기준 데이터 (2026년 1월 기준) — AI 웹검색 갱신 전 폴백
const TRENDS_BASELINE = {
  source: 'baseline',
  label: '내장 데이터 (2026년 1월 기준)',
  fetchedAt: 0,
  items: [
    { title: '2022 개정 교육과정 전면 적용 확대', date: '2025~',
      summary: '2025년 중1·고1부터 학교 현장 적용이 본격 확대. 깊이 있는 학습, 핵심역량 함양, 학생 주도성(agency), 삶과 연계한 학습을 강조.',
      eduLink: '교육과정 논술의 핵심 맥락 — 역량 중심 교육과정, 교육과정 재구성, 백워드 설계와 연계 출제' },
    { title: 'AI 디지털교과서(AIDT) 도입과 조정', date: '2025~2026',
      summary: '2025년 수학·영어·정보 교과에 도입 시작. 법적 지위(교과서 vs 교육자료) 논쟁을 거치며 학교 자율 채택으로 조정. 맞춤형 학습과 교사 역할 변화가 쟁점.',
      eduLink: '교육방법·공학 연계 — 맞춤형(적응형) 학습, 하이터치 하이테크, 테크놀로지 활용 수업에서 교사의 역할' },
    { title: '고교학점제 전면 시행', date: '2025~',
      summary: '2025년 고1부터 전면 시행(192학점). 최소 성취수준 보장 지도, 진로·학업 설계 지도, 미이수 방지 지원이 과제.',
      eduLink: '교육과정 선택권·진로지도(Super, Holland)·책임교육과 연계한 논술 맥락으로 빈출 예상' },
    { title: '2028 대입제도 개편', date: '2028 대입~',
      summary: '통합형·융합형 수능(선택과목 폐지), 고교 내신 5등급 체제(2025년 고1부터). 논·서술형 평가 확대 논의 지속.',
      eduLink: '교육평가 연계 — 규준참조 vs 준거참조, 평가의 공정성, 과정중심평가와 대입의 정합성' },
    { title: '늘봄학교 전면 확대', date: '2024~',
      summary: '초등 전 학년으로 확대되는 교육·돌봄 통합 정책. 국가 책임 교육·돌봄 체제 구축이 목표.',
      eduLink: '교육행정 연계 — 교육복지, 학교의 기능 확장, 교육격차 해소 정책' },
    { title: '교권 보호 제도 강화', date: '2023~',
      summary: '교권보호 5법 개정 이후 교육활동 침해 대응 절차, 분리 조치, 아동학대 신고 관련 보호 장치가 강화됨. 학교 민원 대응 체계 개편.',
      eduLink: '교육행정·교직 논술 맥락 — 교직 전문성, 교원 사기와 동기(Herzberg), 학교 조직문화' },
    { title: '책임교육학년제와 기초학력 보장', date: '2023~',
      summary: '기초학력보장법에 따라 초3·중1을 책임교육학년으로 지정, 진단-지원 체계 운영. 학습 결손 회복과 교육격차 해소가 핵심 과제.',
      eduLink: '교육평가(진단평가)·교육사회(교육평등관, 결과의 평등)와 연계 — 논술 단골 맥락' },
    { title: '디지털 기반 교육혁신과 교실혁명', date: '2024~',
      summary: '교실혁명 선도교사 양성, 하이터치 하이테크(HTHT) 수업, 에듀테크 활용 확산. 개념 기반 탐구, 학생 참여형 수업으로의 전환 강조.',
      eduLink: '교육방법 연계 — 구성주의 수업, 학습자 중심 교육, 테크놀로지 통합(TPACK)' },
    { title: '학생 정신건강·사회정서학습(SEL) 강화', date: '2024~',
      summary: '학생 정신건강 통합 지원, 사회정서교육 확대. 위기 학생 조기 발견과 상담 지원 체계 구축.',
      eduLink: '생활지도·상담 연계 — 상담이론 적용, 학교 상담 체계, 정서·행동 위기 개입' },
    { title: '학교폭력 전담조사관제 도입', date: '2024~',
      summary: '학교폭력 사안 조사를 전담조사관이 담당하도록 개편, 교사의 사안 처리 부담 경감과 조사 전문성 확보가 목적.',
      eduLink: '생활지도 연계 — 학교폭력 예방과 사안처리, 회복적 생활교육' },
    { title: 'IB(국제 바칼로레아) 프로그램 확산', date: '2023~',
      summary: '여러 시·도교육청에서 IB 관심·후보·인증 학교 확대. 개념 기반 탐구학습, 논·서술형 평가, 교사 협력 문화가 특징.',
      eduLink: '교육과정(개념 기반 교육과정)·교육평가(논술형 평가, 채점 신뢰도)와 연계' },
    { title: '전문적 학습공동체와 수업·평가 혁신', date: '지속',
      summary: '교사 학습공동체 중심의 수업 나눔·공동 연구가 정책적으로 지원됨. 교사 주도 연수(학교 안 전문적 학습공동체)가 확산.',
      eduLink: '교육행정 연계 — 학습조직, 분산적 지도성, 동료장학과 연계 출제 빈도 높음' },
  ],
};

function getTrendsData() {
  try {
    const raw = localStorage.getItem(TRENDS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.items) && d.items.length) return d;
    }
  } catch (e) {}
  return TRENDS_BASELINE;
}

function saveTrendsData(items) {
  const d = { source: 'ai', label: 'AI 웹검색 갱신', fetchedAt: Date.now(), items };
  localStorage.setItem(TRENDS_KEY, JSON.stringify(d));
  return d;
}

function trendsAgeDays() {
  const d = getTrendsData();
  if (!d.fetchedAt) return null; // baseline
  return Math.floor((Date.now() - d.fetchedAt) / 86400000);
}

function isTrendsStale() {
  const age = trendsAgeDays();
  return age === null || age > TRENDS_STALE_DAYS;
}

function trendsUpdatedLabel() {
  const d = getTrendsData();
  if (!d.fetchedAt) return d.label;
  const dt = new Date(d.fetchedAt);
  return `AI 웹검색 갱신: ${dt.getFullYear()}.${dt.getMonth() + 1}.${dt.getDate()}`;
}

// 출제 프롬프트에 넣을 동향 블록
function trendsPromptBlock() {
  const d = getTrendsData();
  return d.items.slice(0, 10)
    .map(i => `- ${i.title}(${i.date || ''}): ${i.summary} [출제 연계: ${i.eduLink}]`)
    .join('\n');
}

// ---------- AI 웹검색으로 최신 동향 갱신 ----------
const TRENDS_SYSTEM = `당신은 한국 교육정책 동향 분석가이자 중등교사 임용시험(교육학) 출제 자문위원입니다.
웹 검색으로 확인한 '사실'만 정리하고, 확인되지 않은 내용은 포함하지 마세요.`;

async function fetchTrendsWithAI() {
  const today = new Date();
  const user = `오늘은 ${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일입니다.
한국 중등교육과 관련된 최신 동향을 웹에서 검색·확인하여 정리하세요.

[수집 대상]
- 교육부·시도교육청의 새 정책, 교육과정 개정·적용 소식 (새 교육과정의 비전·목표 변화 포함)
- 대입제도·평가제도 변화, 교원 정책, 학교 현장 주요 이슈
- 중등교사 임용시험 교육학 논술의 배경 맥락으로 쓰일 만한 것 위주
- 최근 12개월 이내 소식 우선, 8~12개

[출력 — JSON만, 다른 텍스트 금지]
{"items":[{"title":"동향 제목","date":"시기(예: 2026.5)","summary":"핵심 내용 2~3문장 (사실 기반)","eduLink":"임용 교육학과의 연계 포인트 1문장 (교육과정/교육심리/교육방법/교육평가/교육행정/생활지도 중 어느 영역과 어떻게 연결되는지)"}]}`;

  const raw = await callAI(TRENDS_SYSTEM, user, 6000, { search: true });
  const parsed = extractJson(raw);
  if (!parsed.items || !Array.isArray(parsed.items) || !parsed.items.length) throw new Error('JSONPARSE');
  return saveTrendsData(parsed.items);
}
