// walk.mjs — drive the REAL DevGo through a declared route map and leave a
// machine-checkable artefact behind.
//
//   bun scripts/walk.mjs                 the whole walk, webview shots only
//   node scripts/walk.mjs                the same (no Bun API is used here)
//   bun scripts/walk.mjs --only=settings,menu
//   bun scripts/walk.mjs --themes=neon   one palette instead of five
//   bun scripts/walk.mjs --window-shots  also run shoot.ps1 where a step asks
//   bun scripts/walk.mjs --arm-ipc       install the IPC recorder (see below)
//   bun scripts/walk.mjs --list          print the plan and exit, drive nothing
//
// It produces docs/walk/<sha>/manifest.json plus one PNG per shooting step,
// and exits 0 only when every step that ran passed.
//
// ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// The per-change lifecycle rule (claude-setup/memory/software-lifecycle-per-change.md)
// has three stages with no artefact, and those are exactly the three every
// session skips: L4 "click every screen like a software tester, screenshots
// are the deliverable", L5 "exercise it where it ships", L6 "label every claim
// with the checkout it came from". Nobody watches you skip a stage that leaves
// nothing behind. This leaves something behind.
//
// ⭐ The keystone is `get_git_sha`, the Tauri command that returns the short sha
// build.rs compiled into the binary. The walk asks the RUNNING APP what build
// it is and stamps that answer on every artefact. L6's named failure mode is a
// walk run against one commit while a different binary shipped ("mobile's walk
// ran against 631435d, the binary submitted was 04492b6"); a manifest whose sha
// came from the binary's own mouth cannot make that mistake. The About panel
// prints the same value, and one step asserts the two agree.
//
// ─── HONEST LIMITS — read these before trusting a green run ─────────────────
//
// ⛔ NO HOVER. Neither scripts/cdp.mjs nor this file can hold a hover state:
//    Input.dispatchMouseEvent(mouseMoved) is sent immediately before each click
//    and nothing captures the frame in between. src/themes.ts records that
//    muted text ran under 4:1 on a HOVERED row for months. This walk would not
//    have found it. Hover is unverifiable by this route.
//
// ⛔ TWO KINDS OF SCREENSHOT, and they see different things.
//    `shot: 'webview'` is Page.captureScreenshot: the DOCUMENT only. No window
//    frame, no rounded corners, no transparency knob, no title-bar buttons as
//    the OS composites them. Cheap (~60 ms), silent, safe to take on every
//    step — so it is the default and it is what nearly every step uses.
//    `shot: 'window'` shells out to scripts/shoot.ps1, which captures the real
//    window over the wallpaper — and to do it, MINIMISES EVERY OTHER WINDOW ON
//    THE DESKTOP and hides the desktop icons. It is ~2.5 s and it takes the
//    owner's screen away, so it is opt-in twice: the step must ask for it AND
//    --window-shots must be on the command line.
//
// ⛔ NOT A CI INSTRUMENT. WebView2 needs a real interactive desktop session;
//    windows-latest has no installed DevGo and shoot.ps1 would minimise a
//    runner's windows to photograph nothing. This is a LOCAL gate. Do not put
//    it in a workflow file and do not report its absence there as a skip.
//
// ⛔ THE DEBUG PORT CANNOT BE ATTACHED AFTER LAUNCH, and it opens on the FIRST
//    WebView2 instance only. The installed DevGo must be CLOSED before the
//    driven build starts — the two share one user-data folder — and the build
//    must be started with the env var. Exact command in docs/walk/README.md.
//
// ⛔ `key F5` DOES NOT RELOAD A TAURI WEBVIEW. The { reload: true } action
//    calls location.reload() instead. Every theme change reloads, because
//    main.tsx applies the stored theme before the first paint and that boot
//    path is the one worth walking.
//
// ⛔ scripts/verify.sh SKIPS THE ENTIRE RUST TIER while `tauri dev` is up
//    (cargo holds the src-tauri/target lock, so clippy and cargo test would
//    block rather than fail) and exits INCOMPLETE. Gate BEFORE you launch or
//    AFTER you stop — never during a walk.
//
// ⛔ PORT 1420 IS strictPort. A stray vite on it kills `tauri dev` outright.
//
// ⛔ THIS APP HAS NO data-testid ANYWHERE. Every selector in
//    scripts/walk.routes.mjs is a structural or text fact about production
//    markup, so a refactor can turn this walk red without breaking the app. A
//    red step is a claim about the walk OR the app; read the assertion before
//    you read the code.
//
// ─── WHY NOT SHELL OUT TO cdp.mjs ───────────────────────────────────────────
//
// cdp.mjs opens a WebSocket, sends one command and calls process.exit(0). This
// walk sends a few hundred, needs the Runtime and Log domains ENABLED across
// the whole run to collect console errors, and needs key events with MODIFIERS
// — cdp.mjs's `key` verb has no modifier support at all (its CODES table holds
// Escape, Enter, Tab, Backspace, Delete and F5, and it never sets the
// modifiers bitmask). So the transport is reimplemented here, deliberately with
// the same wire shapes cdp.mjs uses (Runtime.evaluate with awaitPromise and
// returnByValue, Input.dispatchMouseEvent's mouseMoved-then-press-release
// triple, Input.insertText, Page.captureScreenshot) so that anything true of
// one is true of the other. cdp.mjs stays the hand tool; this is the harness.
// It uses Node built-ins only and runs under both `node` and `bun`.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CONSOLE_NOISE,
	IPC_READ_ONLY,
	IPC_STUBS,
	MENU_ALWAYS,
	MENU_CONDITIONAL,
	NEVER_CLICK,
	NOT_COVERED,
	SETTINGS_PANELS,
	STEPS,
	THEMES,
	THEME_STORAGE_KEY
} from './walk.routes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── the command line ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, fallback) => {
	const hit = argv.find(a => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const list = (name) => {
	const v = opt(name, '');
	return v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
};

const PORT = opt('port', process.env.DEVGO_CDP_PORT ?? '9223');
const OUT_BASE = opt('out', join(ROOT, 'docs', 'walk'));
const WANT_THEMES = list('themes').length ? list('themes') : THEMES;
const ONLY = list('only');
const SKIP = list('skip');
const WINDOW_SHOTS = flag('window-shots');
const ARM_IPC = flag('arm-ipc');
const TIMEOUT_MS = Number(opt('timeout', '4000'));

// ─── the CDP transport ──────────────────────────────────────────────────────
let ws;
let seq = 0;
const pending = new Map();
// every console error and uncaught exception since the last drain, with the
// noise already filtered out
let consoleBuf = [];
let ignoredBuf = [];

const noise = text => CONSOLE_NOISE.some(re => re.test(text));

const connect = async () => {
	const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
	const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'));
	if (!page) {
		console.error(
			`no page on port ${PORT}.\n` +
				'  Is the driven build up? It must be started like this, with the\n' +
				'  installed DevGo CLOSED first (the port opens on the first instance only):\n' +
				"    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'\n" +
				'    bun tauri dev'
		);
		process.exit(2);
	}
	ws = new WebSocket(page.webSocketDebuggerUrl);
	ws.onmessage = ev => {
		const m = JSON.parse(ev.data);
		if (m.id && pending.has(m.id)) {
			pending.get(m.id)(m);
			pending.delete(m.id);
			return;
		}
		// Runtime.consoleAPICalled: console.error / console.assert
		if (m.method === 'Runtime.consoleAPICalled') {
			if (m.params.type !== 'error' && m.params.type !== 'assert') return;
			const text = (m.params.args ?? [])
				.map(a => a.value ?? a.description ?? a.type)
				.join(' ');
			(noise(text) ? ignoredBuf : consoleBuf).push({ kind: 'console.' + m.params.type, text });
			return;
		}
		// an uncaught throw is never noise
		if (m.method === 'Runtime.exceptionThrown') {
			const d = m.params.exceptionDetails;
			consoleBuf.push({
				kind: 'exception',
				text: d.exception?.description ?? d.text ?? 'uncaught'
			});
			return;
		}
		// Log.entryAdded: the network and CSP refusals the page never prints
		if (m.method === 'Log.entryAdded') {
			const e = m.params.entry;
			if (e.level !== 'error') return;
			(noise(e.text) ? ignoredBuf : consoleBuf).push({ kind: 'log.' + e.source, text: e.text });
		}
	};
	await new Promise((res, rej) => {
		ws.onopen = res;
		ws.onerror = () => rej(new Error('cdp websocket refused'));
	});
	await send('Runtime.enable');
	await send('Log.enable');
	await send('Page.enable');
};

const send = (method, params = {}) =>
	new Promise(res => {
		const id = ++seq;
		pending.set(id, res);
		ws.send(JSON.stringify({ id, method, params }));
	});

// the same shape cdp.mjs uses, except a thrown expression comes back as a
// value instead of killing the process: a walk has 40 more steps to run
const evaluate = async expr => {
	const r = await send('Runtime.evaluate', {
		expression: expr,
		awaitPromise: true,
		returnByValue: true
	});
	const exc = r.result?.exceptionDetails;
	if (exc) return { error: exc.exception?.description ?? exc.text ?? 'exception' };
	return { value: r.result?.result?.value };
};

const drainConsole = () => {
	const errs = consoleBuf;
	const ignored = ignoredBuf;
	consoleBuf = [];
	ignoredBuf = [];
	return { errs, ignored };
};

// ─── input ──────────────────────────────────────────────────────────────────

// exactly cdp.mjs's triple: mouseMoved first, because a synthetic press
// without a move lands on an element the renderer has not hit-tested
const mouse = async (x, y, button = 'left', count = 1) => {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
	for (let i = 1; i <= count; i++) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', {
				type,
				x,
				y,
				button,
				buttons: button === 'right' ? 2 : 1,
				clickCount: i
			});
		}
	}
};

