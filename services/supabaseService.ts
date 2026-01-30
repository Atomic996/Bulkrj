
import { createClient } from '@supabase/supabase-js';
import { Candidate } from '../types';

const SUPABASE_URL = 'https://qjoixgkwpqnkmzqbsrct.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqb2l4Z2t3cHFua216cWJzcmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NDM0NzAsImV4cCI6MjA4NTMxOTQ3MH0.QcjUVEAlOlQuF1xQ49ln73RtD_w_vQkz4VMLOv-n3Go';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const cleanText = (str: string | null): string => {
  if (!str) return '';
  return str.trim().substring(0, 150);
};

export const databaseService = {
  // جلب كافة المرشحين من جدول candidates
  async fetchGlobalCandidates(): Promise<Candidate[]> {
    try {
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .order('trust_score', { ascending: false });
      
      if (error) throw error;

      return (data || []).map((item: any) => ({
        id: String(item.id),
        name: cleanText(item.name || 'Member'),
        handle: cleanText(item.handle || '@member'),
        profileImageUrl: `https://unavatar.io/twitter/${(item.handle || '').replace('@','')}`,
        profileUrl: `https://x.com/${(item.handle || '').replace('@','')}`,
        platform: 'Twitter',
        firstSeen: item.created_at || new Date().toISOString(),
        sharedCount: 0,
        trustScore: Math.max(0, parseInt(item.trust_score || 0, 10)),
        totalInteractions: 0
      }));
    } catch (e) {
      return [];
    }
  },

  // جلب معرفات الأشخاص الذين صوت لهم المستخدم الحالي من جدول votes
  async getVotedIds(voterHandle: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('votes')
        .select('candidate_id')
        .eq('voter_handle', voterHandle);
      
      if (error) return [];
      return data.map(v => String(v.candidate_id));
    } catch {
      return [];
    }
  },

  // تسجيل عملية تصويت جديدة في جدول votes
  async recordVote(voterHandle: string, candidateId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('votes')
        .insert({ 
            voter_handle: voterHandle, 
            candidate_id: candidateId 
        });
      return !error;
    } catch {
      return false;
    }
  },

  async findByFingerprint(fingerprint: string): Promise<string | null> {
    const { data } = await supabase
      .from('candidates')
      .select('handle')
      .eq('fingerprint', fingerprint)
      .maybeSingle();
    return data ? data.handle : null;
  },

  async upsertCandidate(candidate: Candidate, fingerprint: string): Promise<boolean> {
    try {
      const handle = cleanText(candidate.handle);
      const { error } = await supabase
        .from('candidates')
        .upsert({
          id: candidate.id,
          name: cleanText(candidate.name),
          handle: handle,
          fingerprint: fingerprint,
          trust_score: candidate.trustScore || 0
        }, { onConflict: 'handle' });
      
      return !error;
    } catch (e) {
      return false;
    }
  },

  // تحديث نقاط الثقة في جدول candidates
  async incrementTrust(candidateId: string): Promise<boolean> {
    try {
      const { data } = await supabase.from('candidates').select('trust_score').eq('id', candidateId).single();
      if (!data) return false;
      const { error } = await supabase.from('candidates').update({ trust_score: (data.trust_score || 0) + 1 }).eq('id', candidateId);
      return !error;
    } catch (e) {
      return false;
    }
  }
};
