const fs = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR } = require('./config');

const SKILLS_PATH = path.join(BRAIN_DIR, '.crew-pocket-live-phone-skills.json');
const DEFAULT_SKILLS = [{
  id: 'universal-mobile-navigation',
  name: '通用手機導航',
  instruction: '對任何跨 App 任務都先 inspect_ui，從文字、描述、可點擊狀態與 bounds 判斷目前畫面。開 App 時一律先 launch_app，不要在桌面猜圖示座標。每次 tap_screen、swipe_screen、type_text 或 press_key 後，等待並再次 inspect_ui；只有 UI 已變化或目標明確出現才繼續。滑動無變化時不可重複同一手勢，改找可點擊控制項、換合理方向或 BACK，最多三種復原策略。'
}];

function clean(value, max) { return String(value || '').trim().replace(/\s{3,}/g, ' ').slice(0, max); }

async function readSkills() {
  try {
    const data = JSON.parse(await fs.readFile(SKILLS_PATH, 'utf8'));
    return Array.isArray(data?.skills) ? data.skills : DEFAULT_SKILLS;
  } catch (_) { return DEFAULT_SKILLS; }
}

async function writeSkills(skills) {
  await fs.mkdir(BRAIN_DIR, { recursive: true });
  const temp = `${SKILLS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ version: 1, skills }, null, 2), 'utf8');
  await fs.rename(temp, SKILLS_PATH);
}

async function saveSkill(input = {}) {
  const name = clean(input.name, 80);
  const instruction = clean(input.instruction, 2400);
  if (!name || !instruction) throw new Error('技能名稱與操作原則不可為空。');
  const skills = await readSkills();
  const id = clean(input.id, 80) || `skill-${Date.now().toString(36)}`;
  const skill = { id, name, instruction, updatedAt: Date.now() };
  const index = skills.findIndex(item => item.id === id || item.name === name);
  if (index >= 0) skills[index] = skill; else skills.unshift(skill);
  await writeSkills(skills.slice(0, 40));
  return skill;
}

module.exports = { readSkills, saveSkill };