// CDP's modifier bitmask. Alt 1, Ctrl 2, Meta 4, Shift 8 — and it is not
// optional: without it WebView2 delivers a bare keypress and src/shortcuts.ts
// `matches` rejects it on the exact-modifier rule, so every shortcut in the
// app silently does nothing. This is the piece cdp.mjs's `key` verb lacks.
const MOD = { Alt: 1, Ctrl: 2, Cmd: 4, Meta: 4, Shift: 8 };

const VK = {
	Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, F5: 116,
	Home: 36, End: 35, Space: 32,
	ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
	',': 188, '.': 190, '=': 187, '-': 189, '/': 191
};
const vkFor = k => VK[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
const codeFor = k =>
	/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k;

// 'Ctrl+Shift+P' → one keyDown and one keyUp carrying the mask.
// ⛔ `text` is deliberately omitted whenever Ctrl or Alt is held: a modified
// key must not also insert a character into a focused input.
const key = async spec => {
	const parts = spec.split('+');
	const bare = parts.pop();
	let modifiers = 0;
	for (const p of parts) modifiers |= MOD[p] ?? 0;
	const shifted = (modifiers & MOD.Shift) !== 0;
	const k = bare === 'Space' ? ' ' : /^[a-z]$/.test(bare) && shifted ? bare.toUpperCase() : bare;
	const base = {
		key: k,
		code: codeFor(bare),
		windowsVirtualKeyCode: vkFor(bare),
		nativeVirtualKeyCode: vkFor(bare),
		modifiers
	};
	const plain = (modifiers & (MOD.Ctrl | MOD.Alt | MOD.Cmd)) === 0 && k.length === 1;
	await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(plain ? { text: k } : {}) });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};

