
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Candidate, VoteValue } from './types';
import { MOCK_CANDIDATES, MAX_VOTES_PER_USER } from './constants';
import CandidateCard from './components/CandidateCard';
import { parseTwitterLinkWithGemini, generateSocialFingerprint } from './services/geminiService';
import { databaseService } from './services/supabaseService';
import html2canvas from 'html2canvas';

const STORAGE_KEYS = {
  VOTES_TODAY: 'bulk_votes_v8_today',
  LOGGED_USER: 'bulk_current_user_handle'
};

const getDeviceFingerprint = () => {
  const n = window.navigator;
  const s = window.screen;
  const str = `${n.userAgent}|${s.width}x${s.height}|${n.language}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `node-${Math.abs(hash)}`;
};

const secureSanitize = (text: string) => {
  if (typeof text !== 'string') return '';
  return text.replace(/[<>\"\'\/]/g, '').trim();
};

export const PolarStarIcon = ({ size = "24", className = "", score = 0 }: { size?: string, className?: string, score?: number }) => {
  const glowIntensity = 15 + Math.min(score * 1.5, 40);
  return (
    <svg 
      width={size} height={size} viewBox="0 0 100 100" fill="currentColor" className={`${className} neon-glow`}
      style={{ filter: `drop-shadow(0 0 ${glowIntensity}px rgba(0,242,255,0.9))` }}
    >
      <path d="M50 0 L54 42 L80 20 L58 46 L100 50 L58 54 L80 80 L54 58 L50 100 L46 58 L20 80 L42 54 L0 50 L42 46 L20 20 L46 42 Z" />
      <circle cx="50" cy="50" r="3" fill="white" />
    </svg>
  );
};

const App: React.FC = () => {
  const [view, setView] = useState<'LANDING' | 'DASHBOARD' | 'RICE_VOTING' | 'LILY_INDEX' | 'LOGIN'>('LANDING');
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [userHandleInput, setUserHandleInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [globalCandidates, setGlobalCandidates] = useState<Candidate[]>([]);
  const [votedIdsFromDb, setVotedIdsFromDb] = useState<string[]>([]);
  const [dailyVotes, setDailyVotes] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showPassport, setShowPassport] = useState(false);
  const [passportImageBase64, setPassportImageBase64] = useState<string | null>(null);
  const passportRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (handle?: string) => {
    try {
      const activeHandle = handle || localStorage.getItem(STORAGE_KEYS.LOGGED_USER);
      // جلب البيانات من جدول candidates وجدول votes في نفس الوقت
      const [candidates, voted] = await Promise.all([
        databaseService.fetchGlobalCandidates(),
        activeHandle ? databaseService.getVotedIds(activeHandle) : Promise.resolve([])
      ]);
      setGlobalCandidates(candidates.length > 0 ? candidates : MOCK_CANDIDATES);
      setVotedIdsFromDb(voted);
    } catch (e) {
      setGlobalCandidates(MOCK_CANDIDATES);
    }
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem(STORAGE_KEYS.LOGGED_USER);
    if (savedUser) {
      const handle = secureSanitize(savedUser);
      setCurrentUser(handle);
      loadData(handle);
      setView('DASHBOARD');
    } else {
      loadData();
    }
    const votesStr = localStorage.getItem(STORAGE_KEYS.VOTES_TODAY);
    setDailyVotes(votesStr ? Math.min(parseInt(votesStr, 10) || 0, MAX_VOTES_PER_USER) : 0);
  }, [loadData]);

  const myNode = useMemo(() => 
    globalCandidates.find(c => c.handle.toLowerCase() === currentUser?.toLowerCase()), 
    [globalCandidates, currentUser]
  );

  // منطق الطابور العشوائي والذكي: يستثني الأشخاص الذين صوّت لهم المستخدم مسبقاً بناءً على جدول votes
  const votingQueue = useMemo(() => {
    const available = globalCandidates.filter(c => 
      c.handle.toLowerCase() !== currentUser?.toLowerCase() && 
      !votedIdsFromDb.includes(c.id)
    );
    // خلط عشوائي (Shuffle) لضمان عدم التكرار والترتيب المتغير
    return [...available].sort(() => Math.random() - 0.5);
  }, [globalCandidates, currentUser, votedIdsFromDb]);

  // حل مشكلة الصورة: تحويل الصورة لـ Base64 عبر بروكسي CORS لضمان ظهورها عند التحميل
  const preparePassportImage = async (handle: string): Promise<string> => {
    const twitterHandle = handle.replace('@', '');
    const originalUrl = `https://unavatar.io/twitter/${twitterHandle}`;
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}&default=${encodeURIComponent(originalUrl)}&l=9&n=-1`;
    
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve(originalUrl);
        }
      };
      img.onerror = () => resolve(originalUrl);
      img.src = proxyUrl;
    });
  };

  const login = async () => {
    const handle = secureSanitize(userHandleInput).toLowerCase();
    if (!handle) return;
    const finalHandle = handle.startsWith('@') ? handle : '@' + handle;
    
    setIsLoggingIn(true);
    const fingerprint = getDeviceFingerprint();

    try {
      const linkedHandle = await databaseService.findByFingerprint(fingerprint);
      if (linkedHandle && linkedHandle.toLowerCase() !== finalHandle.toLowerCase()) {
        alert(`Access Denied: Device already linked to ${linkedHandle}.`);
        setIsLoggingIn(false);
        return;
      }

      const profile = await parseTwitterLinkWithGemini(`https://x.com/${finalHandle.replace('@','')}`);
      const node: Candidate = {
        id: `node-${Date.now()}`,
        name: profile?.name || finalHandle.replace('@',''),
        handle: finalHandle,
        profileImageUrl: `https://unavatar.io/twitter/${finalHandle.replace('@','')}`,
        profileUrl: `https://x.com/${finalHandle.replace('@','')}`,
        platform: 'Twitter',
        firstSeen: new Date().toISOString(),
        sharedCount: 0,
        trustScore: 0,
        totalInteractions: 0
      };
      
      await databaseService.upsertCandidate(node, fingerprint);
      localStorage.setItem(STORAGE_KEYS.LOGGED_USER, finalHandle);
      setCurrentUser(finalHandle);
      await loadData(finalHandle);
      setView('DASHBOARD');
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleVote = async (value: VoteValue) => {
    const target = votingQueue[currentIndex];
    if (!target || !currentUser || dailyVotes >= MAX_VOTES_PER_USER) return;
    
    // تسجيل النقاط في جدول candidates
    if (value === VoteValue.KNOW) {
      await databaseService.incrementTrust(target.id);
    }
    
    // تسجيل التصويت في جدول votes لمنع التكرار
    await databaseService.recordVote(currentUser, target.id);
    setVotedIdsFromDb(prev => [...prev, target.id]);

    const nextVotes = dailyVotes + 1;
    setDailyVotes(nextVotes);
    localStorage.setItem(STORAGE_KEYS.VOTES_TODAY, nextVotes.toString());

    // العودة للوحة التحكم عند انتهاء التصويت اليومي أو نفاذ القائمة
    if (nextVotes >= MAX_VOTES_PER_USER || votingQueue.length <= 1) {
      await loadData(currentUser);
      setView('DASHBOARD');
    }
  };

  const runAnalysis = async () => {
    if (!currentUser) return;
    setIsAnalyzing(true);
    try {
      // تجهيز الصورة كـ Base64 لضمان عمل التحميل
      const imgBase64 = await preparePassportImage(currentUser);
      setPassportImageBase64(imgBase64);
      
      const result = await generateSocialFingerprint(currentUser, dailyVotes);
      setAnalysis(result);
      setShowPassport(true);
    } catch (e) {
      console.error("Passport prep error", e);
      setShowPassport(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const shareOnX = () => {
    const text = encodeURIComponent(`Authenticated my Node on @BulkProtocol. Trust Score: ${myNode?.trustScore || 0}. The Social Graph is evolving. 🌐 #BulkProtocol #Web3Social`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white page-fade-in">
      {view !== 'LANDING' && view !== 'LOGIN' && (
        <nav className="fixed top-0 w-full z-[100] px-6 py-8 flex justify-between items-center bg-black/50 backdrop-blur-xl border-b border-white/5">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setView('DASHBOARD')}>
            <PolarStarIcon size="28" className="text-[#00f2ff] group-hover:rotate-45 transition-transform duration-500" />
            <span className="font-black italic text-xl uppercase tracking-tighter">Bulk.</span>
          </div>
          <div className="flex gap-8">
            <button onClick={() => setView('LILY_INDEX')} className={`text-[10px] font-black uppercase tracking-widest transition-colors ${view === 'LILY_INDEX' ? 'text-[#00f2ff]' : 'text-white/40 hover:text-white'}`}>Classification</button>
            <button onClick={() => setView('RICE_VOTING')} className={`text-[10px] font-black uppercase tracking-widest transition-colors ${view === 'RICE_VOTING' ? 'text-[#00f2ff]' : 'text-white/40 hover:text-white'}`}>Recognition</button>
          </div>
        </nav>
      )}

      <main className="max-w-7xl mx-auto px-6 pt-32 pb-20">
        {view === 'LANDING' && (
          <div className="h-[70vh] flex flex-col items-center justify-center text-center space-y-12">
            <div className="animate-pulse-star"><PolarStarIcon size="120" className="text-[#00f2ff]" /></div>
            <h1 className="text-7xl md:text-9xl font-black italic tracking-tighter leading-none">SOCIAL<br/><span className="text-[#00f2ff]">GRAPH.</span></h1>
            <button onClick={() => setView('LOGIN')} className="px-12 py-6 bg-white text-black font-black uppercase tracking-[0.4em] text-[10px] hover:bg-[#00f2ff] transition-all hover:scale-105 active:scale-95 shadow-2xl">Establish Node</button>
          </div>
        )}

        {view === 'LOGIN' && (
          <div className="max-w-md mx-auto mt-20 p-10 bg-[#0a0a0a] border border-white/10 rounded-[3.5rem] shadow-2xl space-y-8">
             <div className="text-center space-y-2">
                <h3 className="text-3xl font-black italic uppercase tracking-tighter">Identity Binding</h3>
                <p className="text-[9px] text-white/30 uppercase tracking-[0.4em]">One device, one node protocol</p>
             </div>
             <div className="space-y-4">
                <input 
                  type="text" placeholder="@handle" value={userHandleInput}
                  onChange={(e) => setUserHandleInput(secureSanitize(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-xl font-bold focus:border-[#00f2ff] outline-none"
                />
                <button onClick={login} disabled={isLoggingIn} className="w-full py-6 bg-[#00f2ff] text-black font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-white transition-all active:scale-95 shadow-xl">
                  {isLoggingIn ? 'Verifying...' : 'Link Identity'}
                </button>
             </div>
          </div>
        )}

        {view === 'DASHBOARD' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-[#0a0a0a] border border-white/10 rounded-[4rem] p-12 min-h-[500px] flex flex-col justify-between relative overflow-hidden group shadow-2xl">
               <div className="absolute -right-20 -top-20 opacity-[0.03] rotate-12 group-hover:scale-110 transition-transform duration-1000"><PolarStarIcon size="500" /></div>
               <div className="relative z-10 space-y-10">
                  <div className="flex items-center gap-6">
                    <img src={`https://unavatar.io/twitter/${currentUser?.replace('@','')}`} className="w-24 h-24 rounded-3xl border-2 border-[#00f2ff]/20 shadow-2xl" alt="" />
                    <div className="space-y-1">
                        <h2 className="text-5xl font-black italic uppercase tracking-tighter leading-none truncate max-w-sm">{myNode?.name || currentUser}</h2>
                        <span className="text-[#00f2ff] font-black uppercase tracking-[0.4em] text-[9px] opacity-60">Verified Network Participant</span>
                    </div>
                  </div>
                  <div className="p-8 bg-white/5 border border-white/5 rounded-3xl backdrop-blur-xl">
                     <p className="text-sm font-medium italic text-white/80 leading-relaxed">{analysis || "Protocol synced. Generate your Social Passport to visualize your node fingerprint."}</p>
                  </div>
               </div>
               <div className="flex gap-4 relative z-10">
                  <button onClick={() => setView('RICE_VOTING')} className="px-10 py-5 bg-[#00f2ff] text-black font-black uppercase tracking-[0.3em] text-[10px] rounded-xl hover:bg-white transition-all shadow-lg active:scale-95">Start Recognition</button>
                  <button onClick={runAnalysis} disabled={isAnalyzing} className="px-10 py-5 bg-white/5 text-white font-black uppercase tracking-[0.3em] text-[10px] rounded-xl border border-white/10 hover:bg-white/10 transition-all active:scale-95">
                    {isAnalyzing ? 'Mapping...' : 'Identity Passport'}
                  </button>
               </div>
            </div>
            <div className="bg-[#00f2ff] text-black rounded-[3rem] p-10 flex flex-col justify-between min-h-[250px] shadow-2xl transition-transform hover:scale-[1.02]">
               <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Identity Weight</span>
               <h4 className="text-8xl font-black italic tracking-tighter leading-none">{myNode?.trustScore || 0}</h4>
            </div>
          </div>
        )}

        {view === 'RICE_VOTING' && (
          <div className="max-w-2xl mx-auto py-10">
             {votingQueue[currentIndex] ? (
               <CandidateCard 
                 candidate={votingQueue[currentIndex]} 
                 onVote={handleVote} 
                 disabled={dailyVotes >= MAX_VOTES_PER_USER} 
               />
             ) : (
               <div className="text-center py-24 bg-[#0a0a0a] rounded-[5rem] border border-white/10 shadow-2xl">
                  <h3 className="text-4xl font-black italic mb-4 uppercase tracking-tighter">Database Mapped</h3>
                  <p className="text-white/30 text-[9px] uppercase tracking-[0.5em] mb-10">No unvoted nodes in database range</p>
                  <button onClick={() => setView('DASHBOARD')} className="px-10 py-5 bg-white text-black font-black uppercase text-[10px] rounded-xl hover:bg-[#00f2ff] transition-all">Back to Control</button>
               </div>
             )}
          </div>
        )}
      </main>

      {showPassport && (
        <div className="fixed inset-0 z-[200] bg-black/98 backdrop-blur-[50px] flex items-center justify-center p-6 page-fade-in overflow-y-auto">
           <div className="max-w-xl w-full space-y-6 my-auto">
              {/* تصميم الباسبور الجديد (Cyber Luxury ID) */}
              <div 
                ref={passportRef} 
                className="relative aspect-[1.58/1] bg-[#0d0d0d] border border-white/10 rounded-[2.8rem] p-10 flex flex-col justify-between overflow-hidden passport-texture shadow-[0_0_100px_rgba(0,242,255,0.1)] group"
              >
                 <div className="absolute top-0 right-0 w-64 h-64 bg-[#00f2ff]/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2"></div>
                 <div className="absolute -left-10 bottom-0 w-1 h-3/4 bg-gradient-to-b from-[#00f2ff] to-transparent opacity-30"></div>

                 <div className="flex justify-between items-start relative z-10">
                    <div className="flex items-center gap-4">
                       <PolarStarIcon size="36" className="text-[#00f2ff]" score={myNode?.trustScore} />
                       <div>
                          <span className="font-black italic uppercase tracking-tighter text-2xl block leading-none">Social Passport</span>
                          <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.5em]">Issue v8.5 / Verified Node</span>
                       </div>
                    </div>
                    <div className="text-right">
                       <div className="text-[9px] font-black text-[#00f2ff] uppercase tracking-[0.3em] mb-1">Authenticated Node</div>
                       <div className="h-0.5 w-16 bg-[#00f2ff] ml-auto opacity-40"></div>
                    </div>
                 </div>

                 <div className="flex items-center gap-10 relative z-10">
                    <div className="relative">
                        <img 
                            src={passportImageBase64 || ''} 
                            className="w-40 h-40 rounded-[3rem] border-2 border-white/10 object-cover shadow-2xl relative z-20 bg-black" 
                            alt="" 
                        />
                    </div>
                    <div className="flex-1 space-y-4">
                       <div>
                          <h4 className="text-4xl font-black italic uppercase tracking-tighter leading-none truncate max-w-[280px]">{myNode?.name || currentUser}</h4>
                          <p className="text-[#00f2ff] font-black uppercase text-[11px] tracking-[0.4em] mt-2">{currentUser}</p>
                       </div>
                       <div className="p-4 bg-white/[0.03] rounded-2xl border border-white/5 backdrop-blur-md">
                          <p className="text-[10px] italic text-white/50 leading-relaxed font-medium">"{analysis || 'Analyzing social metadata...'}"</p>
                       </div>
                    </div>
                 </div>

                 <div className="flex justify-between items-end border-t border-white/5 pt-6 relative z-10">
                    <div className="flex gap-14">
                       <div>
                          <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 block">Trust Index</span>
                          <div className="text-3xl font-black italic tracking-tighter leading-none">{myNode?.trustScore || 0}</div>
                       </div>
                       <div>
                          <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 block">Status</span>
                          <div className="text-3xl font-black italic tracking-tighter text-[#00f2ff] leading-none uppercase">ALPHA</div>
                       </div>
                    </div>
                    <div className="text-right">
                       <div className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1">Bulk Protocol</div>
                       <div className="font-black italic uppercase text-xs">IDENTITY VERIFIED</div>
                    </div>
                 </div>
              </div>

              {/* أزرار التحكم الفورية */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                 <button onClick={() => {
                   if (!passportRef.current) return;
                   html2canvas(passportRef.current, { 
                     backgroundColor: '#050505',
                     useCORS: true,
                     scale: 4, // دقة عالية للتحميل
                     logging: false
                   }).then(canvas => {
                     const link = document.createElement('a');
                     link.download = `bulk-passport-${currentUser?.replace('@','')}.png`;
                     link.href = canvas.toDataURL('image/png');
                     link.click();
                   });
                 }} className="py-5 bg-white text-black font-black uppercase text-[10px] rounded-2xl hover:bg-[#00f2ff] transition-all flex items-center justify-center gap-2 active:scale-95 shadow-xl group">
                    <i className="fa-solid fa-download group-hover:bounce"></i> Save ID
                 </button>
                 
                 <button onClick={shareOnX} className="py-5 bg-[#1DA1F2] text-white font-black uppercase text-[10px] rounded-2xl hover:scale-105 transition-all flex items-center justify-center gap-2 active:scale-95 shadow-xl">
                    <i className="fa-brands fa-x-twitter"></i> Share to X
                 </button>

                 <button onClick={() => { setShowPassport(false); setView('DASHBOARD'); }} className="py-5 bg-white/5 text-white font-black uppercase text-[10px] rounded-2xl border border-white/10 hover:bg-white/20 transition-all active:scale-95 shadow-xl">
                    Return Home
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
