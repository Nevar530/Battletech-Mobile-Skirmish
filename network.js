<!-- keep this as a separate file: network.js -->
<script type="module">
import {
  getApp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc,
  serverTimestamp, onSnapshot, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

/* ========= Helpers ========= */
function normCode(code){
  return code.trim().toLowerCase().replace(/[^a-z ]/g,' ').split(/\s+/).filter(Boolean).slice(0,3).join('-');
}
function randomId(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/* ========= Net API scaffold ========= */
const Net = {
  isConnected:false,
  isHost:false,
  roomId:null,
  me:{ id: randomId(), name: 'Player' },

  onDelta: null,                // set by script.js (applyDelta)
  onPeerJoin: null,             // optional
  _snapshotProvider: null,      // set by script.js (exportFullState)

  identify({name}){ this.me.name = (name||'Player').slice(0,32); },

  registerSnapshotProvider(fn){ this._snapshotProvider = fn; },

  async joinRoom(code, { maxPlayers=2 } = {}){
    const app = getApp();
    const db  = getFirestore(app);

    const rid = normCode(code);
    const roomRef = doc(db, 'rooms', rid);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) {
      // Create room — I’m host
      await setDoc(roomRef, {
        createdAt: serverTimestamp(),
        hostId: Net.me.id,
        maxPlayers,
        code: rid
      }, { merge:true });
      Net.isHost = true;
      console.log('[Net] created room, host:', rid);
    } else {
      const data = roomSnap.data() || {};
      Net.isHost = (data.hostId === Net.me.id); // usually false for joiners
      console.log('[Net] joining existing room:', rid);
    }

    Net.roomId = rid;
    Net.isConnected = true;

    // Presence (lightweight)
    await setDoc(doc(db, 'rooms', rid, 'presence', Net.me.id), {
      id: Net.me.id,
      name: Net.me.name,
      joinedAt: serverTimestamp()
    }, { merge:true });

    // Stream events (ordered)
    const evColl = collection(db, 'rooms', rid, 'events');
    const qEv    = query(evColl, orderBy('ts', 'asc'), limit(500));
    onSnapshot(qEv, (snap) => {
      snap.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const evt = change.doc.data();
        // Ignore my own writes
        if (evt.senderId === Net.me.id) return;

        if (evt.kind === 'delta') {
          console.log('[Net<-] delta', evt.payload);
          Net.onDelta && Net.onDelta(evt.payload);
        } else if (evt.kind === 'snapshot') {
          console.log('[Net<-] snapshot');
          Net.onDelta && Net.onDelta({ type:'SNAPSHOT', state: evt.payload });
        } else if (evt.kind === 'peer-join') {
          console.log('[Net] peer joined:', evt.payload?.id);
          Net.onPeerJoin && Net.onPeerJoin(evt.payload);
          // If I'm host, push a snapshot to help the newcomer sync
          if (Net.isHost && Net._snapshotProvider) {
            const full = Net._snapshotProvider();
            addDoc(evColl, {
              kind:'snapshot',
              senderId: Net.me.id,
              ts: serverTimestamp(),
              to: evt.payload?.id || null,  // not enforced, but logged
              payload: full
            });
            console.log('[Net->] sent snapshot to newcomer');
          }
        }
      });
    });

    // Emit a peer-join event so the host knows to send a snapshot
    await addDoc(evColl, {
      kind:'peer-join',
      senderId: Net.me.id,
      ts: serverTimestamp(),
      payload: { id: Net.me.id, name: Net.me.name }
    });

    return rid;
  },

  async sendDelta(delta){
    if (!this.isConnected || !this.roomId) return;
    const db = getFirestore(getApp());
    const evColl = collection(db, 'rooms', this.roomId, 'events');

    console.log('[Net->] delta', delta);
    await addDoc(evColl, {
      kind:'delta',
      senderId: Net.me.id,
      ts: serverTimestamp(),
      payload: delta
    });
  }
};

window.Net = Net;
</script>