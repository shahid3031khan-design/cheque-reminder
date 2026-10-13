// The app serves two companies, each with its own cheques, tasks and employees ("workspaces").
// Everything that existed before workspaces were introduced has no `workspace` field and belongs to SWK.
//
// Who can enter which: an employee belongs to exactly one company. Admins (the main admin and sub admins)
// can sign in to either company. Admin accounts therefore show up in both companies' user lists.

const WORKSPACES = {
  swk: { key: "swk", name: "SWK" },
  betterway: { key: "betterway", name: "Betterway" },
};
const DEFAULT_WORKSPACE = "swk";

function isWorkspace(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(WORKSPACES, key);
}

// The company a stored record (user, cheque, task, session) belongs to; old records without the field are SWK's.
function workspaceOf(record) {
  return isWorkspace(record?.workspace) ? record.workspace : DEFAULT_WORKSPACE;
}

function nameOf(keyOrRecord) {
  const key = typeof keyOrRecord === "string" ? keyOrRecord : workspaceOf(keyOrRecord);
  return (WORKSPACES[key] || WORKSPACES[DEFAULT_WORKSPACE]).name;
}

function list() {
  return Object.values(WORKSPACES).map((w) => ({ key: w.key, name: w.name }));
}

// May this person sign in to that company?
function canEnter(user, key) {
  return isWorkspace(key) && (user?.role === "admin" || workspaceOf(user) === key);
}

// Is this person part of that company's lists (employees of it, plus every admin)?
function isMember(user, key) {
  return user?.role === "admin" || workspaceOf(user) === key;
}

// MongoDB filter for "records of this company". SWK also matches records that predate the field.
function filterFor(key) {
  if (key === DEFAULT_WORKSPACE) {
    return { $or: [{ workspace: DEFAULT_WORKSPACE }, { workspace: { $exists: false } }, { workspace: null }] };
  }
  return { workspace: key };
}

module.exports = { WORKSPACES, DEFAULT_WORKSPACE, isWorkspace, workspaceOf, nameOf, list, canEnter, isMember, filterFor };
