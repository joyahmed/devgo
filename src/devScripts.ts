// how the dev-script submenu reads what `get_project_scripts` hands it, and
// what it writes down.
//
// pure on purpose. the assembly around it — openScripts in App.tsx — lives
// in a closure inside AppInner and can only be exercised by mounting the
// whole app, but the part that was WRONG is the reading, not the mounting:
// an empty list was reported as "No dev scripts found for this project",
// which is a claim about the project in the one case where nothing about the
// project was ever looked at. that claim is made here now, where a test can
// reach it.
//
// the live failure this comes from: a project → dev → Run dev script click
// that produced no submenu and no log line at all. devgo.log had
// `invoke get_project_scripts` and then end-of-file — no run_script, no
// refusal — because the list came back empty and the toast that explained it
// wrote nothing down.

/// The answer, in one shape.
///
/// The backend carried a bare `DevScript[]` before it carried a reason, and
/// a test mock still can. A reader that assumed the new shape would take
/// `.length` off undefined and throw — replacing the empty menu we are here
/// to explain with a TypeError toast, which is the same bug one layer up.
export const readScripts = (answer: DevScript[] | ScriptList): ScriptList =>
	Array.isArray(answer) ? { scripts: answer, reason: null } : answer;

/// ⭐ One line for the whole dev section.
///
/// Every entry in that submenu comes out of this one array, so the count and
/// the names at the moment of the click cover all of them at once — which is
/// why the fix is one slice and not one per entry. The reason rides along
/// even when the list is not empty: a sleeping distro still withholds
/// package.json from a rust project that renders `cargo run` regardless, and
/// the log is then the only place that says so.
export const scriptsLogLine = (project: string, list: ScriptList) =>
	`scripts ${project}: ${list.scripts.length}` +
	` [${list.scripts.map(s => s.name).join(' ')}]` +
	(list.reason ? ` · ${list.reason}` : '');

/// Why the section is empty, in the user's words.
///
/// The backend's reason when it has one; only in its absence the claim about
/// the project, which is then true — nothing stopped us looking.
export const emptyScriptsMessage = (list: ScriptList) =>
	list.reason ?? 'No dev scripts found for this project';
