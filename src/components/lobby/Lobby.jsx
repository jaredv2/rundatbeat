import { useEffect, useState } from 'react';
import { Users, X } from 'lucide-react';
import { kickPlayer, toggleReady, startCountdown, leaveLobby } from '../../lib/roomService';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { playUiSound } from '../../lib/sfx';
import { getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji } from '../../lib/display';

export default function Lobby({ room, members, onReadyChange }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [countdown, setCountdown] = useState(null);
  const [isKicking, setIsKicking] = useState(null);

  const isHost = profile?.id && (room?.host_id === profile.id || room?.owner_id === profile.id);
  const myMember = members.find((m) => m.user_id === profile?.id);
  const allReady = members.length >= 2 && members.every((m) => m.is_ready);
  const readyCount = members.filter((m) => m.is_ready).length;

  useEffect(() => {
    if (!room?.countdown_started_at) {
      setCountdown(null);
      return;
    }
    const target = new Date(room.countdown_started_at).getTime() + 5000;

    function tick() {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setCountdown(remaining > 0 ? remaining : null);
      if (remaining <= 0) return;
      requestAnimationFrame(tick);
    }
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [room?.countdown_started_at]);

  async function handleReady() {
    playUiSound('click');
    try {
      await toggleReady(room.id, profile.id);
      onReadyChange?.();
    } catch (err) {
      addToast(err.message || 'READY FAILED', 'error');
    }
  }

  async function handleStart() {
    playUiSound('click');
    try {
      if (allReady) {
        await startCountdown(room.id);
        addToast('COUNTDOWN STARTED');
      } else {
        await startCountdown(room.id);
        addToast('COUNTDOWN STARTED');
      }
    } catch (err) {
      addToast(err.message || 'START FAILED', 'error');
    }
  }

  async function handleKick(targetUserId) {
    playUiSound('cancel');
    setIsKicking(targetUserId);
    try {
      await kickPlayer(room.id, profile.id, targetUserId);
      addToast('PLAYER KICKED');
    } catch (err) {
      addToast(err.message || 'KICK FAILED', 'error');
    } finally {
      setIsKicking(null);
    }
  }

  async function handleLeave() {
    playUiSound('cancel');
    window.__clearReturnTo?.();
    try {
      await leaveLobby(room.id, profile.id);
      addToast('LEFT LOBBY');
    } catch (err) {
      addToast(err.message || 'LEAVE FAILED', 'error');
    }
  }

  return (
    <div className="rdb-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono text-[13px] uppercase text-rdb-text">
          {isHost ? 'HOST LOBBY' : 'LOBBY'}
        </h3>
      </div>

      {countdown !== null && (
        <div className="mt-4 flex flex-col items-center gap-2 py-4">
          <div className="font-mono text-[11px] uppercase text-rdb-orange blink">
            {countdown > 0 ? `GAME STARTING IN ${countdown}s` : 'STARTING...'}
          </div>
          <div className="h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-rdb-orange transition-all duration-1000"
              style={{ width: `${((5 - countdown) / 5) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {members.map((member) => {
          const isSelf = member.user_id === profile?.id;
          const canKick = isHost && !isSelf && member.role !== 'owner';
          return (
            <div
              key={member.user_id}
              className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    member.is_ready ? 'bg-green-400' : 'bg-rdb-orange/50'
                  }`}
                />
                <span
                  className={`truncate font-mono text-[11px] uppercase ${getNameCosmeticClassName(
                    member.profiles,
                  )}`}
                  style={getNameGradientStyle(member.profiles)}
                >
                  {member.profiles?.nameplate_icon && (
                    <span className="mr-1 text-rdb-orange">
                      {getNameplateEmoji(member.profiles.nameplate_icon)}
                    </span>
                  )}
                  {member.profiles?.username || 'USER'}
                  {isSelf && <span className="ml-1 text-rdb-muted">(YOU)</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-rdb-muted">
                  {member.is_ready ? 'READY' : 'NOT READY'}
                </span>
                {canKick && (
                  <button
                    className="text-rdb-red hover:text-rdb-red/80"
                    disabled={isKicking === member.user_id}
                    onClick={() => handleKick(member.user_id)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 font-mono text-[11px] uppercase text-rdb-muted">
        <span>
          <Users size={14} className="mr-1 inline" />
          {readyCount}/{members.length} READY
        </span>
        <span>{members.length}/{room.max_players} PLAYERS</span>
      </div>

      <div className="mt-4 flex gap-2">
        {!isHost && (
          <button
            className={`flex-1 ${
              myMember?.is_ready
                ? 'rdb-button border-rdb-orange text-rdb-orange'
                : 'rdb-button rdb-button-primary'
            }`}
            disabled={countdown !== null}
            onClick={handleReady}
            type="button"
          >
            {myMember?.is_ready ? 'UNREADY' : 'READY UP'}
          </button>
        )}
        {isHost && (
          <button
            className="rdb-button rdb-button-primary flex-1"
            disabled={countdown !== null || members.length < 2}
            onClick={handleStart}
            type="button"
          >
            {allReady ? 'START NOW' : 'START ANYWAY'}
          </button>
        )}
        <button
          className="rdb-button border-rdb-red text-rdb-red"
          disabled={countdown !== null}
          onClick={handleLeave}
          type="button"
        >
          LEAVE
        </button>
      </div>

      {!allReady && members.length >= 2 && (
        <p className="mt-2 font-mono text-[10px] uppercase text-rdb-muted text-center">
          All players must be ready to start automatically
        </p>
      )}
    </div>
  );
}
