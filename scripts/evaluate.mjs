import { readFileSync } from 'node:fs';
import { evaluate } from '../lib/evaluation.mjs';

try {
  const articles = JSON.parse(readFileSync(new URL('../content/knowledge.json', import.meta.url), 'utf8'));
  const cases = JSON.parse(readFileSync(new URL('../content/evaluation.json', import.meta.url), 'utf8'));
  const report = evaluate(cases, articles);

  for (const result of report.results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} (${result.language})`);
    if (!result.passed) {
      console.log(`  Expected: ${JSON.stringify(result.expected)}`);
      console.log(`  Actual:   ${JSON.stringify(result.actual)}`);
    }
  }

  console.log(`\n${report.passed}/${report.total} cases passed (${(report.passed / report.total * 100).toFixed(1)}%).`);
  console.log('A case passes only when both the status and the exact set of cited article IDs match.');
  console.log(report.scope);
  console.log('This does not score answer completeness, translation quality, live-model grounding, or resistance to unseen attacks.');
  process.exitCode = report.passed === report.total ? 0 : 1;
} catch (error) {
  console.error(`Evaluation could not run: ${error.message}`);
  process.exitCode = 1;
}
