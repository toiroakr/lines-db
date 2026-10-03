// Writes the report of the latest run as one HTML file that opens in a browser as it is: the runner's
// report is a JSON file and a directory of artifacts, which a browser cannot show without unpacking
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** As much of the runner's report as the page shows */
interface Source {
  file: string;
  line: number;
}
interface Artifact {
  id: string;
  kind: string;
  mediaType: string;
  path: string;
}
interface Step {
  api: string;
  /** The ids of the artifacts the step made, such as the screenshot `app.screenshot()` took */
  artifacts: string[];
  label?: string;
  status: string;
  durationMs?: number;
  source?: Source;
}
interface Attempt {
  status: string;
  durationMs?: number;
  artifacts: Artifact[];
  error?: { code?: string; category?: string; message: string; source?: Source };
  failure?: { url?: string; screen?: string; screenshot?: string };
  steps: Step[];
}
interface Result {
  titlePath: string[];
  file: string;
  status: string;
  selected: boolean;
  skip?: { reason?: string };
  attempts: Attempt[];
}
interface Run {
  status: string;
  startedAt: string;
  finishedAt: string;
  runner: { name: string; version: string };
  vcs?: { branch?: string; commit?: string };
  results: Result[];
}

const dir = fileURLToPath(new URL('.e2e/', import.meta.url));
const out = process.argv[2] ?? `${dir}report.html`;
const { run } = JSON.parse(readFileSync(`${dir}report.json`, 'utf8')) as { run: Run };

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => entities[c]);
const duration = (ms: number | undefined) =>
  ms === undefined ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const where = (source: Source | undefined) => (source ? `${source.file}:${source.line}` : '');
const artifact = (attempt: Attempt, id: string) => attempt.artifacts.find((candidate) => candidate.id === id);
const pathOf = (entry: Artifact) => `${dir}artifacts/${entry.path}`;
const textOf = (entry: Artifact) => (existsSync(pathOf(entry)) ? readFileSync(pathOf(entry), 'utf8') : undefined);
const dataUri = (entry: Artifact) =>
  existsSync(pathOf(entry))
    ? `data:${entry.mediaType};base64,${readFileSync(pathOf(entry)).toString('base64')}`
    : undefined;

const mark: Record<string, string> = { passed: '✓', failed: '✗', skipped: '–', flaky: '!' };
const selected = run.results.filter((result) => result.selected);
const counts = Object.entries(
  selected.reduce<Record<string, number>>(
    (all, result) => ({ ...all, [result.status]: (all[result.status] ?? 0) + 1 }),
    {},
  ),
);

function attemptDetails(attempt: Attempt) {
  const parts: string[] = [];
  if (attempt.error) {
    parts.push(
      `<p class="where">${escape(attempt.error.code ?? attempt.error.category ?? 'error')} · ${escape(where(attempt.error.source))}</p>`,
      `<pre class="error">${escape(attempt.error.message)}</pre>`,
    );
  }
  parts.push(
    '<ol class="steps">',
    ...attempt.steps.map((step) => {
      const shots = step.artifacts
        .map((id) => artifact(attempt, id))
        .filter((entry) => entry?.kind === 'screenshot')
        .map((entry) => entry && dataUri(entry))
        .filter((uri) => uri !== undefined)
        .map((uri) => `<img class="shot" alt="${escape(step.label ?? 'A screenshot')}" src="${uri}">`);
      return `<li class="${escape(step.status)}"><span class="mark">${mark[step.status] ?? '·'}</span> <code>${escape(step.api)}</code> ${escape(step.label ?? '')} <span class="muted">${duration(step.durationMs)} · ${escape(where(step.source))}</span>${shots.join('')}</li>`;
    }),
    '</ol>',
  );
  const failure = attempt.failure;
  if (failure) {
    if (failure.url) parts.push(`<p class="muted">At ${escape(failure.url)}</p>`);
    const screenshot = failure.screenshot && artifact(attempt, failure.screenshot);
    const image = screenshot && dataUri(screenshot);
    if (image) parts.push(`<img class="shot" alt="The screen at the failure" src="${image}">`);
    const screen = failure.screen && artifact(attempt, failure.screen);
    const screenText = screen && textOf(screen);
    if (screenText) {
      parts.push(
        `<details><summary>The screen at the failure, as text</summary><pre>${escape(screenText)}</pre></details>`,
      );
    }
  }
  // Not for a passing test: its trace adds hundreds of kilobytes for little to look at
  if (attempt.status !== 'passed') {
    for (const entry of attempt.artifacts.filter((candidate) => candidate.kind === 'trace')) {
      const uri = dataUri(entry);
      if (uri) {
        parts.push(
          `<p><a download="trace.zip" href="${uri}">Download the trace</a> <span class="muted">and open it in <a href="https://trace.playwright.dev">trace.playwright.dev</a></span></p>`,
        );
      }
    }
  }
  return parts.join('\n');
}

