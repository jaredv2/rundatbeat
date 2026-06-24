import { useMemo, useState, useRef, useCallback } from 'react';
import { Upload, Music, X, FileAudio } from 'lucide-react';
import { playUiSound } from '../../lib/sfx';
import { uploadBeat } from '../../lib/storage';
import { AUDIO_LIMITS, validateAudioFile } from '../../lib/validators';
import { supabase } from '../../lib/supabase';
import { addTokenTransaction } from '../../lib/tokenHelpers';
import { useUiStore } from '../../store/uiStore';
import { cropAudio, getAudioDuration } from '../../lib/audio';
import UploadProgress from '../audio/UploadProgress';

export default function SubmitBeat({ battle, profile, existingSubmission, onSubmitted }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const addToast = useUiStore((s) => s.addToast);

  const maxSec = useMemo(
    () => battle.song_length_seconds >= 10000 ? Infinity : (battle.song_length_seconds || AUDIO_LIMITS.maxDurationSeconds),
    [battle.song_length_seconds]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      const validation = validateAudioFile(droppedFile);
      if (validation) {
        setError(validation);
        return;
      }
      setError('');
      setFile(droppedFile);
      playUiSound('click');
    }
  }, []);

  const handleFileSelect = useCallback((e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      const validation = validateAudioFile(selected);
      if (validation) {
        setError(validation);
        return;
      }
      setError('');
      setFile(selected);
      playUiSound('click');
    }
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }, []);

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
      <div className="rdb-panel p-5 space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Music className="text-rdb-orange" size={18} />
          <p className="font-mono text-sm font-bold text-rdb-orange uppercase">BEAT SUBMITTED</p>
        </div>
        <p className="text-center font-mono text-[10px] uppercase text-rdb-muted">Your submission is locked in.</p>
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

  if (submitted) {
    return (
      <div className="rdb-panel p-5">
        <div className="flex items-center justify-center gap-2">
          <Music className="text-rdb-orange" size={18} />
          <p className="font-mono text-sm font-bold text-rdb-orange uppercase">BEAT SUBMITTED</p>
        </div>
        <p className="text-center font-mono text-[10px] uppercase text-rdb-muted mt-1">Good luck!</p>
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
    setError('');
    setProgress(20);
    try {
      let uploadFile = file;
      const duration = await getAudioDuration(file);
      if (maxSec !== Infinity && duration > maxSec) {
        addToast('AUDIO TOO LONG — CROPPING TO ' + maxSec + 's');
        uploadFile = await cropAudio(file, maxSec);
        setProgress(40);
      }
      const audioUrl = await uploadBeat({ battleId: battle.id, userId: profile.id, file: uploadFile });
      setProgress(70);
      const { error: insertError } = await supabase.from('submissions').insert({
        battle_id: battle.id,
        user_id: profile.id,
        audio_url: audioUrl,
      });
      if (insertError) throw insertError;
      if (battle.mode !== 'solo') {
        await addTokenTransaction({ userId: profile.id, amount: 10, reason: 'submission', battleId: battle.id });
        addToast('+10 RDB SUBMISSION REWARD');
      } else {
        addToast('BEAT SUBMITTED');
      }
      setProgress(100);
      setSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      addToast(err.message || 'SUBMISSION FAILED', 'error');
      setProgress(0);
    }
  }

  return (
    <form className="rdb-panel p-5 space-y-4" onSubmit={submit}>
      <div className="flex items-center gap-2">
        <Upload className="text-rdb-orange" size={18} />
        <h2 className="font-mono text-lg font-bold uppercase text-rdb-orange">SUBMIT BEAT</h2>
      </div>

      {error && (
        <div className="border border-rdb-red bg-rdb-red/10 p-3 font-mono text-sm text-rdb-red rounded-lg">
          {error}
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-all duration-200
          ${dragging
            ? 'border-rdb-orange bg-rdb-orange/10 scale-[1.02]'
            : file
              ? 'border-rdb-orange/50 bg-rdb-orange/5'
              : 'border-rdb-border hover:border-rdb-orange/50 hover:bg-rdb-surface/50'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.wav,audio/mpeg,audio/wav"
          onChange={handleFileSelect}
          className="hidden"
        />

        {file ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <FileAudio className="text-rdb-orange" size={24} />
              <span className="font-mono text-sm font-bold text-rdb-text uppercase">{file.name}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeFile(); }}
                className="ml-2 rounded p-1 hover:bg-rdb-red/20 text-rdb-muted hover:text-rdb-red transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <p className="font-mono text-[10px] uppercase text-rdb-muted">
              {(file.size / 1024 / 1024).toFixed(2)}MB / max {(AUDIO_LIMITS.maxSizeBytes / 1024 / 1024).toFixed(0)}MB
              {maxSec !== Infinity && ` — ${Math.floor(maxSec / 60)}:${String(maxSec % 60).padStart(2, '0')} max`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className={`mx-auto ${dragging ? 'text-rdb-orange' : 'text-rdb-muted'} transition-colors`} size={32} />
            <p className="font-mono text-sm uppercase text-rdb-text">
              {dragging ? 'DROP IT HERE' : 'DRAG & DROP YOUR BEAT'}
            </p>
            <p className="font-mono text-[10px] uppercase text-rdb-muted">
              or click to browse — MP3, WAV
            </p>
          </div>
        )}
      </div>

      {progress > 0 && <UploadProgress value={progress} />}

      <button
        className="rdb-button rdb-button-primary w-full"
        type="submit"
        disabled={!file || progress > 0}
      >
        {progress > 0 ? 'UPLOADING...' : 'SUBMIT BEAT'}
      </button>
    </form>
  );
}
