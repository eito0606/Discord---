// validate-test.js — バリデーション関数の動作テスト用スクリプト
function validateAnswer(rawAnswer, question) {
    const normalized = rawAnswer.replace(/[０-９]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
    });
    if (question.type === 'single') {
        const num = parseInt(normalized, 10);
        if (isNaN(num) || num < 1 || num > question.options.length) return { valid: false, message: '範囲外' };
        if (normalized.trim().length !== 1) return { valid: false, message: '複数桁' };
        return { valid: true, value: num };
    } else if (question.type === 'multiple') {
        if (!/^\d+$/.test(normalized.trim())) return { valid: false, message: '非数字' };
        const digits = normalized.trim().split('').map(Number);
        for (const d of digits) { if (d < 1 || d > question.options.length) return { valid: false, message: '範囲外' }; }
        const u = new Set(digits);
        if (u.size !== digits.length) return { valid: false, message: '重複' };
        return { valid: true, value: digits };
    } else if (question.type === 'free') {
        if (!rawAnswer || rawAnswer.trim().length === 0) return { valid: false, message: '空' };
        return { valid: true, value: rawAnswer.trim() };
    }
    return { valid: true, value: rawAnswer };
}

const q1 = { type: 'single', options: ['a', 'b', 'c', 'd', 'e'] };
const q2 = { type: 'multiple', options: ['a', 'b', 'c', 'd', 'e', 'f'] };
const q5 = { type: 'free', options: [] };

let pass = 0, fail = 0;
function assert(name, result, expected) {
    if (result.valid === expected) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}: got valid=${result.valid}, expected=${expected}`); }
}

console.log('--- single選択テスト ---');
assert('正常(3)', validateAnswer('3', q1), true);
assert('全角(３)', validateAnswer('３', q1), true);
assert('範囲外(7)', validateAnswer('7', q1), false);
assert('複数桁(12)', validateAnswer('12', q1), false);
assert('文字(abc)', validateAnswer('abc', q1), false);

console.log('--- multiple選択テスト ---');
assert('正常(124)', validateAnswer('124', q2), true);
assert('全角(１２４)', validateAnswer('１２４', q2), true);
assert('重複(112)', validateAnswer('112', q2), false);
assert('範囲外含む(127)', validateAnswer('127', q2), false);
assert('区切り(1,2)', validateAnswer('1,2', q2), false);
assert('単一(6)', validateAnswer('6', q2), true);

console.log('--- free記述テスト ---');
assert('正常テキスト', validateAnswer('テスト意見', q5), true);
assert('なし', validateAnswer('なし', q5), true);
assert('空文字', validateAnswer('', q5), false);

console.log(`\n結果: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
