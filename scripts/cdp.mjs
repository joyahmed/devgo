// drive the dev build over cdp (start it with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223)
//   bun scripts/cdp.mjs eval "<js>"       evaluate, print the value
//   bun scripts/cdp.mjs file <path.js>    the same, from a file
//   bun scripts/cdp.mjs click|rclick|dbl x,y   a real mouse event at x,y
//   bun scripts/cdp.mjs key <Key>         key Escape, key Enter, key F5
//   bun scripts/cdp.mjs type "<text>"     insert text into the focused input
//   bun scripts/cdp.mjs shot <out.png>    the webview's own capture
//   bun scripts/cdp.mjs metrics           viewport size and scale
const [, , mode, ...rest] = process.argv;
const port = process.env.DEVGO_CDP_PORT ?? '9223';
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'));
if (!page) {
	console.error('no page on port', port);
	process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = ev => {
	const m = JSON.parse(ev.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
	}
};
const send = (method, params = {}) =>
	new Promise(res => {
		const i = ++id;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method, params }));
	});
await new Promise(r => (ws.onopen = r));

const evaluate = async expr => {
	const r = await send('Runtime.evaluate', {
		expression: expr,
		awaitPromise: true,
		returnByValue: true
	});
	if (r.result?.exceptionDetails) {
		console.error(
			'EXC',
			JSON.stringify(
				r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails
			)
		);
		process.exit(1);
	}
	return r.result?.result?.value;
};

// a synthetic click is not a user gesture: the clipboard and a native
// dialog need this
const mouse = async (x, y, button, count = 1) => {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
	for (let i = 1; i <= count; i++) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: i });
		}
	}
};

const CODES = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, F5: 116 };
const key = async k => {
	const code = CODES[k] ?? 0;
	for (const type of ['keyDown', 'keyUp']) {
		await send('Input.dispatchKeyEvent', {
			type,
			key: k,
			code: k,
			windowsVirtualKeyCode: code
		});
	}
};

if (mode === 'eval' || mode === 'file') {
	const src = mode === 'file' ? await Bun.file(rest[0]).text() : rest.join(' ');
	const v = await evaluate(src);
	console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
} else if (mode === 'click' || mode === 'rclick' || mode === 'dbl') {
	const [x, y] = rest[0].split(',').map(Number);
	await mouse(x, y, mode === 'rclick' ? 'right' : 'left', mode === 'dbl' ? 2 : 1);
	console.log('ok');
} else if (mode === 'key') {
	await key(rest[0]);
	console.log('ok');
} else if (mode === 'type') {
	await send('Input.insertText', { text: rest.join(' ') });
	console.log('ok');
} else if (mode === 'shot') {
	const r = await send('Page.captureScreenshot', { format: 'png' });
	await Bun.write(rest[0], Buffer.from(r.result.data, 'base64'));
	console.log('saved', rest[0]);
} else if (mode === 'metrics') {
	console.log(
		await evaluate(
			'({ innerWidth, innerHeight, devicePixelRatio, title: document.title })'
		)
	);
} else {
	console.error('usage: see the header of this file');
	process.exit(2);
}
ws.close();
process.exit(0);