// ─── targets: resolved in the page, so the map never carries coordinates ────
//
// Every target comes back as a point in CSS pixels, computed from a live
// getBoundingClientRect. That is what makes { outside } possible at all: the
// backdrop point is derived from where the panel actually is on this window at
// this size, not from a number somebody measured once.
const POINT_JS = `(spec => {
	const centre = el => { const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) return { err: 'zero-sized' };
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
	if (spec.xy) return { x: spec.xy[0], y: spec.xy[1] };
	if (spec.css) { const el = document.querySelector(spec.css);
		return el ? centre(el) : { err: 'no match for ' + spec.css }; }
	if (spec.text) {
		const t = spec.text.trim();
		const all = [...document.querySelectorAll('button, [role="button"], a')];
		const el = all.find(b => b.textContent.trim() === t) ?? all.find(b => b.textContent.includes(t));
		return el ? centre(el) : { err: 'no button reading ' + t }; }
	if (spec.outside) {
		const panel = document.querySelector(spec.outside);
		if (!panel) return { err: 'no match for ' + spec.outside };
		// the backdrop is the panel's parent: Drawer renders
		// <div backdrop onClick=close><div panel onClick=stopPropagation>
		const back = panel.parentElement;
		if (!back) return { err: 'panel has no backdrop parent' };
		const b = back.getBoundingClientRect(), p = panel.getBoundingClientRect();
		const GAP = 24;
		// left, right, below, above — first gap wide enough wins
		if (p.left - b.left > GAP) return { x: Math.round(b.left + (p.left - b.left) / 2), y: Math.round(p.top + p.height / 2) };
		if (b.right - p.right > GAP) return { x: Math.round(p.right + (b.right - p.right) / 2), y: Math.round(p.top + p.height / 2) };
		if (b.bottom - p.bottom > GAP) return { x: Math.round(p.left + p.width / 2), y: Math.round(p.bottom + (b.bottom - p.bottom) / 2) };
		if (p.top - b.top > GAP) return { x: Math.round(p.left + p.width / 2), y: Math.round(b.top + (p.top - b.top) / 2) };
		return { err: 'the panel fills its backdrop: no point is outside it' };
	}
	return { err: 'unknown target ' + JSON.stringify(spec) };
})`;

