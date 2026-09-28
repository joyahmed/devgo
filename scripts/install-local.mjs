// `bun run install:local`, on every platform: build the bundle, stop the
// running DevGo, install the new one over it, bring it back up, and say
// which commit it was built at. windows is scripts/install-local.ps1,
// unchanged, and this file only hands it the arguments. macOS and linux
// are done here:
//
//   macOS  tauri build --bundles app, quit DevGo, replace
//          /Applications/<productName>.app, strip quarantine, open it
//   linux  tauri build --bundles deb, stop DevGo, sudo apt install --reinstall
//          the .deb (sudo asks in this terminal, as it would anywhere; the
//          --reinstall matters because apt otherwise no-ops when the deb's
//          package+version already looks installed), verify the installed
//          binary's sha256 against the one the .deb carries, start it detached
//
//   bun run install:local                      build, install, relaunch
//   bun run install:local -- --skip-build      reinstall the bundle on disk
//   bun run install:local -- --no-launch       do not relaunch afterward
//   bun run install:local -- --dry-run         print the steps, touch nothing
//   bun run install:local -- --dry-run --platform=darwin|linux|win32
//                                              the plan another OS would
//                                              follow; for testing, and
//                                              only with --dry-run
//
// names come from src-tauri/tauri.conf.json: productName is the .app and
// the process, mainBinaryName the program the .deb puts on PATH, version
// the file a build is expected to write
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const known = ['--dry-run', '--skip-build', '--no-launch'];
const argv = process.argv.slice(2);
const platformArg = argv.find(a => a.startsWith('--platform='));
const unknown = argv.filter(a => !known.includes(a) && a !== platformArg);
if (unknown.length) {
	fail(`unknown argument(s): ${unknown.join(', ')} (known: ${known.join(', ')}, --platform=<os> with --dry-run)`);
}
const dryRun = argv.includes('--dry-run');
const skipBuild = argv.includes('--skip-build');
const noLaunch = argv.includes('--no-launch');
const platform = platformArg ? platformArg.slice('--platform='.length) : process.platform;
if (!['win32', 'darwin', 'linux'].includes(platform)) {
	fail(`no install steps for platform "${platform}" (win32, darwin, linux)`);
}
// another OS's plan can be read here, never run here
if (platform !== process.platform && !dryRun) {
	fail(`--platform=${platform} is only for --dry-run: this machine is ${process.platform}`);
}

if (platform === 'win32') {
	// the .ps1 knows its own flags; --platform is ours alone
	const passOn = argv.filter(a => a !== platformArg);
	const ps1 = join(root, 'scripts', 'install-local.ps1');
	const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...passOn], {
		stdio: 'inherit',
	});
	if (r.error) fail(`could not start powershell: ${r.error.message}`);
	process.exit(r.status ?? 1);
}

const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const productName = conf.productName;
const binaryName = conf.mainBinaryName || productName;
const version = conf.version;
if (!productName || !version) fail('tauri.conf.json names no productName or version');

const plan = platform === 'darwin' ? macPlan() : linuxPlan();

// --- 1. build ---------------------------------------------------------
if (skipBuild) {
	step('1/4 skip build (--skip-build): reinstalling the bundle already on disk');
} else {
	// node_modules first: a checkout pulled since the last install can name
	// a package the box never fetched, and then the build's `tsc` fails on
	// the missing import (exit 2) before cargo ever runs. that is how the
	// first mac run of this script died, on the test deps from 69d7adb
	step('1/4 bun install --frozen-lockfile');
	if (!dryRun) run('bun', ['install', '--frozen-lockfile'], { cwd: root });
	step(`1/4 bun run tauri build --bundles ${plan.bundles}`);
	if (!dryRun) run('bun', ['run', 'tauri', 'build', '--bundles', plan.bundles], { cwd: root });
}

// --- 2. the artifact, by the version tauri.conf.json names ---------------
const artifact = plan.locate();
if (artifact) {
	step(`2/4 ${plan.bundles}: ${artifact}`);
} else if (dryRun) {
	step(`2/4 ${plan.bundles}: none on disk yet - expected ${plan.expected}`);
} else {
	fail(`no ${plan.bundles} bundle found (expected ${plan.expected})`);
}

// --- 3. stop DevGo, install --------------------------------------------
for (const line of plan.install(artifact ?? plan.expected)) step(`3/4 ${line}`);
if (!dryRun) plan.doInstall(artifact);

