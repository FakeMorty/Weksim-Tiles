import { letterGrade, isFullCombo, isAllPerfect, judgedTaps } from '../src/game/grade.js';

let fail = 0;
function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { console.log('FAIL ' + name); fail++; }
}

check('SS at 100', letterGrade({ failed: false, acc: 100 }) === 'SS');
check('S at 95', letterGrade({ failed: false, acc: 95 }) === 'S');
check('A at 90', letterGrade({ failed: false, acc: 90 }) === 'A');
check('B at 80', letterGrade({ failed: false, acc: 80 }) === 'B');
check('C at 70', letterGrade({ failed: false, acc: 70 }) === 'C');
check('D at 60', letterGrade({ failed: false, acc: 60 }) === 'D');
check('F at 59', letterGrade({ failed: false, acc: 59 }) === 'F');
check('failed is F even at 100', letterGrade({ failed: true, acc: 100 }) === 'F');

const ap = { failed: false, marvelous: 10, perfects: 2, greats: 0, goods: 0, oks: 0, misses: 0 };
check('AP', isAllPerfect(ap) && isFullCombo(ap));
const fc = { failed: false, marvelous: 8, perfects: 0, greats: 1, goods: 0, oks: 1, misses: 0 };
check('FC not AP', isFullCombo(fc) && !isAllPerfect(fc));
const miss = { failed: false, marvelous: 8, perfects: 0, greats: 0, goods: 0, oks: 0, misses: 1 };
check('miss not FC', !isFullCombo(miss));
const empty = { failed: false, marvelous: 0, perfects: 0, greats: 0, goods: 0, oks: 0, misses: 0 };
check('empty not FC', !isFullCombo(empty));
check('judged taps', judgedTaps(miss) === 9);

if (fail) {
  console.log('\n' + fail + ' failed');
  process.exit(1);
}
console.log('\nAll grade tests passed');
