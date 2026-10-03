import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import ts from 'typescript';
import { purposes, homeFiles } from './file-guide.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const repo = 'https://github.com/yokeloop/mypi';
const tag = 'v' + version;
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const generated = new Set(['docs/FILEMAP.md', 'docs/reports/m1-report.html']);
const files = paths.map(path => {
  const source = generated.has(path) ? '' : readFileSync(path, 'utf8');
  const symbols = [], imports = [], cases = [];
  if (/\.(ts|mjs|cjs)$/.test(path)) {
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    function visit(n) {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isClassDeclaration(n)) && n.name)
        symbols.push(n.name.getText(tree));
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text);
      if (ts.isCallExpression(n) && n.expression.getText(tree) === 'test' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) cases.push(n.arguments[0].text);
      ts.forEachChild(n, visit);
    }
    visit(tree);
  }
  let purpose = purposes[path];
  if (!purpose && path.startsWith('test/')) purpose = (path.includes('/fast/') ? 'Дешёвые проверки правил без subprocess из теста. ' : 'Реальная интеграционная граница на временных данных. ') + cases.join('; ');
  if (!purpose && path.startsWith('docs/evidence/')) purpose = 'Сохранённое доказательство/исход: ' + path.split('/').at(-1) + '. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: ' + (source.split('\n').find(s => s.trim()) ?? '').slice(0,210).trimEnd();
  if (!purpose) throw Error('Missing file explanation: ' + path);
  return { path, purpose, symbols: [...new Set(symbols)], imports, cases, source,
    lines: source ? source.split('\n').length - (source.endsWith('\n') ? 1 : 0) : null,
    url: repo + '/blob/' + tag + '/' + path.split('/').map(encodeURIComponent).join('/') };
});
const known = new Set(paths);
for (const file of files) file.localImports = file.imports.filter(x => x.startsWith('.')).map(x => posix.normalize(posix.join(posix.dirname(file.path), x)).replace(/\.js$/, '.ts')).filter(x => known.has(x));
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function treePaths(items) {
  const root = {};
  for (const path of items) { let node=root; for (const part of path.split('/')) node=node[part]??={}; }
  function walk(node, prefix='') { const entries=Object.entries(node); return entries.flatMap(([name, children],i)=>{
    const last=i===entries.length-1, dir=Object.keys(children).length>0;
    return [prefix+(last?'└── ':'├── ')+name+(dir?'/':''), ...walk(children,prefix+(last?'    ':'│   '))];
  }); }
  return walk(root).join('\n');
}
let md = '# Карта файлов mypi ' + version + '\n\nСгенерировано `mise exec -- node docs/reports/build-report.mjs` из Git-инвентаря.\n'+
  'Релиз-кандидат, не окончательная приёмка M1. `home/` в Git движка отсутствует.\n\n## Движок — полное дерево\n\n```text\n'+treePaths(paths)+'\n```\n\n';
for (const f of files) md += '### `'+f.path+'`\n\n'+f.purpose+'\n\n'+(f.symbols.length?'Символы: '+f.symbols.map(x=>'`'+x+'`').join(', ')+'.\n\n':'')+'[Исходник]('+f.url+').\n\n';
md+='## Home — шаблоны, не созданное личное хранилище\n\n';
for (const [path,body,writer] of homeFiles) md+='### `home/'+path+'`\n\n'+body+' Записывает/читает: '+writer+'.\n\n';
md+='## Вне home\n\n`$XDG_STATE_HOME/mypi/state.sqlite3` (fallback `~/.local/state/mypi/state.sqlite3`) — authoritative DB. '+
  'Backup directory: `state.sqlite3`, optional `context.bundle`, `manifest.json` с checksum. Это не Git движка и не Git home.\n\n'+
  '`dist/` — сгенерированные JS из src/test, SQL и build-state.json; `node_modules/` — установленные зависимости; `.git/` — история движка. Эти деревья не являются собственными исходниками и не перечисляются по внутренним объектам/пакетам.\n';
