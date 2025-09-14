// ---- network.js (ES module) ----
// Requires Firebase initialized in your HTML BEFORE this file:
// <script type="module">
//   import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
//   import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
//   const app = initializeApp(firebaseConfig);
//   window._db = getFirestore(app);
// </script>

import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, onSnapshot,
  serverTimestamp, query, orderBy, getCountFromServer, getDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// Use the db created in index.html, or fall back to getFirestore()
const db = (window._db ?? getFirestore());

// --- tiny helpers
function normalize(code){ return code.trim().toLowerCase().replace(/\s+/g,"-").replace(/-+/g,"-"); }
function shortHash(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h<<5)-h+str.charCodeAt(i); h|=0; } return (h>>>0).toString(36); }
function paths(roomId){
  const games = collection(db, "games");
  const roomDoc = doc(games, roomId);
  return {
    roomDoc,
    playersCol: collection(roomDoc, "players"),
    deltasCol:  collection(roomDoc, "deltas"),
    signalsDoc: doc(roomDoc, "signals", "session"),
    iceCol:     collection(roomDoc, "ice")
  };
}

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// --- internal state
let _room = null;
let _me = { id: crypto.randomUUID(), name: "Player" };
let _pc = null, _dc = null;
let _playersCol = null, _deltasCol = null, _signalsDoc = null, _iceCol = null;
let _unsubMoves = null, _unsubPlayers = null, _presenceTimer = null;
let _getSnapshot = null;

// create PC if needed
async function ensurePC(){
  if (_pc) return _pc;
  _pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  _pc.onicecandidate = async (e) => {
    if (!e.candidate || !_iceCol) return;
    await addDoc(_iceCol, { from:_me.id, candidate: e.candidate.toJSON(), ts: serverTimestamp() });
  };

  _pc.ondatachannel = (e) => { _dc = e.channel; wireDC(); };
  _pc.onconnectionstatechange = () => {
    // console.log('RTCPeerConnection:', _pc.connectionState);
  };
  return _pc;
}

function wireDC(){
  if (!_dc) return;
  _dc.onopen = () => { /* console.log('DataChannel open'); */ };
  _dc.onclose = () => { /* console.log('DataChannel closed'); */ };
  _dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg?.type === "_ping") { safeSend({ type:"_pong", t: msg.t }); return; }
      if (msg?.type === "_pong") { return; }
      if (Net.onDelta) Net.onDelta(msg);
    } catch {}
  };
}

function safeSend(obj){
  if (_dc && _dc.readyState === "open") {
    _dc.send(JSON.stringify(obj));
  } else if (_deltasCol && obj?.type && obj.type !== "_ping" && obj.type !== "_pong") {
    // Firestore fallback
    addDoc(_deltasCol, { delta: obj, _from: _me.id, t: Date.now(), ts: serverTimestamp() }).catch(()=>{});
  }
}

// ---- Public API expected by script.js glue
const Net = {
  onDelta: null,

  identify({ id, name } = {}) { if (id) _me.id = id; if (name) _me.name = name; },

  registerSnapshotProvider(fn){ _getSnapshot = fn; },

  async joinRoom(code, { maxPlayers = 2 } = {}){
    if (!code) throw new Error("Room code required");
    const base = normalize(code);
    const roomId = `${base}-${shortHash(base).slice(0,6)}`;
    const { roomDoc, playersCol, deltasCol, signalsDoc, iceCol } = paths(roomId);

    await setDoc(roomDoc, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });

    const cnt = await getCountFromServer(playersCol);
    if (cnt.data().count >= maxPlayers) throw new Error("Room is full");

    // presence
    const meDoc = doc(playersCol, _me.id);
    await setDoc(meDoc, { name:_me.name, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }, { merge: true });
    _presenceTimer = setInterval(()=> updateDoc(meDoc, { lastSeen: serverTimestamp() }).catch(()=>{}), 15000);

    // listen Firestore fallback deltas (ordered)
    _unsubMoves = onSnapshot(query(deltasCol, orderBy("t", "asc")), (snap)=>{
      snap.docChanges().forEach(ch=>{
        if (ch.type !== "added") return;
        const { delta, _from } = ch.doc.data();
        if (_from === _me.id) return;
        if (delta && Net.onDelta) Net.onDelta(delta);
      });
    });

    _room = { id: roomId, meDoc };
    _playersCol = playersCol; _deltasCol = deltasCol; _signalsDoc = signalsDoc; _iceCol = iceCol;

    // role
    const sess = await getDoc(signalsDoc);
    const isHost = !sess.exists() || !sess.data()?.offer;

    await ensurePC();

    if (isHost){
      _dc = _pc.createDataChannel("moves");
      wireDC();
      const offer = await _pc.createOffer();
      await _pc.setLocalDescription(offer);
      await setDoc(signalsDoc, { offer, createdAt: serverTimestamp() }, { merge: true });

      // wait for answer
      onSnapshot(signalsDoc, async (s)=>{
        const data = s.data();
        if (!data?.answer || _pc.currentRemoteDescription) return;
        await _pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      });

    } else {
      // guest: consume offer → post answer
      onSnapshot(signalsDoc, async (s)=>{
        const data = s.data();
        if (data?.offer && !_pc.currentRemoteDescription){
          await _pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await _pc.createAnswer();
          await _pc.setLocalDescription(answer);
          await setDoc(signalsDoc, { answer, answeredAt: serverTimestamp() }, { merge: true });
        }
      });
    }

    // ICE exchange (bi-directional through the same iceCol)
    onSnapshot(iceCol, async (snap)=>{
      snap.docChanges().forEach(async (ch)=>{
        if (ch.type !== "added") return;
        const c = ch.doc.data();
        if (c.from === _me.id || !c.candidate) return;
        try { await _pc.addIceCandidate(c.candidate); } catch {}
      });
    });

    // Send snapshot once 2 players present (host side best-effort)
    _unsubPlayers = onSnapshot(playersCol, async (snap)=>{
      const ids = snap.docs.map(d=>d.id);
      if (ids.length >= 2 && isHost) {
        setTimeout(()=> Net.sendSnapshot().catch(()=>{}), 400);
      }
    });

    // lightweight keepalive
    setInterval(()=>{ safeSend({ type:"_ping", t: Date.now() }); }, 10000);

    return roomId;
  },

  async leaveRoom(){
    if (_unsubMoves){ _unsubMoves(); _unsubMoves=null; }
    if (_unsubPlayers){ _unsubPlayers(); _unsubPlayers=null; }
    if (_presenceTimer){ clearInterval(_presenceTimer); _presenceTimer=null; }
    if (_dc){ try{ _dc.close(); }catch{} _dc=null; }
    if (_pc){ try{ _pc.close(); }catch{} _pc=null; }
    _room=null; _playersCol=null; _deltasCol=null; _signalsDoc=null; _iceCol=null;
  },

  async sendDelta(delta){
    safeSend(delta);
    if (_room) updateDoc(doc(db,"games",_room.id), { updatedAt: serverTimestamp() }).catch(()=>{});
  },

  async sendSnapshot(){
    if (!_getSnapshot) return;
    const state = _getSnapshot();
    safeSend({ type:"SNAPSHOT", state });
  }
};

// expose globally
window.Net = Net;