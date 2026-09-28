// `bun run smoke`: one command that proves DevGo works on this box, with no
// window driven and no terminal opened, so an agent can run it unattended
// on windows, macOS and linux.
//
//   bun run smoke             the four DevGo checks
//   bun run smoke -- --full   + the repo gates (tsc, vitest, fmt, clippy, cargo test)
//   bun run smoke -- --json   one JSON object on stdout instead of lines
//
// Every check prints PASS / FAIL / SKIP and one line of evidence; any FAIL
// exits 1. What is checked:
//
//   build     the newest `--- start:` line in devgo.log names HEAD's sha:
//             the DevGo that ran last is the build of this checkout
//   targets   targets.json needs no migration the app still has to make,
//             and holds no shipped `bash -lc` WSL row or `-e {command}` row
//   dev/<side>      the fixture's `dev` script, launched on the line DevGo
//                   builds for it, finds a real node (on WSL: not /mnt/c) and
//                   the line ends in the user's login shell
//   install/<side>  the menu's Install entry (`<pm> install`) on that same
//                   line exits 0 and leaves the lockfile / node_modules
//
// ⭐ No launch line is rebuilt here. `DevGo --smoke-probe` (src-tauri/src/
// smoke_probe.rs) answers through the app's own pm detection, dev menu and
// launcher, so this file cannot drift from what a click runs. It is the
// INSTALLED binary when that is the build of HEAD, else a debug build of
// this checkout. All this file does to a line is make it headless: drop the
// terminal around it, undo what the terminal would unescape, and swap the
// trailing `exec <login shell> -l` for an echo of what it would exec.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const known = ['--full', '--json'];
const argv = process.argv.slice(2);
const unknown = argv.filter(a => !known.includes(a));
if (unknown.length) {
	console.error(`smoke: unknown argument(s): ${unknown.join(', ')} (known: ${known.join(', ')})`);
	process.exit(2);
}
const full = argv.includes('--full');

// the command DevGo hands the terminal ends `; exec <shell> -l`; headless it
// reports the command's status and what it would have exec'd instead
const EXEC_TAIL = /;\s*exec\s+(\S+)\s+-l\s*$/;
const MARK_TAIL = '; echo DEVGO_SMOKE_STATUS=$?; echo DEVGO_SMOKE_EXEC=$1';
const asJson = argv.includes('--json');

const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const identifier = conf.identifier;
const osName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? process.platform;
const head = capture('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).stdout || 'unknown';

const results = [];
function record(name, status, evidence) {
	results.push({ name, status, evidence });
	if (!asJson) console.log(`${status.padEnd(4)} ${name.padEnd(14)} ${evidence}`);
}

// tauri's app_data_dir: the OS data dir joined with the identifier - the
// same dir devgo.log, targets.json and prefs.json live in
function dataDir() {
	if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), identifier);
	if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', identifier);
	return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), identifier);
}

// ── a. the running build is HEAD ─────────────────────────────────────────
const dir = dataDir();
const build = checkBuild();

function checkBuild() {
	const log = join(dir, 'devgo.log');
	if (!existsSync(log)) {
		record('build', 'FAIL', `no ${log}: DevGo never started on this box - fix: bun run install:local`);
		return { fresh: false };
	}
	// the live file, then the rotated one: a rotation can leave the live file
	// with no start line of its own yet
	const lines = [log, join(dir, 'devgo.log.old')]
		.filter(existsSync)
		.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.includes('[DevGo] --- start: ')).reverse());
	const newest = lines[0];
	if (!newest) {
		record('build', 'FAIL', `no start line in ${log} - fix: bun run install:local`);
		return { fresh: false };
	}
	const m = newest.match(/--- start: v(\S+) · (\S+) (\S+) (\S+) pid (\d+) ---/);
	if (!m) {
		const v = newest.match(/start: v(\S+)/)?.[1] ?? '?';
		record('build', 'FAIL', `newest start (v${v}, ${newest.slice(0, 24)}) predates sha logging, so it is not HEAD ${head} - fix: bun run install:local`);
		return { fresh: false };
	}
	const [, version, sha, , , pid] = m;
	const live = pidAlive(Number(pid)) ? `running pid ${pid}` : `pid ${pid} not running now`;
	if (sha !== head) {
		record('build', 'FAIL', `last DevGo started was v${version} · ${sha}, HEAD is ${head} (${live}) - fix: bun run install:local`);
		return { fresh: false };
	}
	record('build', 'PASS', `last DevGo started was v${version} · ${sha} == HEAD (${live})`);
	return { fresh: true };
}

