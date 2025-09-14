// network.js (type="module")
// Minimal Firestore transport for two-player online play.

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot,
  collection, addDoc, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

/* Firebase handles (reuse app from index.html) */
const app  = getApp();
const db   = getFirestore(app);
const auth = getAuth(app);

/* Local identity and room state */
let me = { uid: null, name: "Player" };
let roomId = null;
let deltasUnsub = null;
let stateUnsub  = null;
let snapshotProvider = null;

/* Public API */
const Net = {
  async identify({ name }) {
    if (typeof name === "string" && name.trim()) {
      me.name = name.trim().slice(0, 32);
      try { if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: me.name }); } catch {}
      if (roomId) {
        await setDoc(doc(db, "rooms", roomId, "players", me.uid), {
          name: me.name, updatedAt: serverTimestamp()
        }, { merge: true });
      }
    }
  },

  registerSnapshotProvider(fn) { snapshotProvider = fn; },

  async joinRoom(code, { maxPlayers = 2 } = {}) {
    if (!me.uid) await ensureAuth();
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

    // Load or publish snapshot
    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    const snapDoc = await getDoc(snapRef);
    if (snapDoc.exists()) {
      const state = snapDoc.data()?.state;
      if (state && Net.onDelta) {
        try { Net.onDelta({ type: "SNAPSHOT", state }); } catch {}
      }
    } else if (snapshotProvider) {
      try {
        const state = snapshotProvider();
        await setDoc(snapRef, { state, updatedAt: serverTimestamp() });
        await addDoc(collection(db, "rooms", roomId, "deltas"), {
          type: "SNAPSHOT", state, uid: me.uid, ts: serverTimestamp()
        });
      } catch (e) { console.warn("Snapshot publish failed:", e); }
    }

    // Listen for deltas (ignore our own)
    const deltasRef = collection(db, "rooms", roomId, "deltas");
    const q = query(deltasRef, orderBy("ts", "asc"), limit(200));
    deltasUnsub?.();
    deltasUnsub = onSnapshot(q, (qs) => {
      qs.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const d = change.doc.data();
        if (!d || d.uid === me.uid) return;
        try { Net.onDelta && Net.onDelta(stripFirestoreMeta(d)); } catch {}
      });
    });

    // Watch snapshot doc too
    stateUnsub?.();
    stateUnsub = onSnapshot(snapRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const state = docSnap.data()?.state;
      if (state && Net.onDelta) {
        try { Net.onDelta({ type: "SNAPSHOT", state }); } catch {}
      }
    });

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

window.Net = Net;

/* Helpers */
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
function ensureAuth() {
  return new Promise((resolve) => {
    if (auth.currentUser) {
      me.uid = auth.currentUser.uid;
      me.name = auth.currentUser.displayName || me.name;
      resolve();
      return;
    }
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        me.uid = user.uid;
        me.name = user.displayName || me.name;
        resolve();
      } else {
        await signInAnonymously(auth);
        // will resolve on next auth state change
      }
    });
  });
}