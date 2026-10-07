'use client';
import { useEffect, useRef, useState } from 'react';
import { ref, set, onValue, onDisconnect, push, query, limitToLast, onChildAdded, serverTimestamp as rtNow } from 'firebase/database';
import { collection, doc, getDoc, getDocs, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, rtdb } from '@/lib/firebase';
import { VoiceChat } from '@/lib/voiceChat';

export default function GameFrame({ user, profile }) {
  const frame = useRef(null);
  const initRef = useRef(null);
  const me = useRef({ x: 0, z: 0, home: true });
  const others = useRef({});        // id -> {x, z}  (used for voice)
  const list = useRef([]);          // full player list (sent to the game)
  const voice = useRef(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [near, setNear] = useState(0);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const post = (m) => frame.current?.contentWindow?.postMessage(m, window.location.origin);
    const playerRef = ref(rtdb, 'players/' + user.uid);
    onDisconnect(playerRef).remove();           // remove my avatar if I close the tab
    const joinedAt = Date.now();
    let lastSend = 0, hidden = false;
    const unsubs = [];

    initRef.current = async () => {
      const snap = await getDoc(doc(db, 'profiles', user.uid));
      const ads = {};
      (await getDocs(collection(db, 'ads'))).forEach((d) => (ads[d.id] = d.data()));
      post({ type: 'init', name: profile.name, state: snap.data()?.state, ads });
    };
    if (frame.current?.contentDocument?.readyState === 'complete') initRef.current();

    // messages FROM the game
    const onMsg = (e) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'me') {
        me.current = { x: m.x, z: m.z, home: m.home };
        const now = Date.now();
        if (m.home) { if (!hidden) { set(playerRef, null); hidden = true; } return; }   // inside a house: hide from others
        hidden = false;
        if (now - lastSend < 120) return;
        lastSend = now;
        set(playerRef, { name: m.name, look: m.look || {}, x: +m.x.toFixed(2), z: +m.z.toFixed(2), ry: +m.ry.toFixed(2), t: rtNow() });
      } else if (m.type === 'chat') {
        push(ref(rtdb, 'chat'), { uid: user.uid, name: profile.name, text: String(m.text).slice(0, 120), x: me.current.x, z: me.current.z, t: rtNow() });
      } else if (m.type === 'save') {
        setDoc(doc(db, 'profiles', user.uid), { state: m.state, updatedAt: serverTimestamp() }, { merge: true });
      } else if (m.type === 'ad') {
        setDoc(doc(db, 'ads', String(m.i)), { ...m.ad, uid: user.uid });
      }
    };
    window.addEventListener('message', onMsg);

    // live players
    unsubs.push(onValue(ref(rtdb, 'players'), (s) => {
      const v = s.val() || {}, arr = [], o = {};
      Object.entries(v).forEach(([id, p]) => { if (id !== user.uid) { arr.push({ id, ...p }); o[id] = { x: p.x, z: p.z }; } });
      list.current = arr; others.current = o; setNear(arr.length);
    }));
    const t1 = setInterval(() => post({ type: 'players', list: list.current }), 100);

    // proximity chat: only hear people within 60 units
    unsubs.push(onChildAdded(query(ref(rtdb, 'chat'), limitToLast(20)), (s) => {
      const c = s.val();
      if (!c || c.uid === user.uid || !c.t || c.t < joinedAt - 60000) return;
      if (Math.hypot(c.x - me.current.x, c.z - me.current.z) <= 60) post({ type: 'chat', name: c.name, text: c.text });
    }));

    // shared billboards
    unsubs.push(onSnapshot(collection(db, 'ads'), (s) => {
      const ads = {}; s.forEach((d) => (ads[d.id] = d.data()));
      post({ type: 'ads', ads });
    }));

    // voice: connect to the nearest players, hang up on far ones
    const t2 = setInterval(() => voice.current?.update(me.current.home ? { x: 1e6, z: 1e6 } : me.current, others.current), 500);

    return () => {
      window.removeEventListener('message', onMsg);
      unsubs.forEach((u) => u());
      clearInterval(t1); clearInterval(t2);
      set(playerRef, null);
      voice.current?.stop();
    };
  }, [user.uid, profile.name]);

  async function joinVoice() {
    try {
      voice.current = new VoiceChat({ db, myId: user.uid, radius: 18, onState: (e) => e.type === 'mute' && setMuted(e.muted) });
      await voice.current.start();
      setVoiceOn(true); setMsg('');
    } catch (e) { setMsg('Mic blocked or unavailable: ' + e.message); }
  }

  return (
    <div className="fixed inset-0">
      <iframe ref={frame} src="/game.html" title="Naija City" className="w-full h-full border-0" allow="microphone; autoplay" onLoad={() => initRef.current && initRef.current()} />
      <div className="fixed top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-yellow-400 bg-black/70 px-3 py-1 text-xs">
        <span>👥 {near + 1} online</span>
        {!voiceOn
          ? <button className="rounded bg-yellow-400 px-2 py-1 font-bold text-black" onClick={joinVoice}>🎙 Join voice</button>
          : <button className="rounded bg-yellow-400 px-2 py-1 font-bold text-black" onClick={() => voice.current.setMuted(!muted)}>{muted ? '🔇 Unmute' : '🎙 Mute'}</button>}
        {msg && <span className="text-red-300">{msg}</span>}
      </div>
    </div>
  );
}
