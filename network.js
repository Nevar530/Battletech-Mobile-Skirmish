// network.js  (must be loaded with type="module")    
 
import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, onSnapshot, serverTimestamp, collection
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

// Use the app you initialize in index.html
const app  = getApp();
const db   = getFirestore(app);
const auth = getAuth(app);

// ---- identity ----
let identity = {
  uid: null,
  name:
    (typeof localStorage !== "undefined" && localStorage.getItem("playerLabel")) ||
    "Player"
};

let currentRoom = null;
let unsubState  = null;
let unsubSheets = null;  // NEW: for the per-sheet listener

// ---- auth (anonymous) ----
async function ensureAuth() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    onAuthStateChanged(auth, async (user) => {
      if (resolved) return;
      if (user) {
        identity.uid = user.uid;
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

  // Set/remember a display name for meta.sender
  identify({ name } = {}) {
    if (!name) return;
    identity.name = String(name).slice(0, 48);
    try { localStorage.setItem("playerLabel", identity.name); } catch {}
  },

  // Join or create a room by a 3-word code
  async joinRoom(code) {
    if (!code) throw new Error("Room code required");
    await ensureAuth();

    const roomId = String(code).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

    currentRoom = roomId;
    window.dispatchEvent(new CustomEvent('net-room', { detail: { roomId } }));


    // Listen for full-state updates (single doc)
    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    unsubState?.();
    unsubState = onSnapshot(snapRef, (docSnap) => {
      const obj = docSnap.data()?.state;
      if (!obj || typeof Net.onSnapshot !== "function") return;

      // Ignore our own echo (saves extra work, not a behavior change)
      if (obj?.meta?.senderUid && obj.meta.senderUid === identity.uid) return;

      try { Net.onSnapshot(obj); } catch {}
    });

    // Create-if-missing WITHOUT a read (saves 1 read)
    await setDoc(snapRef, { state: null, updatedAt: serverTimestamp() }, { merge: true });

    return roomId;
  },

  // Send the whole game state (plain JSONable object) — debounced
  // Backward compatible: callers can keep using sendSnapshot(stateObj)
  _sendTimer: null,
  async _write(stateObj) {
    if (!currentRoom) throw new Error("Join a room first");

    // Always attach sender metadata so the peer can display who transmitted.
    const payload = {
      ...stateObj,
      meta: {
        ...(stateObj?.meta || {}),
        sender: identity.name,
        senderUid: identity.uid || null,
        ts: Date.now()
      }
    };

    const snapRef = doc(db, "rooms", currentRoom, "state", "snapshot");
    await setDoc(
      snapRef,
      { state: payload, updatedAt: serverTimestamp() },
      { merge: true }
    );
  },
  sendSnapshot(stateObj, ms = 350) {
    clearTimeout(Net._sendTimer);
    Net._sendTimer = setTimeout(() => Net._write(stateObj), ms);
  },

  // Send a single mech sheet for this room (mapId + tokenId)
  async sendSheet(mapId, tokenId, sheetData) {
    if (!currentRoom) return;
    if (!mapId || !tokenId || !sheetData) return;

    try {
      const sheetsRef = collection(db, "rooms", currentRoom, "sheets");
      const sheetRef  = doc(sheetsRef, `${mapId}::${tokenId}`);

      const payload = {
        mapId,
        tokenId,
        sheet: sheetData,
        sender: identity.name || null,
        senderUid: identity.uid || null,
        updatedAt: serverTimestamp()
      };

      await setDoc(sheetRef, payload, { merge: true });
    } catch (err) {
      console.warn("[Net.sendSheet] failed", err);
    }
  },

  // Start listening for sheet updates in the current room
  subscribeSheets() {
    if (!currentRoom) return;

    // clean up any prior listener
    if (typeof unsubSheets === "function") {
      try { unsubSheets(); } catch {}
      unsubSheets = null;
    }

    const roomId    = currentRoom;
    const sheetsRef = collection(db, "rooms", roomId, "sheets");

    unsubSheets = onSnapshot(
      sheetsRef,
      (snap) => {
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (!data || !data.mapId || !data.tokenId || !data.sheet) return;

          // optional: ignore our own echoes
          if (data.senderUid && data.senderUid === identity.uid) return;

          window.dispatchEvent(
            new CustomEvent("mss84:sheetRemoteUpdate", {
              detail: {
                mapId: data.mapId,
                tokenId: data.tokenId,
                sheet: data.sheet,
                sender: data.sender || null,
                changeType: change.type || "modified"
              }
            })
          );
        });
      },
      (err) => {
        console.warn("[Net.subscribeSheets] failed", err);
      }
    );
  },

  
  // Leave/cleanup (safe to call multiple times)
  leave() {
    unsubState?.();
    unsubState = null;

    if (typeof unsubSheets === "function") {
      try { unsubSheets(); } catch {}
    }
    unsubSheets = null;

    currentRoom = null;
  },

// >>> ADD BELOW (after the Net object is defined, before exposing window.Net)
Object.defineProperty(Net, 'roomId', {
  get: () => currentRoom
});


// expose globally and announce readiness
window.Net = Net;
window.dispatchEvent(new Event("net-ready"));