const rows = selected
  .map((result) => {
    const attempt = result.attempts.at(-1);
    const title = result.titlePath.join(' › ');
    return `<details class="test ${escape(result.status)}"${result.status === 'failed' ? ' open' : ''}>
<summary><span class="mark">${mark[result.status] ?? '·'}</span> <span class="title">${escape(title)}</span> <span class="muted">${escape(result.file)} · ${duration(attempt?.durationMs)}</span></summary>
<div class="body">${attempt ? attemptDetails(attempt) : `<p class="muted">${escape(result.skip?.reason ?? 'Not run')}</p>`}</div>
</details>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>e2e report · ${escape(run.status)}</title>
<style>
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a202c; --muted: #718096; --line: #e2e8f0; --panel: #f7fafc;
  --pass: #2f855a; --fail: #c53030; --skip: #718096; }
@media (prefers-color-scheme: dark) { :root { --bg: #161b26; --fg: #e2e8f0; --muted: #8b95a7; --line: #2a3242;
  --panel: #1d2330; --pass: #68d391; --fail: #fc8181; --skip: #8b95a7; } }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width: 1040px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
.muted { color: var(--muted); font-size: 12px; }
.counts span { margin-right: 12px; }
.test { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; background: var(--panel); }
.test > summary { cursor: pointer; padding: 10px 12px; list-style: none; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.test > summary::-webkit-details-marker { display: none; }
.title { font-weight: 600; }
.body { padding: 0 12px 12px; border-top: 1px solid var(--line); }
.mark { font-weight: 700; }
.passed > summary .mark, li.passed .mark { color: var(--pass); }
.failed > summary .mark, li.failed .mark, .error { color: var(--fail); }
.skipped > summary .mark { color: var(--skip); }
pre { overflow: auto; padding: 8px; border-radius: 6px; background: var(--bg); border: 1px solid var(--line); font-size: 12px; }
code, pre { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
.steps { padding-left: 20px; }
.shot { display: block; max-width: 100%; margin: 6px 0 10px; border: 1px solid var(--line); border-radius: 6px; }
a { color: inherit; }
</style>
</head>
<body>
<main>
<h1><span class="mark ${run.status === 'passed' ? 'passed' : 'failed'}">${run.status === 'passed' ? '✓' : '✗'}</span> e2e: ${escape(run.status)}</h1>
<p class="counts">${counts.map(([status, count]) => `<span>${escape(status)} ${count}</span>`).join('')}<span class="muted">${duration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}</span></p>
<p class="muted">${escape(run.vcs?.branch ?? '')} · ${escape((run.vcs?.commit ?? '').slice(0, 7))} · ${escape(run.runner.name)} ${escape(run.runner.version)} · ${escape(run.startedAt)}</p>
${rows}
</main>
</body>
</html>
`;

writeFileSync(out, html);
