'use strict';

// Deliberately narrow, fail-closed eligibility. A Dreaming proposal is untrusted
// text: it cannot declare its own risk level or supply its own validation result.
const HIGH_RISK = /\b(?:deploy|deployment|release|publish|production|prod|database|migration|sql|delete|remove|wipe|erase|drop|reset|force|sudo|chmod|chown|permission|privilege|auth|login|password|credential|secret|api.?key|token|payment|billing|transfer|bank|security|firewall|ssh|adb|install|uninstall|git\s+(?:push|reset|clean|merge)|rm\s+-|curl|wget|eval|exec|systemctl|service|kill)\b|(?:部署|發佈|發布|上線|正式環境|資料庫|遷移|刪除|清除|重置|強制|權限|帳號|登入|密碼|金鑰|憑證|付款|支付|金流|安全設定|防火牆|遠端執行|安裝|卸載|刪檔|退款)/iu;
const LOW_RISK = /\b(?:unit.?test|regression|test|lint|format|prettier|readme|documentation|docs|refactor|css|styling|style|ui|frontend|inspect|diagnos|check|validation)\b|(?:單元測試|回歸測試|測試|檢查|診斷|格式|排版|文件|文案|介面|樣式|前端|重構)/iu;
// Only explicit test-file commands are eligible. A bare npm test or a generic
// success exit code can never validate a candidate.
const NODE_TEST = /^node --test (?:test|tests)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.[cm]?js$/;

function normalizedCommand(value) {
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) value = value.join(' ');
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ').replace(/^\`([^\`]+)\`$/, '$1');
  return text.length <= 240 && NODE_TEST.test(text) && !text.includes('..') ? text : null;
}
function eligibility(skill) {
  const context = [skill?.title, skill?.problem, ...(skill?.steps || []), ...(skill?.triggers || [])].join(' ');
  const body = context + ' ' + (skill?.checks || []).join(' ');
  const high = HIGH_RISK.test(body);
  const commands = [...new Set((skill?.checks || []).map(normalizedCommand).filter(Boolean))];
  // A filename containing “test” must not by itself classify an unknown Skill as safe.
  const low = !high && LOW_RISK.test(context) && commands.length > 0;
  return {
    eligible: low,
    risk: high ? 'high' : low ? 'low' : 'review',
    commands: low ? commands : [],
    reason: high ? 'sensitive-operation' : !commands.length ? 'no-specific-acceptance-test' : low ? 'scoped-test' : 'manual-risk-review'
  };
}
function commandFromEvent(event) {
  const info = event?.info || {};
  const params = info.parameters || {};
  return normalizedCommand(params.command ?? params.cmd ?? info.command);
}
function count(summary, key) {
  const re = new RegExp('(?:^|\\n)\\s*(?:#|ℹ)?\\s*' + key + '\\s+(\\d+)\\s*(?:\\r?\\n|$)', 'im');
  const match = String(summary || '').match(re);
  return match ? Number(match[1]) : null;
}
function observedTest(event, priorCommand = null) {
  const command = commandFromEvent(event) || normalizedCommand(priorCommand);
  if (!command) return null;
  const state = String(event?.state || '').toLowerCase();
  if (!['completed', 'complete', 'done', 'success', 'succeeded', 'failed', 'error'].includes(state)) return null;
  const info = event?.info || {};
  if (!Number.isInteger(info.exitCode)) return null;
  const output = typeof info.output === 'string' ? info.output :
    typeof info.aggregatedOutput === 'string' ? info.aggregatedOutput : '';
  const tests = count(output, 'tests'), passed = count(output, 'pass'), failed = count(output, 'fail');
  // An exit code alone is not proof. Require the runner's explicit test summary.
  const validSummary = Number.isInteger(tests) && tests > 0 &&
    Number.isInteger(passed) && Number.isInteger(failed) &&
    tests === passed + failed;
  return {
    command, outcome: info.error || info.exitCode !== 0 || ['failed', 'error'].includes(state)
      ? 'failed' : validSummary && failed === 0 ? 'passed' : 'unverified',
    tests: validSummary ? tests : 0,
    passed: validSummary ? passed : 0,
    failed: validSummary ? failed : 0
  };
}
function recentAcceptedRuns(skill, command) {
  const evidence = Array.isArray(skill?.evidence) ? skill.evidence : [];
  const lastFailure = evidence.findLastIndex(e => e.outcome === 'failed');
  return new Set(evidence.slice(lastFailure + 1)
    .filter(e => e.kind === 'acceptance-test' && e.source === 'runtime-validated' &&
      e.outcome === 'passed' && e.command === command && typeof e.turnId === 'string')
    .map(e => e.turnId)).size;
}
module.exports = { eligibility, normalizedCommand, commandFromEvent, observedTest, recentAcceptedRuns };
