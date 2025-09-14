// ---- network.js (ES module) ----
// Requires: your HTML already did initializeApp(firebaseConfig)
// and you enabled Firestore in the Firebase console.

import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, onSnapshot,
  serverTimestamp, query, orderBy, getCountFromServer, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// Simple 3-word normalizer + short hash suffix → stable room id
function normalize(code){
  return code.trim().toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
}
function shortHash(str){
  // tiny, stable 32-bit hash → hex
  let h = 0; for (let i=0;i<str.length;i++){ h = (h<<5)-h + str.charCodeAt(i); h|=0; }
  return (h>>>0).toString(16);
}

const db = getFirestore(); // use default app from your HTML

// Internal state
let _room = null;
let _me = { id: crypto.randomUUID(), name: "Player" };
let _unsubMoves = null;
let _presenceTimer = null;
let _deltasCol = null;
let _playersCol = null;

function roomPaths(roomId){
  const games = collection(db, "games");
  const roomDoc = doc(games, roomId);
  return {
    roomDoc,
    deltasCol: collection(roomDoc, "deltas"),
    playersCol: collection(roomDoc, "players"),
  };
}

// Public API (exposed on window.Net at bottom)
const Net = {
  /** set by your script.js: Net.onDelta = (delta)=>{ applyDelta(delta) } */
  onDelta: null,

  /** Optional: set your display name/id before joining */
  identify({ id, name } = {}){
    if (id)   _me.id   = id;
    if (name) _me.name = name;
  },

  /** Join (or create) a room from a 3-word code. Enforces maxPlayers (default 2). */
  async joinRoom(code, { maxPlayers = 2 } = {}){
    if (!code) throw new Error("Room code required");
    const base = normalize(code);
    const roomId = `${base}-${shortHash(base).slice(0,6)}`;
    const { roomDoc, deltasCol, playersCol } = roomPaths(roomId);

    // create/merge room doc
    await setDoc(roomDoc, {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    // enforce max players
    const cnt = await getCountFromServer(playersCol);
    if (cnt.data().count >= maxPlayers){
      throw new Error("Room is full");
    }

    // presence
    const meDoc = doc(playersCol, _me.id);
    await setDoc(meDoc, {
      name: _me.name,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    }, { merge: true });

    // heartbeat every 15s
    _presenceTimer = setInterval(() => {
      updateDoc(meDoc, { lastSeen: serverTimestamp() }).catch(()=>{});
    }, 15000);

    // listen for deltas (ordered by client timestamp)
    const q = query(deltasCol, orderBy("t", "asc"));
    _unsubMoves = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== "added") return;
        const { delta, _from } = ch.doc.data();
        if (_from === _me.id) return;         // ignore our own echo
        if (Net.onDelta && delta) Net.onDelta(delta);
      });
    });

    // keep refs
    _room = { id: roomId, meDoc };
    _deltasCol = deltasCol;
    _playersCol = playersCol;

    return roomId;
  },

  /** Leave the current room and stop listeners */
  async leaveRoom(){
    if (_unsubMoves){ _unsubMoves(); _unsubMoves = null; }
    if (_presenceTimer){ clearInterval(_presenceTimer); _presenceTimer = null; }
    _room = null;
    _deltasCol = null;
    _playersCol = null;
  },

  /** Send a game delta (small JSON) to the room */
  async sendDelta(delta){
    if (!_deltasCol) return;
    await addDoc(_deltasCol, {
      delta,
      _from: _me.id,
      t: Date.now(),
      ts: serverTimestamp()
    });
    // touch room updatedAt
    if (_room){
      await updateDoc(doc(db, "games", _room.id), { updatedAt: serverTimestamp() }).catch(()=>{});
    }
  },

  /** (Optional) kick all data for the room (dev only) */
  async _devNukeRoom(roomId){
    const { roomDoc, deltasCol, playersCol } = roomPaths(roomId);
    // Danger: deletes everything in the room (client-side iteration)
    // Use with caution only in development.
    const deltasSnap = await getDocs(deltasCol);
    const playersSnap = await getDocs(playersCol);
    await Promise.all([
      ...deltasSnap.docs.map(d=>deleteDoc(d.ref)),
      ...playersSnap.docs.map(d=>deleteDoc(d.ref)),
      deleteDoc(roomDoc)
    ]);
  }
};

// Expose to your non-module script.js:
window.Net = Net;