// ── the probe: the installed binary when it is HEAD, else this checkout ──
const probe = probeBinary();

function installedBinary() {
	const name = conf.mainBinaryName || conf.productName;
	if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? '', conf.productName, `${name}.exe`);
	if (process.platform === 'darwin') return `/Applications/${conf.productName}.app/Contents/MacOS/${name}`;
	return `/usr/bin/${name}`;
}

function probeBinary() {
	// an installed build older than the probe would not know the flag and
	// would start a second DevGo instead, so it is only asked once the log
	// has shown it is HEAD - and asked its sha before anything else
	const installed = installedBinary();
	if (build.fresh && existsSync(installed)) {
		const v = runProbe(installed, ['version']);
		if (v.ok && v.value.sha === head) return { bin: installed, via: 'installed' };
	}
	if (!asJson) console.log(`     (probe: installed build is not HEAD, building this checkout: cargo build)`);
	const b = capture('cargo', ['build', '--quiet'], { cwd: join(root, 'src-tauri') });
	const bin = join(root, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'devgo.exe' : 'devgo');
	if (b.status !== 0 || !existsSync(bin)) return { error: `cargo build failed: ${lastLine(b.stderr)}` };
	return { bin, via: 'debug build' };
}

function runProbe(bin, args) {
	const r = capture(bin, ['--smoke-probe', ...args], { timeout: 120_000 });
	try {
		const value = JSON.parse(r.stdout);
		return value.error ? { ok: false, error: value.error } : { ok: true, value };
	} catch {
		return { ok: false, error: `probe said nothing parseable (exit ${r.status}): ${lastLine(r.stderr || r.stdout)}` };
	}
}

// ── b. targets.json is migrated ──────────────────────────────────────────
checkTargets();

