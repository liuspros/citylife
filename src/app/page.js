'use client';
import { useEffect, useState } from 'react';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import GameFrame from '@/components/GameFrame';

const RESERVED = ['tunde_lagos', 'amaka_vibes', 'ogachidi', 'zainab.x', 'bolu_sk8']; // the built-in NPCs

export default function Home() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = needs a username
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

 useEffect(() => {
  // Store the unsubscribe method
  const unsubscribe = onAuthStateChanged(auth, async (u) => {
    if (!u) { 
      try { 
        await signInAnonymously(auth); 
      } catch (e) { 
        setErr('Sign-in failed: ' + e.message); 
      } 
      return; 
    }
    setUser(u);
    const s = await getDoc(doc(db, 'profiles', u.uid));
    setProfile(s.exists() && s.data().name ? s.data() : null);
  });

  // Return the cleanup function to React cleanly
  return () => unsubscribe();
}, []);


  async function claim() {
    const n = name.trim();
    if (!/^[A-Za-z0-9_.]{3,14}$/.test(n)) return setErr('3 to 14 letters, numbers, _ or .');
    if (RESERVED.includes(n.toLowerCase())) return setErr('That username is taken');
    setBusy(true); setErr('');
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'usernames', n.toLowerCase());
        const snap = await tx.get(ref);
        if (snap.exists() && snap.data().uid !== user.uid) throw new Error('taken');
        tx.set(ref, { uid: user.uid });
        tx.set(doc(db, 'profiles', user.uid), { name: n, createdAt: serverTimestamp() }, { merge: true });
      });
      setProfile({ name: n });
    } catch (e) {
      setErr(e.message === 'taken' ? 'That username is taken' : 'Could not save: ' + e.message);
    }
    setBusy(false);
  }

  if (profile === undefined) return <p className="p-6">Loading…{err && <span className="block text-red-300">{err}</span>}</p>;
  if (profile === null) return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border-2 border-yellow-400 bg-black/40 p-5">
        <h1 className="text-2xl font-bold text-yellow-400">Naija City</h1>
        <p className="text-sm opacity-80 mb-3">Pick a unique username. Nobody else can use it.</p>
        <input className="w-full rounded bg-black/50 p-2 border border-white/20" maxLength={14} value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && claim()} placeholder="e.g. Lius_Boss" />
        {err && <p className="text-red-300 text-sm mt-1">{err}</p>}
        <button disabled={busy} onClick={claim} className="mt-3 w-full rounded bg-yellow-400 text-black font-bold p-2 disabled:opacity-50">Continue</button>
      </div>
    </main>
  );
  return <GameFrame user={user} profile={profile} />;
}