// --- 4. relaunch -------------------------------------------------------
if (noLaunch) {
	step('4/4 skip relaunch (--no-launch)');
} else {
	step(`4/4 ${plan.launchLine}`);
	if (!dryRun) plan.launch();
}

// --- report ------------------------------------------------------------
const sha = capture('git', ['-C', root, 'rev-parse', '--short', 'HEAD']) || 'unknown';
console.log('');
if (dryRun) {
	console.log(`[dry-run] nothing was built, installed, or launched. (${platform}, HEAD ${sha})`);
} else {
	console.log(`installed: ${plan.installed}`);
	console.log(`built at:  ${sha}`);
}

// --- macOS -------------------------------------------------------------
function macPlan() {
	const app = `${productName}.app`;
	const built = join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos', app);
	const dest = `/Applications/${app}`;
	return {
		bundles: 'app',
		expected: built,
		installed: dest,
		locate: () => (existsSync(built) ? built : null),
		install: src => [
			`osascript -e 'quit app "${productName}"', wait up to 10s, then pkill -x ${binaryName}`,
			`rm -rf "${dest}" && ditto "${src}" "${dest}"`,
			`xattr -dr com.apple.quarantine "${dest}"`,
		],
		doInstall: src => {
			// quit asks nicely: the app gets to save its window state
			spawnSync('osascript', ['-e', `quit app "${productName}"`], { stdio: 'ignore' });
			if (!waitGone(10_000)) {
				spawnSync('pkill', ['-x', binaryName], { stdio: 'ignore' });
				if (!waitGone(5_000)) fail(`${productName} is still running 15s after being asked to stop; close it and retry`);
			}
			run('rm', ['-rf', dest]);
			run('ditto', [src, dest]);
			// a local build carries no quarantine flag, but a copy that came
			// through a download or airdrop does, and Gatekeeper then refuses it
			spawnSync('xattr', ['-dr', 'com.apple.quarantine', dest], { stdio: 'ignore' });
			// ditto is a straight copy, so this should always match - it exists
			// to catch a truncated or partial copy rather than a stale install
			// (unlike apt on linux, ditto has no "already the newest version"
			// shortcut to fool), same idea as the linux/windows checks below
			const builtSha = sha256File(join(src, 'Contents', 'MacOS', binaryName));
			const installedSha = sha256File(join(dest, 'Contents', 'MacOS', binaryName));
			if (builtSha !== installedSha) {
				fail(
					`ditto reported success but ${dest}/Contents/MacOS/${binaryName} (sha256 ${installedSha.slice(0, 12)}) ` +
						`does not match the built app's binary (${builtSha.slice(0, 12)}); the install did not actually change`,
				);
			}
			console.log(`verified: Contents/MacOS/${binaryName} sha256 ${installedSha.slice(0, 12)} matches the built app`);
		},
		launchLine: `open -a "${dest}"`,
		launch: () => run('open', ['-a', dest]),
	};
}