writeFileSync('docs/FILEMAP.md',md);
const commonCSS = readFileSync('docs/reports/page.css','utf8');
const schema = readFileSync('src/infrastructure/database/migrations/001-initial.sql','utf8');
const homeTree = `mypi/home/                         ← отдельный Git; никогда не в Git движка
├── .git/                           ← история контекста
├── MEMORY.md                       ← глобальные факты
├── inbox/<UTC>-<UUID>.md            ← исходные capture
├── notes/<UTC>-<UUID>.md            ← глобальные заметки
├── journal/YYYY-MM.jsonl           ← общий append-only журнал
├── requests/REQ-number-slug/       ← запросы без проекта
│   ├── source.md                   ← неизменяемый исходник
│   └── <artifact-path>             ← материалы/версии по потребности
├── projects/<org>/
│   ├── MEMORY.md                   ← память организации
│   ├── notes/<UTC>-<UUID>.md
│   └── <project>/
│       ├── MEMORY.md               ← память проекта
│       ├── context.md              ← необязательный glossary
│       ├── notes/<UTC>-<UUID>.md
│       ├── errors.md               ← ошибки/тупики, append-only
│       ├── requests/CODE-number-slug/
│       │   ├── source.md
│       │   └── <artifact-path>     ← например research/result-v2.md
│       └── legacy-journal/*.md     ← только после явного импорта
└── legacy/                        ← только после явного импорта
    ├── projects.json              ← архив, НЕ текущий реестр
    ├── import.json                ← receipt + hash
    └── <original-path>`;
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>mypi ${version}: релиз-кандидат и карта кода</title><style>${commonCSS}
main{max-width:1180px}nav{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:6px}.big{font-size:26px}.small{font-size:13px;color:var(--soft)}button,input,select{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:7px 10px}button{cursor:pointer}button:hover,button[aria-current=true]{color:var(--primary);border-color:var(--primary)}button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--primary);outline-offset:2px}details{margin:10px 0;padding:10px 14px;border:1px solid var(--line);border-radius:6px}summary{cursor:pointer;font-weight:600}.browser{display:grid;grid-template-columns:310px minmax(0,1fr);gap:16px;margin:18px 0}.tree{max-height:690px;overflow:auto;border:1px solid var(--line);padding:8px;background:var(--panel)}.tree details{border:0;padding:0 0 0 10px;margin:4px 0}.tree summary{font-size:14px}.tree button{display:block;text-align:left;border:0;font:12px/1.5 var(--mono);padding:4px;max-width:100%;overflow-wrap:anywhere}.controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.controls input{flex:1;min-width:160px}.symbols{font:13px/1.7 var(--mono);overflow-wrap:anywhere}.code{max-height:640px;font-size:12px}.schema{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:12px}.schema svg{display:block;width:100%}.schema rect{fill:var(--paper);stroke:var(--line)}.schema text{fill:var(--ink);font:15px var(--sans)}.schema path{stroke:var(--primary);fill:none;stroke-width:2}.nodebuttons{display:flex;gap:8px;flex-wrap:wrap}.track{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.track div{padding:12px;border:1px solid var(--line);border-radius:6px}.track small{display:block}.notice{border-left-color:var(--accent)}#file-path{font:15px var(--mono);overflow-wrap:anywhere}#file-source{white-space:pre}#links button{font-size:12px;margin:3px}.home-list summary{font:13px/1.5 var(--mono);overflow-wrap:anywhere}@media(max-width:780px){.browser,.cards{grid-template-columns:1fr}.tree{max-height:260px}.track{grid-template-columns:1fr 1fr}.schema{padding:0}}
</style></head><body><main>
<header><p class="kind">Отчёт · релиз-кандидат · 2026-10-03</p><h1>mypi ${version}: как устроены файлы и код</h1><dl class="meta"><div><dt>Организация</dt><dd>yokeloop</dd></div><div><dt>Тикет</dt><dd>нет</dd></div><div><dt>Автор</dt><dd>pi (omarchy)</dd></div><div><dt>Версия</dt><dd>${tag}</dd></div></dl></header>
<div class="answer"><p><strong>Результат.</strong> Node.js CLI для памяти, проектов и простого учёта запросов подготовлен как релиз-кандидат для твоей проверки. <a href="${repo}/releases/tag/${tag}">GitHub Release</a> · <a href="${repo}/pull/1">PR #1</a> · <a href="${repo}/blob/${tag}/docs/RELEASE.md">Установка и ограничения</a>.</p><p><strong>Что не обещаем:</strong> окончательная приёмка M1 ещё открыта. Независимый издатель обязательного check (GitHub App) не зарегистрирован, защита от подделки одноимённого Actions check не испытана. Это не production-ready и не завершённый trusted merge gate.</p></div>
<div class="cards"><div class="card"><div class="big">19 / 19</div>8 fast + 11 boundary<div class="small">реальные SQLite, FS, Git и Node CLI</div></div><div class="card"><div class="big">7,34 с</div>hosted verify на Ubuntu 24.04<div class="small">один замер, не p95; бюджет 30 с</div></div><div class="card"><div class="big">${files.length} файлов</div>в каталоге ниже<div class="small">собственные файлы и evidence; не node_modules</div></div></div>
<nav aria-label="Разделы"><a href="#architecture">Схема кода</a><a href="#files">Файлы движка</a><a href="#home">Файлы home</a><a href="#storage">БД и backup</a><a href="#flows">Путь команды</a><a href="#checks">Проверки</a><a href="#limits">Ограничения</a></nav>
<h2>Что сделано</h2><p>Один pnpm-пакет: TypeScript strict, Node 24 LTS, ESM/tsc, SQLite + better-sqlite3. Реализованы memory, capture, notes/errors, journal, проекты, карточки запросов, mutable справочник статусов, импорт legacy, backup/restore. Flow и LLM-исполнение в продукт не добавлялись.</p>
<h2 id="architecture">Схема кода: кто вызывает кого</h2><p>Порт — небольшой интерфейс нужной операции; адаптер — её конкретная реализация на SQLite, FS или Git. App собирает эти части, а CLI только разбирает команду и выводит ответ.</p>
<div class="schema"><svg viewBox="0 0 1020 330" role="img" aria-label="CLI вызывает app, app связывает предметные модули с адаптерами и хранилищами"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 Z" style="fill:var(--primary);stroke:none"/></marker></defs><rect x="15" y="20" width="185" height="70" rx="5"/><text x="35" y="48">CLI</text><text x="35" y="73">argv → JSON / exit</text><path d="M200 55 H250" marker-end="url(#arrow)"/><rect x="250" y="20" width="245" height="70" rx="5"/><text x="270" y="48">App</text><text x="270" y="73">сценарии и композиция</text><path d="M495 55 H550" marker-end="url(#arrow)"/><rect x="550" y="20" width="455" height="70" rx="5"/><text x="570" y="48">Projects · Requests · Memory · Inbox</text><text x="570" y="73">Knowledge: journal / notes / errors</text><path d="M775 90 V135" marker-end="url(#arrow)"/><rect x="550" y="135" width="455" height="65" rx="5"/><text x="570" y="164">Порты → SQL / FS / Git / JSONL adapters</text><text x="570" y="186">правила домена не делают IO</text><path d="M650 200 V245" marker-end="url(#arrow)"/><path d="M895 200 V245" marker-end="url(#arrow)"/><rect x="535" y="245" width="235" height="65" rx="5"/><text x="555" y="273">SQLite — состояние</text><text x="555" y="296">вне обоих Git</text><rect x="790" y="245" width="215" height="65" rx="5"/><text x="810" y="273">home — контекст</text><text x="810" y="296">отдельный Git</text><rect x="15" y="145" width="440" height="140" rx="5"/><text x="35" y="176">DB-only: транзакция, без обязательного home</text><text x="35" y="207">Смешанные операции: явный partial</text><text x="35" y="238">Core не запускает LLM или flow</text><text x="35" y="269">Нет универсального recovery engine</text></svg></div>
<div class="nodebuttons"><button data-open="src/cli/main.ts">Открыть CLI</button><button data-open="src/app/create-workspace.ts">Открыть App</button><button data-open="src/modules/requests/public.ts">Правила Requests</button><button data-open="src/infrastructure/git/context-git.ts">Git adapter</button></div>
<h2 id="files">Файлы движка — интерактивный справочник</h2><p>Выбери файл в дереве. Для каждого указаны назначение, реально найденные функции/типы, зависимости и исходный текст. Код показывается как текст и <strong>не исполняется</strong>. Исторические документы отмечены; raw evidence не принимаются за текущее состояние.</p>
<div class="controls"><label for="filter">Поиск</label><input id="filter" placeholder="Например request-work, scripts или backup"><button id="only-src">Только src</button><button id="only-scripts">Только scripts</button><button id="all-files">Все файлы</button><span id="count" class="small"></span></div>
<div class="browser"><aside id="tree" class="tree" aria-label="Дерево файлов"></aside><section class="card" id="viewer" aria-live="polite"><h3 id="file-path"></h3><p id="purpose"></p><p id="file-meta" class="small"></p><h3>Какие функции и типы содержит</h3><div id="symbols" class="symbols"></div><h3>Связанные файлы</h3><div id="links"></div><p id="externals" class="small"></p><details id="source-detail"><summary>Показать исходный код / содержимое целиком</summary><pre class="code"><code id="file-source"></code></pre></details><p><a id="github-source" target="_blank" rel="noopener">Этот файл в релизе на GitHub</a></p></section></div>
<details><summary>Полное статическое дерево движка</summary><pre>${esc(treePaths(paths))}</pre></details>
<div class="table"><table><thead><tr><th>Не входит в собственные исходники</th><th>Что содержит</th></tr></thead><tbody><tr><td><code>dist/</code></td><td>Результат tsc: JS для src/test, SQL-миграция, build-state.json. Пересобирается, не коммитится.</td></tr><tr><td><code>node_modules/</code></td><td>Установленные pinned зависимости. Чужой код библиотек не переписывается и не перечисляется в этом справочнике.</td></tr><tr><td><code>.git/</code></td><td>Git metadata именно движка: refs, objects, index и config. Не путать с home/.git.</td></tr><tr><td><code>projects/</code></td><td>Игнорируемые рабочие клоны пользовательских проектов. Не src/modules/projects и не home/projects.</td></tr><tr><td><code>home/</code></td><td>Отдельный пользовательский Git внутри клона, не submodule. Его данные не уходят при публикации движка.</td></tr></tbody></table></div>
<h2 id="home">Home: папки, файлы и содержимое</h2><p>Это <strong>схема возможных файлов</strong>, не список созданных личных данных. Bootstrap создаёт DB и Git контекста; остальные файлы появляются по соответствующим командам. Личный home при разработке не создавался.</p><pre>${esc(homeTree)}</pre>
<div class="home-list">${homeFiles.map(([p,d,w])=>`<details><summary>home/${esc(p)}</summary><p>${esc(d)}</p><p><strong>Кто использует:</strong> ${esc(w)}</p></details>`).join('\n')}</div>
<details><summary>Примеры содержимого — синтетические, не личные данные</summary><pre><code>MEMORY.md:
# Memory
- "Использовать pnpm.\\nПроверять изменения перед публикацией."

source.md / inbox/*.md:
точная исходная формулировка, без добавленного заголовка

notes/*.md:
# Тема

Текст заметки

journal/YYYY-MM.jsonl (одна физическая строка):
{"at":"2026-10-03T12:00:00Z","scope":{"type":"request","key":"MP-1"},"event_type":"note","text":"Результат проверен","artifacts":["projects/org/project/requests/MP-1-demo/research/result-v1.md"]}

legacy/import.json:
{"version":1,"sha256":"…"}</code></pre></details>
<p>Нет status.md, отдельного журнала задачи и копии progress в SQL. Git хранит версии контекста, но не восстанавливает всю систему: БД копируется отдельно. Опубликованный артефакт получает новый путь для новой версии; старые доказательства не переписываются.</p>
<h2 id="storage">БД и резервная копия — вне home</h2><div class="cards"><div class="card"><strong>SQLite</strong><p><code>$XDG_STATE_HOME/mypi/state.sqlite3</code></p><p class="small">Fallback: ~/.local/state/mypi/state.sqlite3. Authority организаций, проектов, карточек и статусов. Создаваемые каталоги 0700, DB 0600.</p></div><div class="card"><strong>Context Git</strong><p><code>mypi/home/.git</code></p><p class="small">Коммиты только явных файлов; чужой staged diff сохраняется. Source immutable, journal/errors append-only. Hooks и преобразования текста отключены.</p></div><div class="card"><strong>Backup directory</strong><p><code>state.sqlite3<br>context.bundle (если есть HEAD)<br>manifest.json</code></p><p class="small">SHA256, проверка сохранённого checkout и ссылок. Restore только в отсутствующие DB/home; существующие данные не заменяются.</p></div></div>
<pre>organizations ──&lt; projects ──&lt; requests &gt;── request_statuses
id, slug          id, org_id   id              id, code
                  slug, code  project_id?     is_terminal
                  checkout?   number, title, status_id
                              context_dir, created_at, updated_at</pre>
<p>id — внутренняя идентичность, number — номер проекта или REQ. MAX+1 вычисляется внутри BEGIN IMMEDIATE. Начальный status всегда явно указан; справочник изменяемый, без enum/pipeline. Terminal не reopen, тот же статус — no-op.</p><details><summary>Фактический SQL, включая ограничения и seed</summary><pre><code>${esc(schema)}</code></pre></details>
<h2 id="flows">Как команда проходит через файлы</h2><div class="schema"><svg viewBox="0 0 1000 210" role="img" aria-label="Путь request create от CLI до source DB journal Git"><rect x="10" y="20" width="205" height="65" rx="5"/><text x="25" y="47">cli/main → command</text><text x="25" y="70">parse argv</text><path d="M215 53 H260" marker-end="url(#arrow)"/><rect x="260" y="20" width="205" height="65" rx="5"/><text x="275" y="47">run → execute-command</text><text x="275" y="70">выбрать API</text><path d="M465 53 H515" marker-end="url(#arrow)"/><rect x="515" y="20" width="470" height="65" rx="5"/><text x="535" y="47">create-workspace → request-work → Requests</text><text x="535" y="70">resolve scope, source callback и SQL transaction</text><path d="M750 85 V130 H110" marker-end="url(#arrow)"/><rect x="10" y="150" width="975" height="45" rx="5"/><text x="30" y="178">source.md → фиксация DB → journal/YYYY-MM.jsonl → Git commit → JSON результата</text></svg></div>
<p><code>memory add</code>: execute-command → workspace.memory → modules/memory → context-changes → context-files + context-git. <code>project add</code>: run → create-app → projects.public → sqlite-project-store, без Git. <code>warmup</code>: read-only memory родителей + scoped journal/glossary, без inbox соседей.</p>
<h3>Частичный результат: выбери контрольную точку отказа</h3><label for="failure">Исход </label><select id="failure"><option value="4">Всё сохранено</option><option value="1">SQL после source</option><option value="2">Журнал после DB</option><option value="3">Git после журнала</option></select><div class="track" id="track"></div><p id="partial" aria-live="polite"></p><p class="small">Это схема, не исполнение. Реальная ошибка требует сверки: запись журнала могла быть частичной. Нет blind retry, общего rollback или exactly-once audit.</p>
<h2 id="checks">Проверки и исправления</h2><p><a href="https://github.com/yokeloop/mypi/actions/runs/37124664193">Первый успешный hosted verify</a>: 19/19, wall 7,34 с, memory peak 307277824 bytes, tasks peak 34. Это cgroup-метрики внутреннего runner, не p95. Установка и build отдельно.</p>
<ul><li>Независимое статическое review: dangling symlink, версии опубликованных артефактов, история title, коллизии импорта и обход через рабочий JSONL исправлены; исходные ответы не переписывались.</li><li>IPC-test держит writer до source callback; мутация IMMEDIATE → deferred падает по нужному assertion.</li><li>CI review нашёл изменяемый tools/node между sandbox/host. Теперь readonly весь workspace, кроме dist; негативный probe запретил запись и сохранил успешную сборку/19 тестов.</li><li>GitHub AppArmor первоначально запрещал bwrap namespaces. Только на одноразовой VM добавлен профиль для /usr/bin/bwrap; глобальный sysctl не отключался. CPU/RAM/tasks/deadline не повышались.</li><li>Исходный gitignore projects/ исключал и код модуля; теперь /projects/ и /home/ закреплены только за корнем. Свежий Git-снимок проверен.</li><li>Readonly до source, SIGKILL после DB commit, Git index.lock, binary artifacts и backup→restore проверены на временных данных.</li></ul>
<div class="answer notice"><p><strong>Граница готовности.</strong> Обычный CI работает. Но GitHub Actions check можно подделать одноимённым workflow, поэтому его успех не выдаётся за независимый обязательный издатель. App publisher отделён в другом job; environment mypi-gate разрешает только branch main. Пока App не зарегистрирован, trusted check не публикуется и M1 не объявляется окончательно принятой.</p></div>
<h2 id="limits">Что не проверено / не входит в релиз-кандидат</h2><ul><li>Независимый App issuer, required check с его App ID и отрицательная проверка подделки — ещё не введены в эксплуатацию.</li><li>Нет личной миграции/backup пользователя, сетевого sync, flow, агентов и многомашинной работы.</li><li>Не проверены другие ОС, физическое отключение питания, многолетний большой журнал и p95. SIGKILL не равен потере питания.</li><li>JavaScript отчёта проверен на синтаксис; изображение Derive проверяется визуально. Локальная автоматизация Chromium остановилась по deadline даже при уменьшенном параллелизме; проверка кликов не выдана за пройденную, лимиты не повышались.</li><li>Машинный owner и GitHub admin способны изменить файлы/правила; абсолютная защита от них не заявляется.</li></ul>
<h2>Как попробовать</h2><pre><code>git clone https://github.com/yokeloop/mypi.git
cd mypi
git checkout ${tag}
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- node dist/src/cli/main.js --help</code></pre><p>Help не создаёт DB/home. <code>bootstrap</code> — отдельное осознанное действие пользователя. CLI и подробные recovery-команды — <a href="${repo}/blob/${tag}/docs/M1-CLI.md">M1-CLI.md</a>.</p>
<h2>Дальше и просьбы к инженеру</h2><p>Проверь релиз-кандидат и устройство данных. Обычные операции не требуют обязательного request. Для завершения доверенного merge gate остаётся интерактивная регистрация/установка GitHub App; private key не нужно присылать в чат или хранить в Git. Это не блокирует чтение кода и локальную проверку RC.</p>
<footer><p>Самодостаточная карта ${tag}. Источник каталога — git ls-files, назначения — file-guide.mjs, символы — TypeScript AST. Встроенный исходный текст соответствует снимку при генерации; окончательный источник релиза — ссылка на tag у каждого файла. Собственный HTML и FILEMAP не встраиваются рекурсивно.</p><p>Основано на <a href="https://draft.yokeloop.com/artifacts/enqrv4f1">шаблоне Derive v2</a>; derive-page-css v1. Ни один переключатель не выполняет команды и не читает личное home.</p></footer>
<noscript>Без JavaScript доступны основные схемы, полное статическое дерево, home и ссылки на GitHub; интерактивный просмотрщик исходников требует JavaScript.</noscript>
<script>
const files=${JSON.stringify(files).replaceAll('<','\\u003c')};
const byPath=new Map(files.map(f=>[f.path,f]));
const $=id=>document.getElementById(id);
let selected='src/cli/main.ts',prefix='';
function selectFile(path){const f=byPath.get(path);if(!f)return;selected=path;$('file-path').textContent=f.path;$('purpose').textContent=f.purpose;$('file-meta').textContent=(f.lines===null?'Генерируемый документ; см. GitHub':f.lines+' строк; содержимое только для чтения');$('symbols').textContent=f.symbols.length?f.symbols.join(' · '):'Нет объявлений функций/типов TypeScript: содержимое описано выше и показано ниже.';$('links').replaceChildren();for(const p of f.localImports){const b=document.createElement('button');b.textContent=p;b.addEventListener('click',()=>selectFile(p));$('links').append(b);}if(!f.localImports.length)$('links').textContent='Нет прямых локальных ES imports; для shell/SQL/документов связи указаны в назначении и содержимом.';$('externals').textContent='Внешние imports: '+(f.imports.filter(p=>!p.startsWith('.')).join(', ')||'нет');$('file-source').textContent=f.source||'Документ не встроен сам в себя. Открой ссылку на GitHub.';$('github-source').href=f.url;document.querySelectorAll('[data-file]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.file===path)));}
function renderTree(){const q=$('filter').value.toLowerCase().trim(),items=files.filter(f=>(!prefix||f.path.startsWith(prefix))&&(!q||f.path.toLowerCase().includes(q)||f.purpose.toLowerCase().includes(q)||f.symbols.some(s=>s.toLowerCase().includes(q))));$('count').textContent=items.length+' / '+files.length;const root={};for(const f of items){let node=root;const parts=f.path.split('/');for(const part of parts.slice(0,-1))node=node[part]??={};node[parts.at(-1)]=f.path;}function build(node,parent,depth){for(const [name,value]of Object.entries(node)){if(typeof value==='string'){const b=document.createElement('button');b.textContent=name;b.dataset.file=value;b.title=value;b.setAttribute('aria-controls','viewer');b.setAttribute('aria-current',String(value===selected));b.addEventListener('click',()=>selectFile(value));parent.append(b);}else{const d=document.createElement('details'),s=document.createElement('summary');s.textContent=name+'/';d.open=!!q||name==='src'||depth===0&&name==='scripts';d.append(s);build(value,d,depth+1);parent.append(d);}}}$('tree').replaceChildren();build(root,$('tree'),0);}
$('filter').addEventListener('input',renderTree);for(const [id,q]of [['only-src','src/'],['only-scripts','scripts/'],['all-files','']])$(id).addEventListener('click',()=>{prefix=q;$('filter').value='';renderTree();});for(const b of document.querySelectorAll('[data-open]'))b.addEventListener('click',()=>{selectFile(b.dataset.open);$('files').scrollIntoView();});
function partial(){const n=Number($('failure').value);$('track').replaceChildren();['source.md','DB','journal','Git'].forEach((s,i)=>{const d=document.createElement('div');d.className=i<n?'ok':'unchecked';d.textContent=s;const t=document.createElement('small');t.textContent=i<n?'сохранено':'не завершено';d.append(t);$('track').append(d);});$('partial').textContent={1:'Source остаётся, карточки нет. После сверки возможен только явный adopt-source с точными байтами/путём; не удалять исходник автоматически.',2:'Карточка сохранена. Не создавать её повторно. Проверить журнал и добавить фактическую note, не выдумывать потерянный переход.',3:'Завершить Git commit конкретных файлов после сверки; не повторять append/create.',4:'Сохранены все четыре части. Это commit контекста, а не движка и не сетевой sync.'}[n];}
$('failure').addEventListener('change',partial);renderTree();selectFile(selected);partial();
</script></main></body></html>`;
writeFileSync('docs/reports/m1-report.html',html);
console.log(JSON.stringify({version,files:files.length,sourceFiles:files.filter(f=>f.path.startsWith('src/')).length,homePatterns:homeFiles.length,htmlBytes:Buffer.byteLength(html)}));
