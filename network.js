// network.js  (type="module")
// Minimal Firestore transport for two-player “local-feel” online play.

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot,
  collection, addDoc, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

// ---- Firebase handles (re-uses the app you init in index.html) ----
const app = getApp();
const db  = getFirestore(app);
const auth = getAuth(app);

// ---- local identity ----
let me = { uid: null, name: "Player" };
await ensureAuth();

// ---- room/session ----
let roomId = null;
let deltasUnsub = null;
let stateUnsub  = null;
let snapshotProvider = null;

// Public API container
const Net = {
  /** Optional: set display name; updates presence when in a room */
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

  /** Provide a function that returns your full game state (plain object) */
  registerSnapshotProvider(fn) { snapshotProvider = fn; },

  /** Create/join a room (3-word code like “rat-man-dog”) */
  async joinRoom(code, { maxPlayers = 2 } = {}) {
    if (!me.uid) await ensureAuth();
    roomId = normalizeCode(code);
    if (!roomId) throw new Error("Bad room code");

    // Create/merge room doc
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

    // 1) Load snapshot if present
    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    const snapDoc = await getDoc(snapRef);
    if (snapDoc.exists()) {
      const data = snapDoc.data();
      const state = data?.state;
      if (state && window.Net?.onDelta) {
        // Deliver as a SNAPSHOT message to game
        try { Net.onDelta({ type: "SNAPSHOT", state }); } catch {}
      }
    } else {
      // No snapshot yet → if we’re the first/host and we can export, publish one
      if (snapshotProvider) {
        try {
          const state = snapshotProvider();
          await setDoc(snapRef, { state, updatedAt: serverTimestamp() });
          // also notify peer as a delta (harmless if they miss it; they read doc above)
          await addDoc(collection(db, "rooms", roomId, "deltas"), {
            type: "SNAPSHOT",
            state,
            uid: me.uid,
            ts: serverTimestamp()
          });
        } catch (e) { console.warn("Snapshot publish failed:", e); }
      }
    }

    // 2) Live deltas listener (ignore our own)
    const deltasRef = collection(db, "rooms", roomId, "deltas");
    const q = query(deltasRef, orderBy("ts", "asc"), limit(200));
    deltasUnsub?.(); // safety
    deltasUnsub = onSnapshot(q, (qs) => {
      qs.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const d = change.doc.data();
        if (!d || d.uid === me.uid) return;
        // Deliver to game
        try { Net.onDelta && Net.onDelta(stripFirestoreMeta(d)); } catch {}
      });
    });

    // 3) Also watch snapshot doc so late joins get updates if host overwrites it
    stateUnsub?.();
    stateUnsub = onSnapshot(snapRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      const state = data?.state;
      if (state && Net.onDelta) {
        try { Net.onDelta({ type: "SNAPSHOT", state }); } catch {}
      }
    });

    return roomId;
  },

  /** Send a game delta (plain object). Will be seen by the other player. */
  async sendDelta(delta) {
    if (!roomId) throw new Error("Not in a room");
    if (!delta || typeof delta !== "object") return;

    // If someone explicitly sends a SNAPSHOT delta, persist it to the snapshot doc too
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

  /** Your game sets this: (delta) => void */
  onDelta: null,
};

// expose
window.Net = Net;

/* ---------- helpers ---------- */
function normalizeCode(code) {
  return String(code || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
function stripFirestoreMeta(d) {
  const { ts, uid, ...rest } = d || {};
  return rest;
}
async function ensureAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        me.uid = user.uid;
        me.name = user.displayName || me.name;
        resolve();
      } else {
        await signInAnonymously(auth);
        // onAuthStateChanged will fire again and resolve
      }
    });
  });
}