const pointOf = async spec => {
	const r = await evaluate(`${POINT_JS}(${JSON.stringify(spec)})`);
	if (r.error) return { err: r.error };
	return r.value ?? { err: 'target resolver returned nothing' };
};

// ─── waiting ────────────────────────────────────────────────────────────────
const WAIT_JS = `(w => {
	if (w.css) return !!document.querySelector(w.css);
	if (w.gone) return !document.querySelector(w.gone);
	if (w.text) return document.body.innerText.includes(w.text);
	return true;
})`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const waitFor = async w => {
	if (w.ms) { await sleep(w.ms); return { ok: true }; }
	const until = Date.now() + TIMEOUT_MS;
	for (;;) {
		const r = await evaluate(`${WAIT_JS}(${JSON.stringify(w)})`);
		if (r.value === true) return { ok: true };
		if (Date.now() > until)
			return { ok: false, err: `timed out after ${TIMEOUT_MS}ms waiting for ${JSON.stringify(w)}` };
		await sleep(80);
	}
};

// ─── assertions ─────────────────────────────────────────────────────────────
//
// One Runtime.evaluate for the whole list, so a step costs one round trip
// instead of eight and no assertion can observe a DOM the others did not.
const ASSERT_JS = `(specs => specs.map(a => {
	const q = s => document.querySelectorAll(s);
	const body = () => document.body.innerText;
	const menuLabels = () => [...q('div.fixed.z-50.w-72 button')].map(b => ({
		label: (b.querySelector('span > span.truncate') ?? b).textContent.trim(),
		hint: b.querySelector('span.font-mono')?.textContent.trim() ?? '',
		disabled: b.disabled === true
	}));
	try {
		if (a.css) return { ok: !!document.querySelector(a.css), said: 'exists ' + a.css };
		if (a.gone) return { ok: !document.querySelector(a.gone), said: 'absent ' + a.gone };
		if (a.text) return { ok: body().includes(a.text), said: 'text ' + JSON.stringify(a.text) };
		if (a.notext) return { ok: !body().includes(a.notext), said: 'no text ' + JSON.stringify(a.notext) };
		if (a.count) return { ok: q(a.count[0]).length === a.count[1],
			said: 'count ' + a.count[0] + ' == ' + a.count[1] + ' (saw ' + q(a.count[0]).length + ')' };
		if (a.atleast) return { ok: q(a.atleast[0]).length >= a.atleast[1],
			said: 'count ' + a.atleast[0] + ' >= ' + a.atleast[1] + ' (saw ' + q(a.atleast[0]).length + ')' };
		if (a.menu) { const got = menuLabels();
			const missing = a.menu.filter(l => !got.some(g => g.label === l && !g.disabled));
			return { ok: missing.length === 0, said: 'menu entries enabled: ' + a.menu.join(', '),
				extra: { missing, saw: got.map(g => g.label + (g.disabled ? ' (disabled)' : '')) } }; }
		if (a.menuDisabled) { const got = menuLabels();
			const bad = a.menuDisabled.filter(l => !got.some(g => g.label === l && g.disabled));
			return { ok: bad.length === 0, said: 'menu entries disabled: ' + a.menuDisabled.join(', '), extra: { bad } }; }
		if (a.hints) { const got = menuLabels(); const bad = [];
			for (const [label, hint] of Object.entries(a.hints)) {
				const e = got.find(g => g.label === label);
				if (!e) { bad.push(label + ': absent'); continue; }
				if (e.hint !== hint) bad.push(label + ': hint ' + JSON.stringify(e.hint) + ' != ' + JSON.stringify(hint)); }
			return { ok: bad.length === 0, said: 'menu hints', extra: { bad } }; }
		if (a.sha) return { ok: body().includes(a.shaValue), said: 'the sha ' + a.shaValue + ' is on screen' };
		if (a.js) return { ok: !!eval(a.js), said: 'js ' + a.js };
		return { ok: false, said: 'unknown assertion ' + JSON.stringify(a) };
	} catch (e) { return { ok: false, said: 'threw', extra: { error: String(e) } }; }
}))`;

