// Deep QA pass: syntax of inline scripts, getElementById targets, duplicate IDs.
const fs = require('fs');
const { execFileSync } = require('child_process');
const dir = '/home/hatch/workspace/secure-course-player/';
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; } else { fail++; console.log('FAIL: ' + name + (extra ? ' -> ' + extra : '')); } }

for (const page of ['index.html', 'float.html']) {
  const html = fs.readFileSync(dir + page, 'utf8');
  const scripts = [];
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m; while ((m = re.exec(html))) scripts.push(m[1]);
  check(page + ' has inline scripts', scripts.length > 0, 'found ' + scripts.length);
  scripts.forEach((s, i) => {
    const tmp = '/tmp/qa-' + page + '-' + i + '.js';
    fs.writeFileSync(tmp, s);
    let ok = true;
    try { execFileSync('node', ['--check', tmp], { stdio: 'pipe' }); } catch (e) { ok = false; console.log(e.stderr.toString().split('\n').slice(0, 4).join('\n')); }
    check(page + ' script#' + i + ' syntax', ok);
  });
  const ids = {};
  const idRe = / id="([^"]+)"/g;
  while ((m = idRe.exec(html))) ids[m[1]] = (ids[m[1]] || 0) + 1;
  const dups = Object.keys(ids).filter((k) => ids[k] > 1);
  console.log(page + ' duplicate ids: ' + (dups.length ? dups.join(', ') : 'none'));
  const wanted = new Set();
  const gRe = /getElementById\('([^']+)'\)/g;
  while ((m = gRe.exec(html))) wanted.add(m[1]);
  const missing = [...wanted].filter((id) => !ids[id]);
  console.log(page + ' getElementById missing targets: ' + (missing.length ? missing.join(', ') : 'none'));
  check(page + ' all getElementById targets exist', missing.length === 0, missing.join(','));
}
console.log('QA TOTAL PASS=' + pass + ' FAIL=' + fail);
