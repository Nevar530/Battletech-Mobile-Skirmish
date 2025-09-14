// network.js  (type="module")
import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot,
  collection, addDoc, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, updateProfile
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

// Reuse the app you initialized in index.html
const app  = getApp();
const db   = getFirestore(app);
const auth = getAuth(app);

// Local identity
let me = { uid: null, name: "Player" };

// Attach immediately; if anonymous sign-in is disabled you’ll get a clear error
async function ensureAuth() {
  if (auth.currentUser) {
    me.uid  = auth.currentUser.uid;
    me.name = auth.currentUser.displayName || me.name;
    return;
  }
  try {
    const cred = await signInAnonymously(auth);
    me.uid  = cred.user.uid;
    me.name = cred.user.displayName || me.name;
  } catch (e) {
    if (e?.code === 'auth/operation-not-allowed') {
      throw new Error('Anonymous sign-in is disabled in Firebase → Authentication → Sign-in method → Anonymous.');
    }
    throw new Error('Auth failed: ' + (e?.message || e));
  }
}

// Room/session state
let roomId = null;
let deltasUnsub = null;
let stateUnsub  = null;
let snapshotProvider = null;

// Public API
const Net = {
  async identify({ name }) {
    if (typeof name === "string" && name.trim()) {
      me.name = name.trim().slice(0, 32);
      try { await updateProfile(auth.currentUser, { displayName: me.name }); } catch {}
      if (roomId) {
        await setDoc(doc(db, "rooms", roomId, "players", me.uid), {
          name: me.name, updatedAt: serverTimestamp()
        }, { merge: true });
      }
    }
  },

  registerSnapshotProvider(fn) { snapshotProvider = fn; },

  async joinRoom(code, { maxPlayers = 2 } = {}) {
    await ensureAuth(); // <— if disabled, this throws and you’ll see an alert
    roomId = normalizeCode(code);
    if (!roomId) throw new Error("Bad room code");

    // Create/merge room
    const roomRef = doc(db, "rooms", roomId);
    await setDoc(roomRef, {
      createdAt: serverTimestamp(),
      createdBy: me.uid,
      maxPlayers
    }, { merge: true });

    // Presence
    await setDoc(doc(db, "rooms", roomId, "players", me.uid), {
      name: me.name,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    // Snapshot (host publishes if none)
    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    const snapDoc = await getDoc(snapRef);
    if (snapDoc.exists()) {
      const state = snapDoc.data()?.state;
      if (state && Net.onDelta) Net.onDelta({ type: "SNAPSHOT", state });
    } else if (snapshotProvider) {
      const state = snapshotProvider();
      await setDoc(snapRef, { state, updatedAt: serverTimestamp() });
      await addDoc(collection(db, "rooms", roomId, "deltas"), {
        type: "SNAPSHOT",
        state,
        uid: me.uid,
        ts: serverTimestamp()
      });
    }

    // Listen for incoming deltas (ignore my own)
    deltasUnsub?.();
    const qD = query(collection(db, "rooms", roomId, "deltas"), orderBy("ts", "asc"), limit(200));
    deltasUnsub = onSnapshot(qD, (qs) => {
      qs.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const d = change.doc.data();
        if (!d || d.uid === me.uid) return;
        try { Net.onDelta && Net.onDelta(stripMeta(d)); } catch {}
      });
    });

    // Also watch snapshot doc (late updates)
    stateUnsub?.();
    stateUnsub = onSnapshot(snapRef, (docSnap) => {
      const data = docSnap.data();
      const state = data?.state;
      if (state && Net.onDelta) {
        try { Net.onDelta({ type: "SNAPSHOT", state }); } catch {}
      }
    });

    // Quick toast so you know it worked
    try { toast('Online: connected'); } catch { console.log('[Net] connected'); }

    return roomId;
  },

  async sendDelta(delta) {
    if (!roomId) throw new Error("Not in a room");
    if (!delta || typeof delta !== "object") return;

    if (delta.type === "SNAPSHOT" && delta.state) {
      await setDoc(doc(db, "rooms", roomId, "state", "snapshot"), {
        state: delta.state, updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await addDoc(collection(db, "rooms", roomId, "deltas"), {
      ...delta,
      uid: me.uid,
      ts: serverTimestamp()
    });
  },

  onDelta: null
};

// Expose
window.Net = Net;

/* ----- helpers ----- */
function normalizeCode(code) {
  return String(code || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
function stripMeta(d) {
  const { ts, uid, ...rest } = d || {};
  return rest;
}
function toast(msg) {
  // tiny inline toast (non-blocking)
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position:'fixed', bottom:'12px', left:'12px', padding:'8px 10px',
    background:'rgba(0,0,0,.75)', color:'#fff', borderRadius:'6px',
    font:'14px/1.2 system-ui, sans-serif', zIndex:99999
  });
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 1400);
}