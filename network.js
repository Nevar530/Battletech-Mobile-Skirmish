// network.js  — Firestore-based realtime transport for Battletech Mobile Skirmish
// Requires Firebase App + Firestore already initialized in index.html.
// index.html should load this file BEFORE script.js.

// Import Firestore as an ES module (safe even if app is already initialized)
import {
  getFirestore, doc, collection, setDoc, getDoc, addDoc,
  serverTimestamp, onSnapshot, query, orderBy, limit, updateDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

// Use existing app created in index.html, or initialize defensively if missing
const app = getApps()[0] ?? initializeApp(window.FIREBASE_CONFIG);
const db  = getFirestore(app);

// ---------- Small helpers ----------
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

// Normalize a "3 words" code → a firestore-friendly id
function codeToRoomId(code) {
  return String(code || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')        // non-alnum → dash
    .replace(/^-+|-+$/g, '')            // trim dashes
    .slice(0, 64) || 'room';
}

// Make a simple client id (no PII)
function makeClientId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Module state ----------
const state = {
  roomId: null,
  clientId: makeClientId(),
  profile: { name: `Player-${Math.floor(Math.random()*900+100)}` },
  unsubEvents: null,
  unsubRoom: null,
  heartbeatTimer: null,
  isHost: false,           // first writer of the room doc
  snapshotProvider: null,  // () => object
};

// ---------- Public: identify ----------
function identify(info = {}) {
  if (info && info.name) {
    state.profile.name = String(info.name).slice(0, 32);
  }
}

// ---------- Heartbeat / presence ----------
async function startHeartbeat() {
  stopHeartbeat();
  const pRef = doc(db, 'rooms', state.roomId, 'players', state.clientId);
  // create/update player doc
  await setDoc(pRef, {
    name: state.profile.name,
    lastSeen: serverTimestamp()
  }, { merge: true });

  state.heartbeatTimer = setInterval(async () => {
    try {
      await updateDoc(pRef, { lastSeen: serverTimestamp() });
    } catch (_) {}
  }, 15_000); // every 15s
}
function stopHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

// ---------- Events stream ----------
async function sendDelta(payload) {
  if (!state.roomId) throw new Error('Not in a room');
  // Ensure a minimal shape
  const msg = {
    kind: 'DELTA',
    from: state.clientId,
    name: state.profile.name,
    ts: serverTimestamp(),
    payload
  };
  await addDoc(collection(db, 'rooms', state.roomId, 'events'), msg);
}

// Host can push a full snapshot (first-sync for new joinees)
async function sendSnapshot(obj) {
  if (!state.roomId || !state.isHost) return;
  const msg = {
    kind: 'SNAPSHOT',
    from: state.clientId,
    name: state.profile.name,
    ts: serverTimestamp(),
    payload: { type:'SNAPSHOT', state: obj || {} }
  };
  await addDoc(collection(db, 'rooms', state.roomId, 'events'), msg);
}

// ---------- Join / leave ----------
async function joinRoom(code, options = {}) {
  const roomId = codeToRoomId(code);
  state.roomId = roomId;

  const roomRef = doc(db, 'rooms', roomId);
  const snap = await getDoc(roomRef);

  if (!snap.exists()) {
    // Create the room (become host)
    await setDoc(roomRef, {
      createdAt: serverTimestamp(),
      createdBy: state.clientId,
      maxPlayers: options.maxPlayers ?? 2
    });
    state.isHost = true;
  } else {
    state.isHost = (snap.data()?.createdBy === state.clientId); // usually false
  }

  // (Re)start presence
  await startHeartbeat();

  // Start listening to events (newest last)
  const evCol  = collection(db, 'rooms', roomId, 'events');
  const evQ    = query(evCol, orderBy('ts', 'asc')); // stream all, ordered

  // Clean prior listener if any
  state.unsubEvents && state.unsubEvents();

  // Keep a simple cursor so we don't replay twice on hot reloads
  let firstBatch = true;
  const seen = new Set();

  state.unsubEvents = onSnapshot(evQ, (qs) => {
    qs.docChanges().forEach(change => {
      if (change.type !== 'added') return;
      const id  = change.doc.id;
      if (seen.has(id)) return;
      seen.add(id);

      const data = change.doc.data();
      if (!data || !data.kind) return;

      // Feed game
      if (data.kind === 'SNAPSHOT') {
        if (typeof window.Delta?.applyToGame === 'function') {
          window.Delta.applyToGame(data.payload);
        } else if (typeof window.applyDelta === 'function') {
          // Your script.js can also accept SNAPSHOT via applyDelta
          window.applyDelta(data.payload);
        }
      } else if (data.kind === 'DELTA') {
        const payload = data.payload;
        if (typeof window.Delta?.applyToGame === 'function') {
          window.Delta.applyToGame(payload);
        } else if (typeof window.applyDelta === 'function') {
          window.applyDelta(payload);
        } else if (typeof Net.onDelta === 'function') {
          Net.onDelta(payload);
        }
      }
    });

    // After initial catch-up, if we're the host and we have a snapshot provider,
    // push a snapshot once so a late joiner gets the current board.
    if (firstBatch) {
      firstBatch = false;
      // slight delay so the joiner finishes wiring listeners
      if (state.isHost && state.snapshotProvider) {
        sleep(400).then(async () => {
          try {
            const snapObj = await state.snapshotProvider();
            await sendSnapshot(snapObj);
          } catch (_) {}
        });
      }
    }
  });

  // Optional: also watch the room header for future host transfers, etc.
  state.unsubRoom && state.unsubRoom();
  state.unsubRoom = onSnapshot(roomRef, () => { /* reserved */ });

  return roomId;
}

function leaveRoom() {
  try { state.unsubEvents && state.unsubEvents(); } catch {}
  try { state.unsubRoom && state.unsubRoom(); } catch {}
  stopHeartbeat();
  state.unsubEvents = null;
  state.unsubRoom   = null;
  state.roomId      = null;
  state.isHost      = false;
}

// ---------- Snapshot provider from the game ----------
function registerSnapshotProvider(fn) {
  state.snapshotProvider = (typeof fn === 'function') ? fn : null;
}

// ---------- Fallback wiring for Delta.js (if you use it) ----------
/*
  If you’re using the earlier delta.js facade, you can connect it like this in script.js:

  Delta.setHooks({
    apply: (d)=>applyDelta(d),               // your local reducer
    exportState: ()=> JSON.parse(serializeState()),
    importState: (obj)=> applyState(obj)
  });

  Then call:
    Net.registerSnapshotProvider(()=> Delta.exportGame());
*/
  
// ---------- Public API ----------
const Net = {
  identify,                 // set player name
  joinRoom,                 // join/create a room by 3-word code
  leaveRoom,
  sendDelta,                // send {type:...,...}
  registerSnapshotProvider, // set () => object for host to send full state
  onDelta: null             // optional callback if you prefer Net.onDelta = (d)=>...
};

// Expose globally for your inline script
window.Net = Net;

export default Net;