/* 임용쏙 — BYOK 설정 (localStorage) */
const SETTINGS_KEY = 'imyongssok_settings_v1';

const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-4o',
};

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      provider: s.provider || 'claude',
      keys: Object.assign({ claude: '', gemini: '', openai: '' }, s.keys || {}),
      models: Object.assign({ claude: '', gemini: '', openai: '' }, s.models || {}),
      verify: s.verify !== false,       // 2단계 출제 검증 (기본 ON)
      useTrends: s.useTrends !== false, // 최신 교육 동향 출제 반영 (기본 ON)
    };
  } catch (e) {
    return { provider: 'claude', keys: { claude: '', gemini: '', openai: '' }, models: { claude: '', gemini: '', openai: '' }, verify: true, useTrends: true };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// 모델 ID 자동 보정 (잘못된 입력 방지)
function resolveModel(provider) {
  const s = getSettings();
  let m = (s.models[provider] || '').trim();
  if (!m) return DEFAULT_MODELS[provider];
  if (provider === 'claude' && !/^claude-/.test(m)) return DEFAULT_MODELS.claude;
  if (provider === 'gemini' && !/^gemini-/.test(m)) return DEFAULT_MODELS.gemini;
  return m;
}

function hasKey() {
  const s = getSettings();
  return !!(s.keys[s.provider] || '').trim();
}
