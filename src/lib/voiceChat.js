// voiceChat.js: proximity voice chat for Naija City
// Audio goes peer-to-peer over WebRTC. Firebase Firestore is only used for signaling
// (swapping connection offers/answers). Works with Next.js 14 + Firebase v9+.
//
// USAGE (in your game client, after the player is signed in with Firebase Auth):
//
//   import { VoiceChat } from './voiceChat';
//   const voice = new VoiceChat({ db, myId: user.uid, radius: 18, onState: (e) => console.log(e) });
//   startButton.onclick = () => voice.start();          // must be a click: browsers block mic/audio otherwise
//   setInterval(() => voice.update({ x: me.x, z: me.z }, otherPlayersById), 500);
//        // otherPlayersById = { uid1: { x, z }, uid2: { x, z }, ... }  (from your game state)
//   muteButton.onclick = () => voice.setMuted(!voice.muted);
//   window.onbeforeunload = () => voice.stop();
//
// FIRESTORE RULES (minimum):
//   match /calls/{id} { allow read, write: if request.auth != null;
//     match /{sub=**} { allow read, write: if request.auth != null; } }
// Also enable a TTL policy on the field "expireAt" for the "calls" collection so stale calls clean themselves up.

import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, addDoc, query, where, Timestamp,
} from 'firebase/firestore';

// STUN is free. TURN is a relay that ~10-20% of players need (mobile carriers, strict NATs).
// Add your own TURN (self-hosted coturn, or a free-tier relay service) before launch.
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // { urls: 'turn:YOUR_TURN_HOST:3478', username: 'USER', credential: 'PASS' },
  ],
};

export class VoiceChat {
  constructor({ db, myId, radius = 18, maxPeers = 4, onState = () => {} }) {
    this.db = db; this.myId = myId; this.radius = radius; this.maxPeers = maxPeers; this.onState = onState;
    this.peers = new Map();      // peerId -> { pc, audio, callId, caller, unsubs: [] }
    this.stream = null; this.muted = false; this.unsubIncoming = null;
  }

  // Ask for the mic and start listening for incoming calls. Call from a click handler.
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const q = query(collection(this.db, 'calls'), where('to', '==', this.myId));
    this.unsubIncoming = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const d = ch.doc.data();
        if (d.answer || this.peers.has(d.from)) return;
        this._answer(ch.doc.id, d);
      });
    });
  }

  // Call this about twice a second with positions. Connects to nearby players, hangs up on far ones.
  update(me, others) {
    if (!this.stream) return;
    const near = [];
    for (const [id, p] of Object.entries(others)) {
      if (id === this.myId) continue;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d <= this.radius) near.push([id, d]);
      const peer = this.peers.get(id);
      if (peer) {
        if (d > this.radius + 4) this._hangup(id);                                  // hysteresis: avoids flapping
        else if (peer.audio) peer.audio.volume = Math.max(0, Math.min(1, 1 - (d / this.radius) ** 2)); // quieter when farther
      }
    }
    near.sort((a, b) => a[1] - b[1]).slice(0, this.maxPeers).forEach(([id]) => {
      // The player with the smaller id always calls. This prevents both sides calling at once.
      if (!this.peers.has(id) && this.myId < id) this._call(id);
    });
  }

  setMuted(m) {
    this.muted = m;
    if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = !m));
    this.onState({ type: 'mute', muted: m });
  }

  stop() {
    [...this.peers.keys()].forEach((id) => this._hangup(id));
    if (this.unsubIncoming) this.unsubIncoming();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // ---- internals ----
  _makePeer(peerId, callId, caller) {
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio(); audio.autoplay = true;
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => {
      this.onState({ type: 'state', peerId, state: pc.connectionState });
      if (['failed', 'closed'].includes(pc.connectionState)) this._hangup(peerId);
    };
    const peer = { pc, audio, callId, caller, unsubs: [] };
    this.peers.set(peerId, peer);
    return peer;
  }

  async _call(peerId) {
    const callId = `${this.myId}_${peerId}_${Date.now()}`;
    const ref = doc(this.db, 'calls', callId);
    const peer = this._makePeer(peerId, callId, true);
    const { pc } = peer;
    pc.onicecandidate = (e) => e.candidate && addDoc(collection(ref, 'callerCandidates'), e.candidate.toJSON());
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await setDoc(ref, {
      from: this.myId, to: peerId, offer: { type: offer.type, sdp: offer.sdp },
      expireAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    });
    peer.unsubs.push(onSnapshot(ref, (s) => {
      const d = s.data();
      if (d && d.answer && !pc.currentRemoteDescription) pc.setRemoteDescription(d.answer);
    }));
    peer.unsubs.push(onSnapshot(collection(ref, 'calleeCandidates'), (s) =>
      s.docChanges().forEach((c) => c.type === 'added' && pc.addIceCandidate(c.doc.data()).catch(() => {}))));
  }

  async _answer(callId, d) {
    const ref = doc(this.db, 'calls', callId);
    const peer = this._makePeer(d.from, callId, false);
    const { pc } = peer;
    pc.onicecandidate = (e) => e.candidate && addDoc(collection(ref, 'calleeCandidates'), e.candidate.toJSON());
    await pc.setRemoteDescription(d.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(ref, { answer: { type: answer.type, sdp: answer.sdp } });
    peer.unsubs.push(onSnapshot(collection(ref, 'callerCandidates'), (s) =>
      s.docChanges().forEach((c) => c.type === 'added' && pc.addIceCandidate(c.doc.data()).catch(() => {}))));
    // If the caller deletes the call doc, hang up here too.
    peer.unsubs.push(onSnapshot(ref, (s) => { if (!s.exists()) this._hangup(d.from); }));
  }

  _hangup(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.unsubs.forEach((u) => u());
    peer.pc.close();
    peer.audio.srcObject = null;
    if (peer.caller) deleteDoc(doc(this.db, 'calls', peer.callId)).catch(() => {});
    this.onState({ type: 'closed', peerId });
  }
}