function checkTargets() {
	const file = join(dir, 'targets.json');
	if (!existsSync(file)) return record('targets', 'FAIL', `no ${file}: DevGo never started - fix: bun run install:local`);
	let rows;
	try {
		rows = JSON.parse(readFileSync(file, 'utf8'));
	} catch (e) {
		return record('targets', 'FAIL', `${file} does not parse: ${e.message}`);
	}
	const bad = [];
	for (const t of rows) {
		const wslRun = t.wsl_run_args_template ?? '';
		if (/bash -lc /.test(wslRun)) bad.push(`${t.id}: WSL run is bash -lc (no nvm)`);
		if (/exec bash"\s*$/.test(wslRun)) bad.push(`${t.id}: WSL run ends in exec bash, not the login shell`);
		// the windows rows for these emulators shipped other bytes; the
		// {command}-on-the-emulator's-line form was mac and linux only
		if (process.platform !== 'win32' && /(^|\s)-e \{command\}/.test(t.run_args_template ?? '')) {
			bad.push(`${t.id}: run is -e {command} (no shell, no nvm)`);
		}
	}
	if (probe.error) bad.push(`probe unavailable: ${probe.error}`);
	const stale = probe.error ? null : runProbe(probe.bin, ['stale', '--data-dir', dir]);
	if (stale && !stale.ok) bad.push(`probe: ${stale.error}`);
	const pending = stale?.ok ? stale.value.pending : [];
	if (pending.length) bad.push(`migrations the app has not made yet: ${pending.join(', ')}`);
	const backups = readdir(dir)
		.filter(n => n.startsWith('targets.json.pre-'))
		.map(n => n.slice('targets.json.'.length));
	const kept = backups.length ? `backups: ${backups.join(', ')}` : 'no backups (nothing was migrated)';
	if (bad.length) return record('targets', 'FAIL', bad.join('; '));
	record('targets', 'PASS', `${rows.length} rows, 0 pending migrations, ${kept}`);
}

// ── c + d. the dev menu's lines, run headless ────────────────────────────
if (probe.error) {
	for (const n of ['dev', 'install']) record(n, 'FAIL', `probe unavailable: ${probe.error}`);
} else {
	const runtime = runProbe(probe.bin, ['runtime', '--data-dir', dir]);
	if (process.platform === 'win32') {
		const distro = runtime.ok ? runtime.value.default_distro : null;
		if (!runtime.ok) {
			record('dev/wsl', 'FAIL', `probe runtime: ${runtime.error}`);
		} else if (!distro) {
			record('dev/wsl', 'SKIP', 'no WSL distro configured (prefs cached runtime has no default_distro)');
			record('install/wsl', 'SKIP', 'no WSL distro configured');
		} else {
			wslSide(distro);
		}
	}
	nativeSide();
}

function wslSide(distro) {
	const shell = wsl(distro, ['sh', '-c', 'getent passwd "$(id -un)" | cut -d: -f7']).stdout;
	const mk = wsl(distro, ['mktemp', '-d', '/tmp/devgo-smoke-XXXXXX']);
	if (mk.status !== 0 || !mk.stdout) return record('dev/wsl', 'FAIL', `mktemp in ${distro}: ${lastLine(mk.stderr)}`);
	const linuxDir = mk.stdout;
	const unc = `\\\\wsl.localhost\\${distro}${linuxDir.replace(/\//g, '\\')}`;
	try {
		// written through the UNC path, the way any windows tool would
		writeFileSync(join(unc, 'package.json'), fixturePackageJson());
		sideChecks('wsl', unc, shell, {
			hasPnpm: wsl(distro, ['bash', '-lic', 'command -v pnpm'], { stdin: 'ignore' }).stdout.split('\n').pop() || '',
			exists: rel => wsl(distro, ['test', '-e', `${linuxDir}/${rel}`]).status === 0,
			seed: (rel, body) => writeFileSync(join(unc, rel), body),
			reset: () => wsl(distro, ['sh', '-c', `cd '${linuxDir}' && find . -mindepth 1 ! -name package.json -exec rm -rf {} +`]),
			run: entry => runWslLine(entry),
			nodeOk: p => p.startsWith('/') && !p.startsWith('/mnt/'),
			shellCheck: true,
		});
	} finally {
		wsl(distro, ['rm', '-rf', linuxDir]);
	}
}

function nativeSide() {
	const side = process.platform === 'win32' ? 'windows' : osName;
	const base = mkdtempSync(join(tmpdir(), 'devgo-smoke-'));
	try {
		writeFileSync(join(base, 'package.json'), fixturePackageJson());
		const loginShell = process.platform === 'win32' ? '' : userLoginShell();
		sideChecks(side, base, loginShell, {
			hasPnpm: whichNative('pnpm'),
			exists: rel => existsSync(join(base, rel)),
			seed: (rel, body) => writeFileSync(join(base, rel), body),
			reset: () => {
				for (const n of readdir(base)) if (n !== 'package.json') rmSync(join(base, n), { recursive: true, force: true });
			},
			run: entry => (process.platform === 'win32' ? runWindowsNative(entry, base) : runUnixScript(entry)),
			nodeOk: p => (process.platform === 'win32' ? /^[A-Za-z]:\\/.test(p) : p.startsWith('/')),
			// a windows run tab is the command itself: there is no shell after it
			shellCheck: process.platform !== 'win32',
		});
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
}

// the same four questions on either side of the WSL boundary
function sideChecks(side, projectPath, loginShell, io) {
	const pms = [{ pm: 'npm', lock: 'package-lock.json', seed: null }];
	if (io.hasPnpm) pms.push({ pm: 'pnpm', lock: 'pnpm-lock.yaml', seed: "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n" });
	else record(`install/${side}/pnpm`, 'SKIP', 'pnpm does not resolve on this side');

	for (const [i, { pm, lock, seed }] of pms.entries()) {
		io.reset();
		if (seed) io.seed(lock, seed);
		const menu = runProbe(probe.bin, ['run', '--data-dir', dir, '--project', projectPath]);
		const tag = pms.length > 1 || pm !== 'npm' ? `/${pm}` : '';
		if (!menu.ok) {
			record(`dev/${side}${tag}`, 'FAIL', `probe run: ${menu.error}`);
			continue;
		}
		const detected = menu.value.package_manager ?? 'npm';
		if (detected !== pm) {
			record(`dev/${side}${tag}`, 'FAIL', `app detected ${detected} for a ${lock ? lock : 'lockfile-less'} project, expected ${pm}`);
			continue;
		}
		const dev = menu.value.entries.find(e => e.name === 'dev');
		const install = menu.value.entries.find(e => e.name === 'Install');

		// c. the dev script, only once: its answer does not depend on the pm
		if (i === 0) {
			if (!dev || dev.error) record(`dev/${side}`, 'FAIL', dev?.error ?? 'the dev menu offered no `dev` entry');
			else {
				const r = io.run(dev);
				if (r.skip) record(`dev/${side}`, 'SKIP', r.skip);
				else {
					const node = r.lines.find(l => /node(\.exe)?$/i.test(l.trim()))?.trim() ?? '';
					const problems = [];
					if (r.status !== '0') problems.push(`\`${dev.command}\` exited ${r.status}: ${lastLine(r.raw)}`);
					if (!node) problems.push('printed no node path');
					else if (!io.nodeOk(node)) problems.push(`node is ${node}${node.startsWith('/mnt/') ? ' (the windows shim, not nvm)' : ''}`);
					if (io.shellCheck) {
						if (!loginShell) problems.push('could not read the login shell');
						else if (r.exec !== loginShell) problems.push(`line ends in ${r.exec || 'nothing'}, login shell is ${loginShell}`);
					}
					const tail = io.shellCheck ? `, ends in ${r.exec}` : '';
					if (problems.length) record(`dev/${side}`, 'FAIL', problems.join('; '));
					else record(`dev/${side}`, 'PASS', `${dev.command} via ${menu.value.terminal} -> node ${node}${tail}`);
				}
			}
		}

		// d. the Install entry
		const name = `install/${side}${tag}`;
		if (!install || install.error) {
			record(name, 'FAIL', install?.error ?? 'the dev menu offered no Install entry');
			continue;
		}
		if (install.command !== `${pm} install`) {
			record(name, 'FAIL', `Install runs \`${install.command}\`, expected \`${pm} install\``);
			continue;
		}
		const r = io.run(install);
		if (r.skip) {
			record(name, 'SKIP', r.skip);
			continue;
		}
		const made = [lock, 'node_modules'].filter(io.exists);
		const want = pm === 'npm' ? lock : 'node_modules';
		if (r.status !== '0') record(name, 'FAIL', `\`${install.command}\` exited ${r.status}: ${lastLine(r.raw)}`);
		else if (!made.includes(want)) record(name, 'FAIL', `\`${install.command}\` exited 0 but left no ${want}`);
		else record(name, 'PASS', `\`${install.command}\` exited 0, left ${made.join(' + ')}`);
	}
}

function fixturePackageJson() {
	return JSON.stringify(
		{ name: 'devgo-smoke', version: '0.0.0', private: true, scripts: { dev: 'node -e "console.log(process.execPath)"' } },
		null,
		2,
	);
}

// ── making a line headless ────────────────────────────────────────────────

// windows + WSL: the app runs `cmd /c <exe> <args>`, and wt hands
// everything from `wsl` on to wsl.exe, after turning its `\;` back into `;`
function runWslLine(entry) {
	const at = entry.args.search(/(^|\s)wsl(\.exe)?\s/);
	if (at < 0) return { skip: `${entry.exe}'s WSL run line has no wsl call to run headless: ${entry.args}` };
	let line = entry.args.slice(at).trim();
	if (entry.exe === 'wt') line = line.replace(/\\;/g, ';');
	const words = splitWindowsArgs(line);
	const last = words.length - 1;
	if (!EXEC_TAIL.test(words[last])) return { skip: `the line does not end in exec <shell> -l: ${words[last]}` };
	words[last] = words[last].replace(EXEC_TAIL, MARK_TAIL);
	return marks(capture(words[0], words.slice(1), { stdin: 'ignore', timeout: 300_000, env: { ...process.env, WSL_UTF8: '1' } }));
}

// mac and linux: the line runs a script the launcher wrote; run it with
// its last line swapped the same way
function runUnixScript(entry) {
	if (!entry.script) return { skip: `the ${entry.exe} run line carries the command itself, no script to run headless: ${entry.args}` };
	const body = readFileSync(entry.script, 'utf8');
	const swapped = body.replace(/^exec (\S+) -l\s*$/m, (_, sh) => `echo DEVGO_SMOKE_STATUS=$?\necho DEVGO_SMOKE_EXEC=${sh}`);
	rmSync(entry.script, { force: true });
	if (swapped === body) return { skip: `${entry.script} does not end in exec <shell> -l` };
	const headless = join(tmpdir(), `devgo-smoke-run-${process.pid}.sh`);
	writeFileSync(headless, swapped);
	try {
		return marks(capture('bash', [headless], { stdin: 'ignore', timeout: 300_000 }));
	} finally {
		rmSync(headless, { force: true });
	}
}

// windows native: the wt run tab IS the command, with the project as its
// directory. without the tab, cmd runs it there - the windows PATH is the
// same one the tab would search
function runWindowsNative(entry, cwd) {
	// !ERRORLEVEL! under /v:on: %ERRORLEVEL% would expand before the command ran
	const r = capture('cmd', ['/d', '/v:on', '/c', `call ${entry.command} & echo DEVGO_SMOKE_STATUS=!ERRORLEVEL!`], {
		cwd,
		stdin: 'ignore',
		timeout: 300_000,
		windowsVerbatimArguments: true,
	});
	return marks(r);
}

function marks(r) {
	const raw = `${r.stdout}\n${r.stderr}`;
	const lines = raw.split(/\r?\n/);
	const pick = key => lines.find(l => l.startsWith(`${key}=`))?.slice(key.length + 1).trim();
	return {
		status: pick('DEVGO_SMOKE_STATUS') ?? `none (process exit ${r.status}${r.error ? `, ${r.error}` : ''})`,
		exec: pick('DEVGO_SMOKE_EXEC') ?? '',
		lines: lines.filter(l => !l.startsWith('DEVGO_SMOKE_')),
		raw: lines.filter(l => l.trim() && !l.startsWith('DEVGO_SMOKE_')).join('\n'),
	};
}

// CommandLineToArgvW's rules, which is how wsl.exe reads its own line:
// 2n backslashes + quote = n backslashes and a quote toggle, 2n+1 = n and a
// literal quote, backslashes elsewhere are literal
function splitWindowsArgs(line) {
	const out = [];
	let cur = '';
	let inQuotes = false;
	let started = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '\\') {
			let n = 0;
			while (line[i] === '\\') { n++; i++; }
			if (line[i] === '"') {
				cur += '\\'.repeat(Math.floor(n / 2));
				if (n % 2) cur += '"';
				else inQuotes = !inQuotes;
			} else {
				cur += '\\'.repeat(n);
				i--;
			}
			started = true;
		} else if (c === '"') {
			inQuotes = !inQuotes;
			started = true;
		} else if (/\s/.test(c) && !inQuotes) {
			if (started) out.push(cur);
			cur = '';
			started = false;
		} else {
			cur += c;
			started = true;
		}
	}
	if (started) out.push(cur);
	return out;
}

