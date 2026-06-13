import { useMemo, useState } from 'react';
import { playUiSound } from '../../lib/sfx';
import { uploadBeat } from '../../lib/storage';
import { AUDIO_LIMITS, validateAudioDuration, validateAudioFile } from '../../lib/validators';
import { supabase } from '../../lib/supabase';
import { addTokenTransaction } from '../../lib/tokenHelpers';
import { useUiStore } from '../../store/uiStore';
import UploadProgress from '../audio/UploadProgress';

export default function SubmitBeat({ battle, profile, existingSubmission, onSubmitted }) {
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const addToast = useUiStore((s) => s.addToast);

  const maxSec = useMemo(
    () => battle.song_length_seconds >= 10000 ? Infinity : (battle.song_length_seconds || AUDIO_LIMITS.maxDurationSeconds),
    [battle.song_length_seconds]
  );

  async function deleteSubmission() {
    if (!existingSubmission) return;
    setDeleting(true);
    try {
      await supabase.from('submissions').delete().eq('id', existingSubmission.id);
      addToast('SUBMISSION DELETED');
      onSubmitted?.();
    } catch (err) {
      addToast(err.message || 'DELETE FAILED', 'error');
    } finally {
      setDeleting(false);
    }
  }

  if (existingSubmission && !file) {
    return (
      <div className="rdb-panel mx-auto max-w-[700px] p-5 space-y-3">
        <p className="font-mono text-rdb-orange text-center">BEAT SUBMITTED</p>
        <button
          className="rdb-button border-rdb-red text-rdb-red w-full"
          type="button"
          disabled={deleting}
          onClick={deleteSubmission}
        >
          {deleting ? 'DELETING...' : 'DELETE & RE-UPLOAD'}
        </button>
      </div>
    );
  }

  async function submit(event) {
    event.preventDefault();
    playUiSound('click');
    const validation = validateAudioFile(file);
    if (validation) {
      setError(validation);
      return;
    }
    const durationError = await validateAudioDuration(file, maxSec);
    if (durationError) {
      setError(durationError);
      return;
    }
    setError('');
    setProgress(20);
    try {
      const audioUrl = await uploadBeat({ battleId: battle.id, userId: profile.id, file });
      setProgress(70);
      const { error: insertError } = await supabase.from('submissions').insert({
        battle_id: battle.id,
        user_id: profile.id,
        audio_url: audioUrl,
        description,
      });
      if (insertError) throw insertError;
      if (battle.mode !== 'solo') {
        await addTokenTransaction({ userId: profile.id, amount: 10, reason: 'submission', battleId: battle.id });
        addToast('+10 RDB SUBMISSION REWARD');
      } else {
        addToast('BEAT SUBMITTED');
      }
      setProgress(100);
      onSubmitted?.();
    } catch (err) {
      addToast(err.message || 'SUBMISSION FAILED', 'error');
      setProgress(0);
    }
  }

  return (
    <form className="rdb-panel mx-auto max-w-[700px] space-y-4 p-5" onSubmit={submit}>
      <h2 className="font-mono text-xl uppercase text-rdb-orange">SUBMIT BEAT</h2>
      {error && <div className="border border-rdb-red p-3 font-mono text-rdb-red">{error}</div>}
      <input className="rdb-input" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      {file && <div className="font-mono text-sm text-rdb-muted">{file.name} - {(file.size / 1024 / 1024).toFixed(2)}MB / max {(AUDIO_LIMITS.maxSizeBytes / 1024 / 1024).toFixed(0)}MB, {maxSec === Infinity ? '∞' : `${Math.floor(maxSec / 60)}:${String(maxSec % 60).padStart(2, '0')}`} max</div>}
      <textarea className="rdb-input min-h-28" placeholder="DESCRIPTION" value={description} onChange={(e) => setDescription(e.target.value)} />
      {progress > 0 && <UploadProgress value={progress} />}
      <button className="rdb-button rdb-button-primary" type="submit">SUBMIT BEAT</button>
    </form>
  );
}
