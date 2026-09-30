/**
 * alarmAudio.ts
 * High-reliability Web Audio API synthesized alarm sound engine for LaserLockAI Platform.
 * Triggers aerospace telemetry alarm beeps when the optical beacon is lost from the satellite camera FOV.
 */

class AlarmAudioService {
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.55;
  private intervalId: any = null;
  private isAlarmRunning: boolean = false;
  private listeners: Set<(isActive: boolean, isMuted: boolean, isSuspended: boolean) => void> = new Set();

  constructor() {
    try {
      const savedMute = localStorage.getItem('laserlockAI_alarm_muted');
      if (savedMute !== null) {
        this.isMuted = savedMute === 'true';
      }
    } catch {
      this.isMuted = false;
    }

    // Auto-unlock AudioContext on the first user interaction anywhere on the document
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.unlock();
      };
      ['click', 'pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
        window.addEventListener(evt, unlock, { passive: true });
      });
    }
  }

  private initContext() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
  }

  public unlock() {
    this.initContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().then(() => {
        this.notify();
        if (this.isAlarmRunning && !this.isMuted) {
          this.playDualPulse();
        }
      }).catch(() => {});
    } else {
      this.notify();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    try {
      localStorage.setItem('laserlockAI_alarm_muted', String(muted));
    } catch {}
    if (!muted) {
      this.unlock();
      this.beepOnce(1040, 0.08); // Immediate audible confirmation beep when unmuted
    }
    this.notify();
  }

  public toggleMute(): boolean {
    const next = !this.isMuted;
    this.setMuted(next);
    return next;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getIsAlarmRunning(): boolean {
    return this.isAlarmRunning;
  }

  public getIsSuspended(): boolean {
    return Boolean(this.audioCtx && this.audioCtx.state === 'suspended');
  }

  public subscribe(listener: (isActive: boolean, isMuted: boolean, isSuspended: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isAlarmRunning, this.isMuted, this.getIsSuspended());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const isSusp = this.getIsSuspended();
    this.listeners.forEach((cb) => cb(this.isAlarmRunning, this.isMuted, isSusp));
  }

  public beepOnce(freq: number = 1040, durationSec: number = 0.09) {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
        return;
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      // Sine wave with slight pitch drop creates the classic aerospace lock-lost chirp
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 0.92, now + durationSec);

      // Clean linear ramp envelope prevents click/pop artifacts and domain errors
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(this.volume, now + 0.012);
      gain.gain.linearRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch (e) {
      console.warn('Alarm audio playback failed:', e);
    }
  }

  public playDualPulse() {
    if (this.isMuted) return;
    // Aerospace annunciator: First primary 1040 Hz ping, then high 1480 Hz alarm ping
    this.beepOnce(1040, 0.08);
    setTimeout(() => {
      this.beepOnce(1480, 0.10);
    }, 110);
  }

  public startLostAlarm() {
    if (this.isAlarmRunning) return;
    this.isAlarmRunning = true;
    this.unlock();
    this.notify();

    // Immediately sound first alert chirp
    this.playDualPulse();

    // Rhythmic alert pulse every 850ms while beacon is lost from FOV
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      this.playDualPulse();
    }, 850);
  }

  public stopLostAlarm() {
    if (!this.isAlarmRunning && !this.intervalId) return;
    this.isAlarmRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.notify();
  }
}

export const alarmAudio = new AlarmAudioService();