// ── e. --full: the repo gates ─────────────────────────────────────────────
if (full) {
	const tauri = join(root, 'src-tauri');
	for (const [name, cmd, args, cwd] of [
		['gate/tsc', 'bun', ['x', 'tsc', '--noEmit'], root],
		['gate/vitest', 'bun', ['run', 'test'], root],
		['gate/fmt', 'cargo', ['fmt', '--check'], tauri],
		['gate/clippy', 'cargo', ['clippy', '--all-targets', '--', '-D', 'warnings'], tauri],
		['gate/cargo-test', 'cargo', ['test'], tauri],
	]) {
		const t0 = Date.now();
		const r = capture(cmd, args, { cwd, timeout: 900_000 });
		const secs = `${Math.round((Date.now() - t0) / 1000)}s`;
		if (r.status === 0) record(name, 'PASS', `${cmd} ${args.join(' ')} (${secs})`);
		else record(name, 'FAIL', `${cmd} ${args.join(' ')} exit ${r.status} (${secs}): ${lastLine(r.stderr || r.stdout)}`);
	}
}

// ── summary ───────────────────────────────────────────────────────────────
const count = s => results.filter(r => r.status === s).length;
const summary = `${count('PASS')} pass / ${count('FAIL')} fail / ${count('SKIP')} skip · ${osName} · ${head}`;
if (asJson) {
	console.log(JSON.stringify({ ok: count('FAIL') === 0, os: osName, sha: head, probe: probe.via ?? null, summary, checks: results }, null, 2));
} else {
	console.log(`\n${summary}${probe.via ? ` (probe: ${probe.via})` : ''}`);
}
process.exit(count('FAIL') ? 1 : 0);

