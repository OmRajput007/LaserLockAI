/**
 * alarmAudio.ts
 * High-reliability Web Audio API synthesized alarm sound engine for LaserLockAI Platform.
 * Triggers aerospace telemetry alarm beeps when the optical beacon is lost from the satellite camera FOV.
 */

class AlarmAudioService {
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.32;
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
      this.beepOnce(587.33, 0.28); // Pleasant single chime confirmation when unmuted
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

  public beepOnce(freq: number = 587.33, durationSec: number = 0.28) {
    this.playChimeTone(freq, durationSec, 0.85);
  }

  /**
   * Synthesizes an elegant, resonant glass-cockpit chime note with subtle harmonic overtone and exponential decay.
   * Produces a clean, luxurious acoustic bell/chime rather than a harsh test-tone beep.
   */
  private playChimeTone(freq: number, durationSec: number = 0.38, gainMultiplier: number = 1.0) {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
        return;
      }

      const now = this.audioCtx.currentTime;

      // Master note gain envelope with smooth natural acoustic decay
      const noteGain = this.audioCtx.createGain();
      const peakVol = Math.max(0.001, this.volume * gainMultiplier);
      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.linearRampToValueAtTime(peakVol, now + 0.016);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      // Warm dynamic low-pass filter to give a velvety, rounded presence
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, now);
      filter.frequency.exponentialRampToValueAtTime(950, now + durationSec);

      // Primary crystal-clear sine fundamental
      const osc1 = this.audioCtx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);

      // Subtle harmonic overtone (perfect fifth) for rich avionics bell depth
      const osc2 = this.audioCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 1.5, now);
      const osc2Gain = this.audioCtx.createGain();
      osc2Gain.gain.value = 0.16;

      osc1.connect(noteGain);
      osc2.connect(osc2Gain);
      osc2Gain.connect(noteGain);

      noteGain.connect(filter);
      filter.connect(this.audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durationSec + 0.05);
      osc2.stop(now + durationSec + 0.05);
    } catch (e) {
      console.warn('Chime audio playback failed:', e);
    }
  }

  /**
   * Plays the signature LaserLockAI elegant dual-tone advisory chime:
   * First note: High clear chime (E5: 659.25 Hz)
   * Second note: Warm resolving chime (A4: 440.00 Hz)
   * Resembles a premium aircraft flight-deck advisory / glass-cockpit annunciator.
   */
  public playDualPulse() {
    if (this.isMuted) return;
    this.playChimeTone(659.25, 0.36, 0.9);
    setTimeout(() => {
      this.playChimeTone(440.00, 0.44, 1.0);
    }, 130);
  }

  public startLostAlarm() {
    if (this.isAlarmRunning) return;
    this.isAlarmRunning = true;
    this.unlock();
    this.notify();

    // Immediately sound the first advisory chime
    this.playDualPulse();

    // Dignified, non-fatiguing pulse rhythm: plays every 1.6 seconds while sight is lost
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      this.playDualPulse();
    }, 1600);
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
