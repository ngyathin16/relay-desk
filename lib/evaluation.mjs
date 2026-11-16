import { analyze } from './analyze.mjs';

export function evaluate(cases, articles) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('The evaluation corpus is missing or empty.');
  const results = cases.map(({ id, ticket, language, expected }) => {
    if (typeof id !== 'string' || typeof ticket !== 'string' || !['en', 'zh'].includes(language)
        || !['answered', 'needs-information', 'no-answer', 'blocked'].includes(expected?.status)
        || !Array.isArray(expected.sourceIds) || expected.sourceIds.some((sourceId) => !articles.some((article) => article.id === sourceId))) {
      throw new Error('The evaluation corpus contains an invalid case.');
    }
    const output = analyze(ticket, language, articles);
    const actual = { status: output.status, sourceIds: output.sources.map(({ id: sourceId }) => sourceId).sort() };
    return { id, language, expected, actual, passed: actual.status === expected.status && JSON.stringify(actual.sourceIds) === JSON.stringify([...expected.sourceIds].sort()) };
  });
  return { mode: 'extractive', total: results.length, passed: results.filter((row) => row.passed).length, results,
    scope: 'Small synthetic development regression checks of the extractive baseline against self-authored fictional product documentation. These cases informed implementation; they are not held-out tests, a live-model benchmark, or evidence of production accuracy.' };
}