// ── helpers ───────────────────────────────────────────────────────────────
function capture(cmd, args, { stdin = 'pipe', ...opts } = {}) {
	const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: [stdin, 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
	return {
		status: r.status,
		stdout: (r.stdout ?? '').replace(/\0/g, '').trim(),
		stderr: (r.stderr ?? '').replace(/\0/g, '').trim(),
		error: r.error?.message,
	};
}

function wsl(distro, args, opts = {}) {
	return capture('wsl', ['-d', distro, '-e', ...args], { env: { ...process.env, WSL_UTF8: '1' }, ...opts });
}

function whichNative(name) {
	return capture(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [name] : ['-c', `command -v ${name}`]).status === 0;
}

// the user's login shell from the account database, not $SHELL: $SHELL is
// whatever this process inherited
function userLoginShell() {
	const user = process.env.USER || capture('id', ['-un']).stdout;
	if (process.platform === 'darwin') {
		return capture('dscl', ['.', '-read', `/Users/${user}`, 'UserShell']).stdout.replace(/^UserShell:\s*/, '');
	}
	return capture('sh', ['-c', `getent passwd "${user}" | cut -d: -f7`]).stdout;
}

function pidAlive(pid) {
	if (!pid) return false;
	if (process.platform === 'win32') return capture('tasklist', ['/FI', `PID eq ${pid}`, '/NH']).stdout.includes(String(pid));
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readdir(d) {
	try {
		return readdirSync(d);
	} catch {
		return [];
	}
}

function lastLine(s) {
	return (s ?? '').trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 200) ?? '';
}
