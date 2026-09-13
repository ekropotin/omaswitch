var maxDisplayLength = 160

function boundedText(value) {
  value = String(value || "")
  return value.length > maxDisplayLength ? value.slice(0, maxDisplayLength - 1) + "…" : value
}

function appId(window) {
  if (!window) return ""
  if (window.wayland && window.wayland.appId) return String(window.wayland.appId)
  var ipc = window.lastIpcObject || {}
  return String(ipc.class || ipc.initialClass || "")
}

function label(window) {
  return boundedText(window && window.title ? window.title : (appId(window) || "Untitled"))
}

function detail(window) {
  if (!window) return ""
  var value = appId(window)
  if (window.workspace) value += (value ? " · " : "") + "ws " + String(window.workspace.id)
  return boundedText(value)
}

// Hyprland's focusHistoryID is a rank in the compositor's global focus-history
// list: 0 = currently focused, 1 = most recent before that, ascending = older.
// Transient/popup windows not meaningfully in that history can report null or
// an empty string. Number(null) === 0 and Number("") === 0, so we must guard
// before coercion — otherwise such windows are ranked 0 (treated as current)
// and surface above genuinely recent ones.
function historyRank(window) {
  var ipc = window && window.lastIpcObject ? window.lastIpcObject : {}
  var raw = ipc.focusHistoryID
  if (raw === null || raw === undefined) return 1000000
  // "" and " " both coerce to 0; discard empty/whitespace values (transient
  // windows not meaningfully in the focus history).
  if (typeof raw !== "number" && String(raw).trim() === "") return 1000000
  var rank = Number(raw)
  return isFinite(rank) && rank >= 0 ? rank : 1000000
}

function isCurrent(window) {
  return !!(window && window.activated) || historyRank(window) === 0
}

function focusRank(window) {
  return isCurrent(window) ? -1 : historyRank(window)
}

function addressKey(value) {
  var raw = value && typeof value === "object" ? value.address : value
  if (raw === null || raw === undefined) return ""
  return String(raw).toLowerCase().replace(/^0x/, "")
}

function promoteAddress(values, address) {
  var key = addressKey(address)
  var source = values && typeof values.slice === "function" ? values : []
  if (!key) return source.slice()
  var result = [key]
  for (var i = 0; i < source.length; i++) {
    var candidate = addressKey(source[i])
    if (candidate && candidate !== key) result.push(candidate)
  }
  return result
}

function addressesByHistory(clients) {
  var source = clients && typeof clients.slice === "function" ? clients.slice() : []
  source.sort(function(left, right) {
    return historyRank({ lastIpcObject: left }) - historyRank({ lastIpcObject: right })
  })
  var result = []
  for (var i = 0; i < source.length; i++) {
    var key = addressKey(source[i])
    if (key && result.indexOf(key) === -1) result.push(key)
  }
  return result
}

function sortedWindows(values, mruAddresses) {
  var source = values && typeof values.slice === "function" ? values.slice() : []
  var mru = {}
  var order = mruAddresses && typeof mruAddresses.slice === "function" ? mruAddresses : []
  for (var m = 0; m < order.length; m++) mru[addressKey(order[m])] = m
  var decorated = []
  for (var i = 0; i < source.length; i++) {
    var key = addressKey(source[i])
    var rank = key && mru[key] !== undefined ? mru[key] : 1000000 + focusRank(source[i])
    decorated.push({ value: source[i], index: i, rank: rank })
  }
  decorated.sort(function(left, right) {
    return left.rank - right.rank || left.index - right.index
  })
  var result = []
  for (var j = 0; j < decorated.length; j++) result.push(decorated[j].value)
  return result
}

function filteredWindows(values, query) {
  var q = String(query || "").trim().toLowerCase()
  if (!q) return values.slice()
  return values.filter(function(window) {
    return (label(window) + " " + detail(window)).toLowerCase().indexOf(q) !== -1
  })
}

// Build the shell command that focuses a window AND moves to its workspace.
// Native toplevel activate does not always switch the visible workspace, so
// the switch is requested explicitly: prefer Omarchy's Lua dispatcher form
// (hl.dsp.focus), fall back to the plain focuswindow syntax for stock
// Hyprland. Returns null when the window has no address, deferring to the
// native activate path in Switcher.qml.
function focusCommand(window) {
  var raw = window && window.address
  if (raw === null || raw === undefined || raw === "") return null
  var rawAddress = String(raw)
  var address = rawAddress.indexOf("0x") === 0 ? rawAddress : "0x" + rawAddress
  return "hyprctl dispatch \"hl.dsp.focus({ window = 'address:" + address +
    "' })\" >/dev/null 2>&1 || hyprctl dispatch focuswindow \"address:" + address + "\""
}

if (typeof module !== "undefined") module.exports = {
  appId: appId,
  label: label,
  detail: detail,
  addressKey: addressKey,
  promoteAddress: promoteAddress,
  addressesByHistory: addressesByHistory,
  isCurrent: isCurrent,
  sortedWindows: sortedWindows,
  filteredWindows: filteredWindows,
  focusCommand: focusCommand
}
