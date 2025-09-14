// ===== network.js (WebRTC via Firestore signaling; host-authoritative) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = window.FIREBASE_CONFIG; // from index.html boot script
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];

const Net = {
  onDelta: null,
  _snapshotProvider: null,
  _room: null,
  _peer: null,
  _role: "guest",
  _name: "Player",

  identify({ name }) { this._name = name || "Player"; },

  registerSnapshotProvider(fn) { this._snapshotProvider = fn; },

  get role(){ return this._role; },

  async joinRoom(code3words, { maxPlayers = 2 } = {}) {
    const code = code3words.trim().toLowerCase().replace(/\s+/g, "-");
    const roomRef = doc(db, "webrtc_rooms", code);

    const roomSnap = await getDoc(roomRef);
    const newRoom = !roomSnap.exists();

    // Host if room doesn't exist
    this._role = newRoom ? "host" : "guest";
    window.IS_GUEST = (this._role !== "host");

    const pc = new RTCPeerConnection({ iceServers });
    this._peer = pc;
    this._room = { id: code, ref: roomRef };

    const dc = pc.createDataChannel("bt-delta", { ordered: true });
    const state = { open:false };
    let remoteSet = false;

    // DataChannel plumbing
    dc.onopen = () => { state.open = true; };
    dc.onclose = () => { state.open = false; };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (!msg || typeof msg !== "object") return;

        // Snapshot request/response
        if (msg._kind === "SNAPSHOT_REQUEST" && this._role === "host" && this._snapshotProvider) {
          const snap = this._snapshotProvider();
          dc.send(JSON.stringify({ _kind:"SNAPSHOT", state: snap }));
          return;
        }
        if (msg._kind === "SNAPSHOT" && this.onDelta) {
          this.onDelta({ type:"SNAPSHOT", state: msg.state });
          return;
        }

        // Regular delta
        if (this.onDelta) this.onDelta(msg);
      } catch {}
    };

    // ICE to Firestore
    pc.onicecandidate = async (evt) => {
      if (!evt.candidate) return;
      await updateDoc(roomRef, {
        [`ice_${this._role}_${Date.now()}`]: JSON.stringify(evt.candidate)
      }, { merge:true });
    };

    // Remote DC (if guest creates dc, host receives it here)
    pc.ondatachannel = (evt) => {
      const ch = evt.channel;
      ch.onmessage = dc.onmessage;
      ch.onopen    = dc.onopen;
      ch.onclose   = dc.onclose;
    };

    if (this._role === "host") {
      // Create or reset room doc
      await setDoc(roomRef, { offer:null, answer:null }, { merge:true });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await updateDoc(roomRef, { offer: JSON.stringify(offer) });

      // Watch for guest answer + ICE
      onSnapshot(roomRef, async (snap) => {
        const data = snap.data() || {};
        if (!remoteSet && data.answer) {
          await pc.setRemoteDescription(JSON.parse(data.answer));
          remoteSet = true;
        }
        for (const [k,v] of Object.entries(data)) {
          if (k.startsWith("ice_guest_") && v) {
            try { await pc.addIceCandidate(JSON.parse(v)); }
            catch {}
            // clear consumed ICE
            await updateDoc(roomRef, { [k]: deleteField() });
          }
        }
      });
    } else {
      // guest: read offer
      if (!roomSnap.exists() || !roomSnap.data().offer) {
        throw new Error("Host not ready — ask them to open the room first.");
      }
      await pc.setRemoteDescription(JSON.parse(roomSnap.data().offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(roomRef, { answer: JSON.stringify(answer) });

      // Watch host ICE
      onSnapshot(roomRef, async (snap) => {
        const data = snap.data() || {};
        for (const [k,v] of Object.entries(data)) {
          if (k.startsWith("ice_host_") && v) {
            try { await pc.addIceCandidate(JSON.parse(v)); }
            catch {}
            await updateDoc(roomRef, { [k]: deleteField() });
          }
        }
      });

      // Ask for snapshot when DC opens
      const tryAsk = () => { if (state.open) dc.send(JSON.stringify({ _kind:"SNAPSHOT_REQUEST" })); };
      dc.onopen = () => { state.open = true; tryAsk(); };
      // Also retry after 1s in case dc was replaced by ondatachannel path
      setTimeout(tryAsk, 1000);
    }

    // Public sender
    this.broadcastDelta = (delta) => {
      if (!state.open) return;
      try { dc.send(JSON.stringify(delta)); } catch {}
    };

    return code; // room id
  },

  broadcastDelta(_d){ /* replaced at join */ }
};

window.Net = Net;
export default Net;