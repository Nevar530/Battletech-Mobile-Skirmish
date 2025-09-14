// network.js  (must be loaded with type="module")

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

// Use the app you initialize in index.html
const app  = getApp();
const db   = getFirestore(app);
const auth = getAuth(app);

let me = { uid: null };
let currentRoom = null;
let unsubState = null;

// ---- auth (anonymous) ----
async function ensureAuth() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    onAuthStateChanged(auth, async (user) => {
      if (resolved) return;
      if (user) {
        me.uid = user.uid;
        resolved = true;
        resolve();
      } else {
        try {
          await signInAnonymously(auth);
          // onAuthStateChanged will fire again and resolve
        } catch (err) {
          resolved = true;
          reject(new Error(
            'Anonymous sign-in is not enabled. In Firebase Console → Authentication → Sign-in method, enable "Anonymous".'
          ));
        }
      }
    });
  });
}

// ---- tiny API ----
const Net = {
  // Set by your game: function(stateObj) {}
  onSnapshot: null,

  // Join or create a room by a 3-word code
  async joinRoom(code) {
    if (!code) throw new Error("Room code required");
    await ensureAuth();

    const roomId = String(code).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

    currentRoom = roomId;

    // Start listening for full-state updates
    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    unsubState?.();
    unsubState = onSnapshot(snapRef, (docSnap) => {
      const obj = docSnap.data()?.state;
      if (obj && typeof Net.onSnapshot === "function") {
        try { Net.onSnapshot(obj); } catch {}
      }
    });

    // Touch the doc so the collection exists
    const cur = await getDoc(snapRef);
    if (!cur.exists()) {
      await setDoc(snapRef, { state: null, updatedAt: serverTimestamp() }, { merge: true });
    }

    return roomId;
  },

  // Send the whole game state (plain JSONable object)
  async sendSnapshot(stateObj) {
    if (!currentRoom) throw new Error("Join a room first");
    const snapRef = doc(db, "rooms", currentRoom, "state", "snapshot");
    await setDoc(snapRef, { state: stateObj, updatedAt: serverTimestamp() }, { merge: true });
  },
};

// expose globally and announce readiness
window.Net = Net;
window.dispatchEvent(new Event("net-ready"));