const runAsserts = async (specs, sha) => {
	const filled = specs.map(a => (a.sha ? { sha: true, shaValue: sha } : a));
	const r = await evaluate(`${ASSERT_JS}(${JSON.stringify(filled)})`);
	if (r.error) return [{ ok: false, said: 'assertion batch threw', extra: { error: r.error } }];
	return r.value ?? [{ ok: false, said: 'assertion batch returned nothing' }];
};

// ─── the IPC recorder, and why it is off by default ─────────────────────────
//
// window.__TAURI_INTERNALS__.invoke is the ONE chokepoint every Tauri call
// goes through: @tauri-apps/api/core's invoke() is three lines long and its
// body is `return window.__TAURI_INTERNALS__.invoke(cmd, args, options)`
// (node_modules/@tauri-apps/api/core.js:201-203, v2.11.1). Replacing it gives
// the walk the same thing src/App.projectMenu.test.tsx asserts against in
// jsdom — invoke's call log — except in the real app.
//
// Deny by default: anything not matched by IPC_READ_ONLY is recorded and
// answered with a stub, never forwarded. That is what lets a walk click
// `Kill session` without killing a session.
//
// ⛔ It is OFF unless --arm-ipc, because with it on the app is no longer
// entirely itself and a screenshot taken under it is a screenshot of a
// half-mocked app. The default walk asserts presence and hints and does not
// click the dangerous entries at all.
//
// ⛔ If the property cannot be replaced, armed steps are SKIPPED with that
// reason. They are never fired for real as a fallback.
const SHIM_JS = `(() => {
	const t = window.__TAURI_INTERNALS__;
	if (!t || typeof t.invoke !== 'function') return { patched: false, why: 'no __TAURI_INTERNALS__.invoke' };
	if (window.__WALK__ && window.__WALK__.patched) return { patched: true, why: 'already installed' };
	const reads = READS.map(s => new RegExp(s));
	const stubs = STUBS;
	const real = t.invoke.bind(t);
	const state = { calls: [], blocked: [], patched: false };
	try {
		t.invoke = (cmd, args, options) => {
			const pass = reads.some(re => re.test(cmd));
			state.calls.push({ cmd, args: args ?? null, passed: pass });
			if (pass) return real(cmd, args, options);
			state.blocked.push(cmd);
			return Promise.resolve(Object.prototype.hasOwnProperty.call(stubs, cmd) ? stubs[cmd] : null);
		};
		state.patched = t.invoke !== real;
	} catch (e) { return { patched: false, why: String(e) }; }
	window.__WALK__ = state;
	return { patched: state.patched, why: state.patched ? 'installed' : 'assignment silently refused' };
})()`;

const installShim = async () => {
	if (!ARM_IPC) return { patched: false, why: 'not armed (--arm-ipc off)' };
	const src = SHIM_JS.replace('READS', JSON.stringify(IPC_READ_ONLY.map(r => r.source))).replace(
		'STUBS',
		JSON.stringify(IPC_STUBS)
	);
	const r = await evaluate(src);
	return r.error ? { patched: false, why: r.error } : (r.value ?? { patched: false, why: 'no answer' });
};

// ─── self-labelling: ask the BINARY what build it is ────────────────────────
const identify = async () => {
	const r = await evaluate(`(async () => {
		const core = await import('/node_modules/@tauri-apps/api/core.js').catch(() => null);
		const app = await import('/node_modules/@tauri-apps/api/app.js').catch(() => null);
		const inv = core ? core.invoke : (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
		const out = { sha: null, version: null, err: null };
		try { out.sha = (await inv('get_git_sha')).trim(); } catch (e) { out.err = 'get_git_sha: ' + e; }
		try { out.version = app ? await app.getVersion() : null; } catch (e) { out.err = (out.err ?? '') + ' getVersion: ' + e; }
		return out;
	})()`);
	if (r.error) return { sha: null, version: null, err: r.error };
	return r.value;
};

