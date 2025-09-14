// network.js  (type="module")
// Full-snapshot sync only: join room, listen, push snapshot.

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const app  = getApp();                  // you already initialize in index.html
const db   = getFirestore(app);
const auth = getAuth(app);

let roomId = null;
let unsub  = null;

// anon auth up-front
await new Promise((resolve) => {
  onAuthStateChanged(auth, async (u) => {
    if (u) resolve();
    else await signInAnonymously(auth);
  });
});

function codeToId(code){
  return String(code||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48);
}

const Net = {
  async joinRoom(code){
    roomId = codeToId(code);
    if (!roomId) throw new Error("Bad room code");

    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    // ensure doc exists so listener attaches cleanly
    const cur = await getDoc(snapRef);
    if (!cur.exists()) {
      await setDoc(snapRef, { state:null, updatedAt:serverTimestamp() });
    }

    // listen for remote sends
    unsub?.();
    unsub = onSnapshot(snapRef, (d) => {
      const data = d.data();
      if (data && data.state && Net.onSnapshot) {
        try { Net.onSnapshot(data.state); } catch {}
      }
    });

    window.dispatchEvent(new CustomEvent("net-ready"));
    return roomId;
  },

  async sendSnapshot(stateObj){
    if (!roomId) throw new Error("Not in a room");
    const snapRef = doc(db, "rooms", roomId, "state", "snapshot");
    await setDoc(snapRef, { state: stateObj, updatedAt: serverTimestamp() }, { merge:true });
  },

  onSnapshot: null, // (stateObj)=>void
};

window.Net = Net;