// --- linux -------------------------------------------------------------
function linuxPlan() {
	const dir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'deb');
	// the debian name for the machine: tauri names the .deb by it
	const arch = { x64: 'amd64', arm64: 'arm64', ia32: 'i386', arm: 'armhf' }[process.arch] ?? process.arch;
	const expected = join(dir, `${productName}_${version}_${arch}.deb`);
	const bin = `/usr/bin/${binaryName}`;
	return {
		bundles: 'deb',
		expected,
		installed: bin,
		locate: () => {
			if (existsSync(expected)) return expected;
			if (!existsSync(dir)) return null;
			const newest = readdirSync(dir)
				.filter(f => f.endsWith('.deb'))
				.map(f => join(dir, f))
				.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
			if (newest) console.log(`note: no .deb for tauri.conf.json's version (${version}); using the newest one found: ${newest}`);
			return newest ?? null;
		},
		install: deb => [
			`check for a DevGo already running from somewhere apt won't touch (command -v ${binaryName}, /proc/<pid>/exe)`,
			`pkill -x ${binaryName}, wait up to 15s`,
			`sudo apt install -y --reinstall "${deb}"`,
			`verify ${bin} sha256 now matches the .deb's packed usr/bin/${binaryName}`,
		],
		doInstall: deb => {
			// apt only ever touches /usr/bin. if the box's DevGo is really an
			// AppImage, a ~/.local/bin copy, or something in /opt, this whole
			// script is aimed at a file nobody is running - so say so before
			// doing anything.
			const which = capture('sh', ['-c', `command -v ${binaryName}`]);
			if (which) console.log(`command -v ${binaryName}: ${which}`);
			const pids = capture('pgrep', ['-x', binaryName])
				.split('\n')
				.map(s => s.trim())
				.filter(Boolean);
			for (const pid of pids) {
				const exe = capture('readlink', ['-f', `/proc/${pid}/exe`]);
				if (exe && exe !== bin) {
					console.log(`warning: ${productName} (pid ${pid}) is running from ${exe}, not ${bin} - this install will not touch it`);
				} else if (exe) {
					console.log(`${productName} (pid ${pid}) running from ${exe}`);
				}
			}

			spawnSync('pkill', ['-x', binaryName], { stdio: 'ignore' });
			if (!waitGone(15_000)) fail(`${productName} is still running 15s after being asked to stop; close it and retry`);
			// sudo prompts right here, in this terminal; nothing is hidden.
			// --reinstall: apt otherwise sees the same package+version this deb
			// is (e.g. dev-go 1.2.3 built again from a new commit) as already
			// installed and does nothing but say "already the newest version" -
			// and this script used to call that success. apt accepts a path to
			// a local .deb as an install argument; --reinstall forces the copy
			// even when dpkg's version check sees nothing changed.
			console.log(`running: sudo apt install -y --reinstall "${deb}"`);
			run('sudo', ['apt', 'install', '-y', '--reinstall', deb]);
			const pkg = capture('dpkg-deb', ['-f', deb, 'Package']);
			if (pkg) console.log(`package:   ${capture('dpkg-query', ['-W', '-f=${Package} ${Version}', pkg])}`);
			if (!existsSync(bin)) fail(`apt reported success but ${bin} is missing`);

			// belt and suspenders: apt/dpkg saying "installed" is not proof the
			// bytes on disk changed. extract the binary the .deb itself carries
			// and compare it to what's now at /usr/bin - this is what would
			// have caught the original bug (apt no-op'd, ${bin} kept the old build).
			const tmp = mkdtempSync(join(tmpdir(), 'devgo-verify-'));
			try {
				run('dpkg-deb', ['-x', deb, tmp]);
				const packed = join(tmp, 'usr', 'bin', binaryName);
				if (!existsSync(packed)) fail(`the .deb has no usr/bin/${binaryName} - can't verify the install`);
				const packedSha = sha256File(packed);
				const installedSha = sha256File(bin);
				if (packedSha !== installedSha) {
					fail(
						`apt reported success but ${bin} (sha256 ${installedSha.slice(0, 12)}) does not match the .deb's ` +
							`packed usr/bin/${binaryName} (${packedSha.slice(0, 12)}) - apt likely saw the same package+version ` +
							`already installed and skipped it. Retry (this script now passes --reinstall), or by hand: ` +
							`sudo dpkg -i "${deb}" && sudo apt-get install -f -y`,
					);
				}
				console.log(`verified: ${bin} sha256 ${installedSha.slice(0, 12)} matches the .deb`);
			} finally {
				rmSync(tmp, { recursive: true, force: true });
			}
		},
		launchLine: `${bin} (detached)`,
		launch: () => {
			// detached with its own session, so closing this terminal does
			// not take DevGo with it
			spawn(bin, [], { detached: true, stdio: 'ignore' }).unref();
		},
	};
}

// --- helpers ------------------------------------------------------------
function step(msg) {
	console.log(dryRun ? `[dry-run] ${msg}` : msg);
}

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
	if (r.error) fail(`could not start ${cmd}: ${r.error.message}`);
	if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
}

function capture(cmd, args) {
	const r = spawnSync(cmd, args, { encoding: 'utf8' });
	return r.status === 0 ? r.stdout.trim() : '';
}

// equivalent to `shasum -a 256`/`sha256sum`, in-process so mac and linux
// share one implementation and neither needs the external tool on PATH
function sha256File(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// is any process named binaryName still up? pgrep -x matches the name
// exactly, so DevGo does not match a shell whose command line mentions it
function waitGone(ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (spawnSync('pgrep', ['-x', binaryName], { stdio: 'ignore' }).status !== 0) return true;
		spawnSync('sleep', ['0.2']);
	}
	return spawnSync('pgrep', ['-x', binaryName], { stdio: 'ignore' }).status !== 0;
}

function fail(msg) {
	console.error(`install-local: ${msg}`);
	process.exit(1);
}