// ⚠️ the import path above works in `tauri dev` (vite serves node_modules) but
// NOT in a release build, where the modules are bundled. So fall back to the
// raw IPC bridge, which is always there, and to the document title for the
// version. Named rather than silent: the manifest records which door answered.
const identifyFallback = async () => {
	const r = await evaluate(`(async () => {
		const out = { sha: null, version: null, err: null };
		try { out.sha = (await window.__TAURI_INTERNALS__.invoke('get_git_sha', {})).trim(); }
		catch (e) { out.err = 'ipc get_git_sha: ' + e; }
		return out;
	})()`);
	return r.error ? { sha: null, version: null, err: r.error } : r.value;
};

// ─── shots ──────────────────────────────────────────────────────────────────
const shootWebview = async file => {
	const r = await send('Page.captureScreenshot', { format: 'png' });
	if (!r.result?.data) return { ok: false, err: 'captureScreenshot returned no data' };
	writeFileSync(file, Buffer.from(r.result.data, 'base64'));
	return { ok: true };
};

const shootWindow = file => {
	const ps = spawnSync(
		'powershell.exe',
		['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'shoot.ps1'), '-Out', file],
		{ encoding: 'utf8', timeout: 60000 }
	);
	if (ps.status !== 0)
		return { ok: false, err: (ps.stderr || ps.stdout || 'shoot.ps1 failed').trim().split('\n')[0] };
	return { ok: true };
};

// ─── between steps: leave no overlay standing ───────────────────────────────
//
// Steps are written to be independent, which means the driver owes them a
// clean start. Escape until nothing modal is up, up to three times — a stacked
// palette over a picker needs two, and a fourth would be a symptom worth
// seeing rather than papering over.
const reset = async () => {
	for (let i = 0; i < 3; i++) {
		const r = await evaluate(
			`!!document.querySelector('[role="dialog"][aria-modal="true"], div.fixed.z-50.w-72')`
		);
		if (r.value !== true) return { ok: true };
		await key('Escape');
		await sleep(120);
	}
	const r = await evaluate(
		`!!document.querySelector('[role="dialog"][aria-modal="true"], div.fixed.z-50.w-72')`
	);
	return r.value === true
		? { ok: false, err: 'an overlay survived three Escapes — the next step would start dirty' }
		: { ok: true };
};

// ─── actions ────────────────────────────────────────────────────────────────
const act = async a => {
	if (a.key) { await key(a.key); await sleep(120); return { ok: true }; }
	if (a.type) { await send('Input.insertText', { text: a.type }); await sleep(120); return { ok: true }; }
	if (a.eval) { const r = await evaluate(a.eval); return r.error ? { ok: false, err: r.error } : { ok: true }; }
	if (a.wait) return waitFor(a.wait);
	if (a.reload) return reload();
	if (a.theme) return setThemeAndReload(a.theme);
	for (const [verb, button, count] of [['click', 'left', 1], ['rclick', 'right', 1], ['dbl', 'left', 2]]) {
		if (!a[verb]) continue;
		const p = await pointOf(a[verb]);
		if (p.err) return { ok: false, err: `${verb}: ${p.err}` };
		await mouse(p.x, p.y, button, count);
		await sleep(150);
		return { ok: true, at: [p.x, p.y] };
	}
	return { ok: false, err: `unknown action ${JSON.stringify(a)}` };
};

const reload = async () => {
	await evaluate('location.reload()');
	// the document goes away under us; poll until React has painted again
	const until = Date.now() + 15000;
	for (;;) {
		await sleep(250);
		const r = await evaluate(`!!document.querySelector('header') && document.readyState === 'complete'`);
		if (r.value === true) break;
		if (Date.now() > until) return { ok: false, err: 'the webview did not come back within 15s' };
	}
	// StrictMode's first-mount noise belongs to the reload, not to the step
	await sleep(400);
	drainConsole();
	const shim = await installShim();
	return { ok: true, shim };
};

const setThemeAndReload = async id => {
	const r = await evaluate(
		`(() => { try { localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(id)}); return 'ok'; } catch (e) { return String(e); } })()`
	);
	if (r.value !== 'ok') return { ok: false, err: `could not store the theme: ${r.value ?? r.error}` };
	return reload();
};

// ─── the plan ───────────────────────────────────────────────────────────────
const themesFor = step => {
	if (step.themes === 'all') return WANT_THEMES;
	if (Array.isArray(step.themes)) return step.themes.filter(t => WANT_THEMES.includes(t));
	return [WANT_THEMES[0]];
};

const wanted = step => {
	const tags = step.tags ?? [];
	if (SKIP.some(t => tags.includes(t) || t === step.id)) return false;
	if (ONLY.length === 0) return true;
	return ONLY.some(t => tags.includes(t) || t === step.id);
};

const plan = () => {
	const out = [];
	// grouped by theme so the walk reloads five times, not sixty: every step
	// that wants a theme runs while that theme is on screen
	for (const theme of WANT_THEMES)
		for (const step of STEPS)
			if (wanted(step) && themesFor(step).includes(theme)) out.push({ step, theme });
	return out;
};

// ─── the walk ───────────────────────────────────────────────────────────────
const main = async () => {
	const jobs = plan();

	if (flag('list')) {
		console.log(`${jobs.length} step-runs over ${WANT_THEMES.length} theme(s):`);
		for (const { step, theme } of jobs)
			console.log(`  ${theme.padEnd(8)} ${step.id.padEnd(28)} ${step.name}`);
		console.log(`\nnot covered (${NOT_COVERED.length}):`);
		for (const n of NOT_COVERED) console.log('  - ' + n.split(' — ')[0]);
		return 0;
	}

	await connect();

	// ⭐ the keystone, before anything else: whatever this walk reports is
	// about the build the BINARY just named, not about the checkout on disk.
	let id = await identify();
	let idDoor = 'esm import of @tauri-apps/api';
	if (!id?.sha) {
		id = await identifyFallback();
		idDoor = '__TAURI_INTERNALS__.invoke';
	}
	if (!id?.sha) {
		console.error('get_git_sha did not answer:', id?.err ?? 'no reason given');
		console.error('  Without it the walk cannot label its own artefacts, so it stops here.');
		console.error('  That is the point of L6: an unlabelled walk is the failure, not the fallback.');
		process.exit(3);
	}
	if (id.sha === 'unknown')
		console.error('⚠️ the binary reports sha "unknown" — built outside a git checkout. Labelling it as such.');

	const sha = id.sha;
	const outDir = join(OUT_BASE, sha);
	mkdirSync(outDir, { recursive: true });

	const metrics = await evaluate(
		'({ innerWidth, innerHeight, devicePixelRatio, ua: navigator.userAgent })'
	);
	const shim = await installShim();

	console.log(`walking ${sha} (v${id.version ?? '?'}) — ${jobs.length} step-runs → ${outDir}`);
	if (ARM_IPC) console.log(`  ipc shim: ${shim.patched ? 'installed' : 'NOT installed — ' + shim.why}`);

	const steps = [];
	let current = null;
	let n = 0;

	for (const { step, theme } of jobs) {
		n++;
		const rec = {
			seq: n,
			id: step.id,
			name: step.name,
			theme,
			why: step.why ?? null,
			at: new Date().toISOString(),
			status: 'passed',
			shot: null,
			shotKind: null,
			asserts: [],
			console: [],
			consoleIgnored: [],
			note: null
		};
		steps.push(rec);

		// the theme is changed only when it has to be, and that is a reload
		if (current !== theme) {
			const t = await setThemeAndReload(theme);
			current = theme;
			if (!t.ok) { rec.status = 'failed'; rec.note = t.err; continue; }
		}

		const clean = await reset();
		if (!clean.ok) { rec.status = 'failed'; rec.note = clean.err; continue; }
		drainConsole();

		// an armed-only step with no shim is SKIPPED, never fired for real
		if ((step.tags ?? []).includes('armed') && !shim.patched) {
			rec.status = 'skipped';
			rec.note = `needs the IPC shim: ${shim.why}`;
			continue;
		}

		let failed = null;
		for (const a of step.open ?? []) {
			const r = await act(a);
			if (!r.ok) { failed = `open ${JSON.stringify(a)}: ${r.err}`; break; }
		}

		if (!failed) {
			if (!step.assert?.length) {
				failed = 'the route map gave this step no assertion — a screenshot alone proves nothing';
			} else {
				rec.asserts = await runAsserts(step.assert, sha);
				const bad = rec.asserts.filter(a => !a.ok);
				if (bad.length) failed = `${bad.length} assertion(s) failed`;
			}
		}

		// the screenshot is taken even on a red step: a picture of the failure
		// is the most useful artefact this harness can leave
		const want = step.shot ?? 'webview';
		if (want) {
			const file = join(outDir, `${String(n).padStart(2, '0')}-${step.id}-${theme}.png`);
			if (want === 'window' && !WINDOW_SHOTS) {
				rec.shotKind = 'window (skipped — pass --window-shots)';
			} else {
				const s = want === 'window' ? shootWindow(file) : await shootWebview(file);
				rec.shotKind = want;
				if (s.ok) rec.shot = file.slice(ROOT.length + 1).replace(/\\/g, '/');
				else { rec.shotKind = want + ' (failed)'; rec.note = [rec.note, s.err].filter(Boolean).join(' · '); }
			}
		}

		for (const a of step.close ?? []) {
			const r = await act(a);
			if (!r.ok && !failed) failed = `close ${JSON.stringify(a)}: ${r.err}`;
		}

		const { errs, ignored } = drainConsole();
		rec.console = errs;
		rec.consoleIgnored = ignored;
		// ⛔ a step that rendered while throwing is a failure, not a pass with a
		// footnote
		if (errs.length && !failed) failed = `${errs.length} console error(s) while this step ran`;

		if (failed) { rec.status = 'failed'; rec.note = [rec.note, failed].filter(Boolean).join(' · '); }
		process.stdout.write(
			`  ${rec.status === 'passed' ? 'ok  ' : rec.status === 'skipped' ? 'skip' : 'FAIL'} ` +
				`${theme.padEnd(8)} ${step.id}${rec.status === 'failed' ? ' — ' + rec.note : ''}\n`
		);
	}

	if (ARM_IPC && shim.patched) {
		const log = await evaluate('window.__WALK__ ? { calls: window.__WALK__.calls.length, blocked: [...new Set(window.__WALK__.blocked)] } : null');
		if (log.value) console.log(`  ipc: ${log.value.calls} calls, blocked: ${log.value.blocked.join(', ') || 'none'}`);
	}

	const counted = { passed: 0, failed: 0, skipped: 0 };
	for (const s of steps) counted[s.status]++;
	const consoleErrors = steps.reduce((a, s) => a + s.console.length, 0);

	// ⭐ `green` is the ONE field a gate reads, and it is computed here rather
	// than left to the reader: no failures, no console errors, and at least one
	// step actually ran. An empty walk must never be green — that is the
	// "all-skipped run reports OK" failure scripts/verify.sh already guards.
	const green = counted.failed === 0 && consoleErrors === 0 && counted.passed > 0;

	const manifest = {
		schema: 'devgo.walk/1',
		green,
		sha,
		shaSource: `get_git_sha via ${idDoor}`,
		version: id.version ?? null,
		summary: { total: steps.length, ...counted, consoleErrors },
		startedAt: steps[0]?.at ?? new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		themes: WANT_THEMES,
		themeNote: 'five dark palettes and no light one — src/themes.ts ships no light theme',
		host: {
			platform: platform(),
			hostname: hostname(),
			cdpPort: PORT,
			viewport: metrics.value ?? null
		},
		mode: {
			windowShots: WINDOW_SHOTS,
			ipcShim: ARM_IPC ? shim : { patched: false, why: 'not armed' },
			only: ONLY,
			skip: SKIP
		},
		coverage: {
			settingsPanels: SETTINGS_PANELS.map(p => p.id),
			menuAlwaysAsserted: MENU_ALWAYS,
			menuConditional: MENU_CONDITIONAL,
			neverClicked: NEVER_CLICK
		},
		notCovered: NOT_COVERED,
		steps
	};

	const file = join(outDir, 'manifest.json');
	writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');

	console.log(
		`\n${green ? 'GREEN' : 'RED'} — ${counted.passed} passed, ${counted.failed} failed, ` +
			`${counted.skipped} skipped, ${consoleErrors} console error(s)\n` +
			`${file.slice(ROOT.length + 1).replace(/\\/g, '/')}\n` +
			`\nVISUAL: walk ${sha}`
	);
	return green ? 0 : 1;
};

main()
	.then(code => { try { ws?.close(); } catch {} process.exit(code); })
	.catch(e => { console.error(e); try { ws?.close(); } catch {} process.exit(4); });
