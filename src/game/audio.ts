import { RadioStationId } from './types';

const BGM_TRACK_URL =
  '/assets/aistudio/DAISHI_DANCE__Cecile_Corbel_-_Take_Me_Hand__Lyrics__bab4a031.mp3';

const RADIO_STATION_ORDER: RadioStationId[] = ['oceanfm', 'leonida', 'lounge', 'off'];
const RADIO_STATION_NAMES: Record<RadioStationId, string> = {
  oceanfm: 'OceanFM · Take Me Hand',
  leonida: 'Leonida Vice Nights',
  lounge: 'Atlantic Jazz Lounge',
  off: 'Radio Off',
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private oceanNoiseGain: GainNode | null = null;
  private oceanFilter: BiquadFilterNode | null = null;
  private speedboatOsc: OscillatorNode | null = null;
  private speedboatGain: GainNode | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmUserMuted = false;
  private bgmDucked = false;
  private radioStation: RadioStationId = 'oceanfm';
  private radioIntervalId: number | null = null;
  private radioStep = 0;
  private readonly bgmNormalVolume = 0.42;
  private readonly bgmDuckVolume = 0.18;
  private muted = false;
  private initialized = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public isMusicMuted(): boolean {
    return this.bgmUserMuted || this.muted || this.radioStation === 'off';
  }

  public getRadioStation(): RadioStationId {
    return this.radioStation;
  }

  public getRadioStationName(): string {
    return RADIO_STATION_NAMES[this.radioStation];
  }

  public setRadioStation(station: RadioStationId): void {
    this.radioStation = station;
    if (station !== 'off' && this.bgmUserMuted) {
      this.bgmUserMuted = false;
    }
    this.syncRadioPlayback();
  }

  public cycleRadioStation(): RadioStationId {
    const idx = RADIO_STATION_ORDER.indexOf(this.radioStation);
    const next = RADIO_STATION_ORDER[(idx + 1) % RADIO_STATION_ORDER.length];
    this.setRadioStation(next);
    return next;
  }

  private ensureBgmElement(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    if (!this.bgmAudio) {
      const audio = new Audio(BGM_TRACK_URL);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = this.bgmDucked ? this.bgmDuckVolume : this.bgmNormalVolume;
      audio.muted = this.muted || this.bgmUserMuted || this.radioStation !== 'oceanfm';
      this.bgmAudio = audio;
    }
    return this.bgmAudio;
  }

  private syncRadioPlayback(): void {
    const wantMp3 = !this.muted && !this.bgmUserMuted && this.radioStation === 'oceanfm';
    if (this.bgmAudio) {
      this.bgmAudio.muted = !wantMp3;
      this.bgmAudio.volume = this.bgmDucked ? this.bgmDuckVolume : this.bgmNormalVolume;
      if (wantMp3 && this.bgmAudio.paused) {
        void this.bgmAudio.play().catch(() => {});
      } else if (!wantMp3 && !this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
    } else if (wantMp3) {
      this.startBackgroundMusic();
    }

    const wantProc =
      !this.muted &&
      !this.bgmUserMuted &&
      (this.radioStation === 'leonida' || this.radioStation === 'lounge');
    if (wantProc && this.radioIntervalId === null) {
      this.radioIntervalId = window.setInterval(() => this.tickProceduralRadio(), 260);
    } else if (!wantProc && this.radioIntervalId !== null) {
      window.clearInterval(this.radioIntervalId);
      this.radioIntervalId = null;
    }
  }

  private tickProceduralRadio(): void {
    if (!this.ctx || !this.masterGain || this.muted || this.bgmUserMuted) return;
    if (this.radioStation !== 'leonida' && this.radioStation !== 'lounge') return;
    const now = this.ctx.currentTime;
    const step = this.radioStep++;
    const duckMult = this.bgmDucked ? 0.4 : 1.0;

    if (this.radioStation === 'leonida') {
      // 80s Vice Synthwave driving bass + shimmering lead arp
      const bassScale = [55, 55, 65.41, 65.41, 73.42, 73.42, 61.74, 65.41];
      const arpScale = [220, 261.63, 329.63, 392, 440, 392, 329.63, 293.66];
      const fBass = bassScale[step % bassScale.length];
      const fArp = arpScale[step % arpScale.length];

      const bass = this.ctx.createOscillator();
      const bFilt = this.ctx.createBiquadFilter();
      const bGain = this.ctx.createGain();
      bass.type = 'sawtooth';
      bass.frequency.setValueAtTime(fBass, now);
      bFilt.type = 'lowpass';
      bFilt.frequency.setValueAtTime(340, now);
      bGain.gain.setValueAtTime(0.085 * duckMult, now);
      bGain.gain.exponentialRampToValueAtTime(0.002, now + 0.22);
      bass.connect(bFilt);
      bFilt.connect(bGain);
      bGain.connect(this.masterGain);
      bass.start(now);
      bass.stop(now + 0.24);

      if (step % 2 === 0) {
        const arp = this.ctx.createOscillator();
        const aGain = this.ctx.createGain();
        arp.type = 'triangle';
        arp.frequency.setValueAtTime(fArp, now);
        aGain.gain.setValueAtTime(0.05 * duckMult, now);
        aGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        arp.connect(aGain);
        aGain.connect(this.masterGain);
        arp.start(now);
        arp.stop(now + 0.3);
      }
    } else {
      // Atlantic Jazz Lounge — warm Rhodes chord hits every 4 beats
      if (step % 4 === 0) {
        const chords = [
          [261.63, 329.63, 392.0, 493.88],
          [220.0, 261.63, 329.63, 392.0],
          [174.61, 220.0, 261.63, 329.63],
          [196.0, 246.94, 293.66, 349.23],
        ];
        const chord = chords[Math.floor(step / 4) % chords.length];
        for (const freq of chord) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.028 * duckMult, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.92);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.95);
        }
      }
    }
  }

  public startBackgroundMusic(): void {
    const audio = this.ensureBgmElement();
    if (!audio) return;
    audio.volume = this.bgmDucked ? this.bgmDuckVolume : this.bgmNormalVolume;
    const wantMp3 = !this.muted && !this.bgmUserMuted && this.radioStation === 'oceanfm';
    audio.muted = !wantMp3;
    if (audio.paused && wantMp3) {
      void audio.play().catch(() => {
        // Browser autoplay blocked until user gesture; retried in unlock()
      });
    }
  }

  public setMusicDucked(ducked: boolean): void {
    if (this.bgmDucked === ducked) return;
    this.bgmDucked = ducked;
    if (this.bgmAudio) {
      this.bgmAudio.volume = ducked ? this.bgmDuckVolume : this.bgmNormalVolume;
    }
  }

  public toggleMusicMuted(): boolean {
    this.bgmUserMuted = !this.bgmUserMuted;
    if (!this.bgmUserMuted && this.muted) {
      this.setMuted(false);
    }
    this.syncRadioPlayback();
    return this.isMusicMuted();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
    this.syncRadioPlayback();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public unlock(): void {
    this.startBackgroundMusic();
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.7;
    this.masterGain.connect(this.ctx.destination);

    // Continuous steam turbine & hull vibration hum
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.02;
    const engFilter = this.ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 140;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 42;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 63;

    this.engineOsc1.connect(engFilter);
    this.engineOsc2.connect(engFilter);
    engFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Continuous North Atlantic ocean wash (filtered noise buffer)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.03 * white) / 1.03;
      lastOut = data[i];
      data[i] *= 2.8;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    this.oceanFilter = this.ctx.createBiquadFilter();
    this.oceanFilter.type = 'bandpass';
    this.oceanFilter.frequency.value = 280;
    this.oceanFilter.Q.value = 0.7;

    this.oceanNoiseGain = this.ctx.createGain();
    this.oceanNoiseGain.gain.value = 0.08;

    noiseSource.connect(this.oceanFilter);
    this.oceanFilter.connect(this.oceanNoiseGain);
    this.oceanNoiseGain.connect(this.masterGain);
    noiseSource.start();

    // Speedboat dual V8 outboard roar (silent until boarded)
    this.speedboatGain = this.ctx.createGain();
    this.speedboatGain.gain.value = 0;
    const sbFilter = this.ctx.createBiquadFilter();
    sbFilter.type = 'lowpass';
    sbFilter.frequency.value = 380;
    this.speedboatOsc = this.ctx.createOscillator();
    this.speedboatOsc.type = 'sawtooth';
    this.speedboatOsc.frequency.value = 72;
    this.speedboatOsc.connect(sbFilter);
    sbFilter.connect(this.speedboatGain);
    this.speedboatGain.connect(this.masterGain);
    this.speedboatOsc.start();

    this.initialized = true;
    this.syncRadioPlayback();
  }

  public updateShipAmbience(speedKnots: number, active: boolean): void {
    if (!this.initialized || !this.ctx || !this.engineGain || !this.engineOsc1 || !this.engineOsc2 || !this.oceanNoiseGain || !this.oceanFilter) {
      return;
    }
    const t = this.ctx.currentTime;
    const absSpd = Math.abs(speedKnots);
    const norm = Math.min(1, absSpd / 24);
    const baseGain = active ? 0.02 + norm * 0.09 : 0.015;
    this.engineGain.gain.setTargetAtTime(baseGain, t, 0.15);
    this.engineOsc1.frequency.setTargetAtTime(34 + norm * 28, t, 0.2);
    this.engineOsc2.frequency.setTargetAtTime(51 + norm * 42, t, 0.2);

    this.oceanNoiseGain.gain.setTargetAtTime(active ? 0.05 + norm * 0.14 : 0.04, t, 0.2);
    this.oceanFilter.frequency.setTargetAtTime(210 + norm * 420, t, 0.2);
  }

  public playTelegraphBell(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Double brass Chadburn chime
    [0, 0.11].forEach((offset, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 1180 : 1480, now + offset);
      gain.gain.setValueAtTime(0.18, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.45);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.48);
    });
  }

  public playHelmTick(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.05);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playSteamWhistle(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Deep Titanic triple-chime steam whistle chord
    const freqs = [110, 138.59, 164.81];
    freqs.forEach((f) => {
      const osc = this.ctx!.createOscillator();
      const filter = this.ctx!.createBiquadFilter();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.96, now);
      osc.frequency.linearRampToValueAtTime(f, now + 0.12);

      filter.type = 'lowpass';
      filter.frequency.value = 520;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.09);
      gain.gain.setValueAtTime(0.1, now + 0.85);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.55);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 1.6);
    });
  }

  public playCarpathiaWhistle(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Warm Cunard two-tone steam whistle chord
    const freqs = [146.83, 185.0];
    freqs.forEach((f) => {
      const osc = this.ctx!.createOscillator();
      const filter = this.ctx!.createBiquadFilter();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.97, now);
      osc.frequency.linearRampToValueAtTime(f, now + 0.14);

      filter.type = 'lowpass';
      filter.frequency.value = 560;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.095, now + 0.12);
      gain.gain.setValueAtTime(0.09, now + 1.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 2.05);
    });
  }

  public playRescueFlare(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.75;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.25));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(2200, now + dur);
    bp.Q.value = 2.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  public playLookoutBell(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Urgent triple bell from the Crow's Nest
    [0, 0.15, 0.3].forEach((offset) => {
      const osc = this.ctx!.createOscillator();
      const overtone = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, now + offset);
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(2640, now + offset);

      gain.gain.setValueAtTime(0.12, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.35);

      osc.connect(gain);
      overtone.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      overtone.start(now + offset);
      osc.stop(now + offset + 0.38);
      overtone.stop(now + offset + 0.38);
    });
  }

  public playNearMissChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.1, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.38);
    });
  }

  public playCollisionImpact(severity: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const clamped = Math.min(1, Math.max(0.25, severity));

    // Low hull boom
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(88, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.65);
    gain.gain.setValueAtTime(0.35 * clamped, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.8);

    // Metallic hull screech / tearing steel + shattering ice noise
    const dur = 0.7;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.22));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(620, now);
    bp.frequency.exponentialRampToValueAtTime(190, now + dur);
    bp.Q.value = 1.6;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.45 * clamped, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playHullGroan(intensity = 1): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(52, now);
    osc.frequency.linearRampToValueAtTime(34, now + 1.8);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(79, now);
    osc2.frequency.linearRampToValueAtTime(48, now + 1.8);

    filter.type = 'lowpass';
    filter.frequency.value = 180;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24 * Math.min(1, intensity), now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.1);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 2.15);
    osc2.stop(now + 2.15);
  }

  public playBreakupSnap(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // 1. Massive low-frequency keel & girder snap boom
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(105, now);
    subOsc.frequency.exponentialRampToValueAtTime(22, now + 1.4);
    subGain.gain.setValueAtTime(0.42, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 1.55);

    // 2. Two-stage tearing steel screech & collapsing bulkheads
    [0, 0.24].forEach((offset, idx) => {
      const dur = idx === 0 ? 1.15 : 1.55;
      const buf = this.ctx!.createBuffer(
        1,
        Math.floor(this.ctx!.sampleRate * dur),
        this.ctx!.sampleRate,
      );
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx!.sampleRate * (idx === 0 ? 0.32 : 0.48)));
      }
      const noise = this.ctx!.createBufferSource();
      noise.buffer = buf;

      const bp = this.ctx!.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(idx === 0 ? 860 : 480, now + offset);
      bp.frequency.exponentialRampToValueAtTime(140, now + offset + dur);
      bp.Q.value = 1.9;

      const nGain = this.ctx!.createGain();
      nGain.gain.setValueAtTime(idx === 0 ? 0.45 : 0.38, now + offset);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);

      noise.connect(bp);
      bp.connect(nGain);
      nGain.connect(this.masterGain!);
      noise.start(now + offset);
    });
  }

  public playAutopilotChime(enabled: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = enabled ? [659.25, 880.0] : [659.25, 493.88];
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.09);
      gain.gain.setValueAtTime(0.11, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.34);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.36);
    });
  }

  public playCrowdScreamPanic(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // 1. Multi-voice vocal-formant screaming chorus (male & female pitches, pitch-drop & vibrato)
    const voices = [
      { delay: 0.04, dur: 1.55, f0: 760, f1: 610, formant: 1450, vol: 0.09 },
      { delay: 0.14, dur: 1.75, f0: 920, f1: 720, formant: 1750, vol: 0.085 },
      { delay: 0.22, dur: 1.45, f0: 540, f1: 420, formant: 1120, vol: 0.085 },
      { delay: 0.38, dur: 1.85, f0: 840, f1: 650, formant: 1620, vol: 0.08 },
      { delay: 0.56, dur: 1.65, f0: 660, f1: 500, formant: 1280, vol: 0.075 },
      { delay: 0.78, dur: 1.9, f0: 890, f1: 670, formant: 1680, vol: 0.075 },
    ];

    voices.forEach((v, idx) => {
      const t0 = now + v.delay;
      const osc = this.ctx!.createOscillator();
      const lfo = this.ctx!.createOscillator();
      const lfoGain = this.ctx!.createGain();
      const bp = this.ctx!.createBiquadFilter();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(v.f0 * 0.92, t0);
      osc.frequency.linearRampToValueAtTime(v.f0, t0 + 0.14);
      osc.frequency.exponentialRampToValueAtTime(v.f1, t0 + v.dur);

      // Vocal panic vibrato/tremolo
      lfo.type = 'sine';
      lfo.frequency.value = 6.5 + (idx % 3) * 1.4;
      lfoGain.gain.value = 22;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(v.formant, t0);
      bp.Q.value = 3.2;

      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(v.vol, t0 + 0.12);
      gain.gain.setValueAtTime(v.vol * 0.85, t0 + v.dur * 0.52);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + v.dur);

      osc.connect(bp);
      bp.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(t0);
      lfo.start(t0);
      osc.stop(t0 + v.dur + 0.05);
      lfo.stop(t0 + v.dur + 0.05);
    });

    // 2. Breath/crowd clamor wash layered behind vocal screams
    const dur = 2.5;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.sin((i / ch.length) * Math.PI);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const crowdBp = this.ctx.createBiquadFilter();
    crowdBp.type = 'bandpass';
    crowdBp.frequency.value = 1150;
    crowdBp.Q.value = 1.4;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.linearRampToValueAtTime(0.12, now + 0.25);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(crowdBp);
    crowdBp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playPanicShoutBurst(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const base = 560 + Math.random() * 340;
    const dur = 0.85 + Math.random() * 0.45;
    const osc = this.ctx.createOscillator();
    const bp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.76, now + dur);

    bp.type = 'bandpass';
    bp.frequency.value = base * 1.9;
    bp.Q.value = 3.0;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.04);
  }

  public updateSinkingAmbience(sinkProgress: number): void {
    if (!this.initialized || !this.ctx || !this.engineGain || !this.engineOsc1 || !this.engineOsc2 || !this.oceanNoiseGain || !this.oceanFilter) {
      return;
    }
    const t = this.ctx.currentTime;
    // Turbines fail as boiler rooms flood
    const powerLeft = Math.max(0, 1 - sinkProgress * 1.4);
    this.engineGain.gain.setTargetAtTime(0.04 * powerLeft, t, 0.15);
    this.engineOsc1.frequency.setTargetAtTime(22 + powerLeft * 36, t, 0.2);
    this.engineOsc2.frequency.setTargetAtTime(33 + powerLeft * 54, t, 0.2);

    // Rushing floodwater swells loudly
    this.oceanNoiseGain.gain.setTargetAtTime(0.14 + sinkProgress * 0.22, t, 0.2);
    this.oceanFilter.frequency.setTargetAtTime(340 + sinkProgress * 580, t, 0.2);
  }

  public playTorpedoLaunch(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.32);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.38);

    const dur = 0.48;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.14));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(750, now);
    bp.frequency.exponentialRampToValueAtTime(240, now + dur);
    bp.Q.value = 1.8;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.12, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playNavalCannon(heavy: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = heavy ? 0.95 : 0.45;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 115 : 175, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 28 : 46, now + dur * 0.65);
    gain.gain.setValueAtTime(heavy ? 0.28 : 0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.72);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur * 0.75);

    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * (heavy ? 0.25 : 0.12)));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(heavy ? 950 : 1450, now);
    lp.frequency.exponentialRampToValueAtTime(160, now + dur);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(heavy ? 0.34 : 0.18, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playSubmarineStruck(sunk: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = sunk ? 1.45 : 0.82;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(sunk ? 92 : 112, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + dur * 0.85);
    gain.gain.setValueAtTime(sunk ? 0.38 : 0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);

    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * (sunk ? 0.42 : 0.22)));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(sunk ? 520 : 680, now);
    bp.frequency.exponentialRampToValueAtTime(130, now + dur);
    bp.Q.value = 1.4;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(sunk ? 0.36 : 0.24, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playWantedChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [440, 554.37, 659.25].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.09);
      gain.gain.setValueAtTime(0.11, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.34);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.36);
    });
  }

  public playPoliceSirenPulse(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.linearRampToValueAtTime(920, now + 0.36);
    osc.frequency.linearRampToValueAtTime(600, now + 0.72);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.76);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.78);
  }

  public playMissionPassed(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.12, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.55);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.58);
    });
  }

  public playFocusActivate(active: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(active ? 520 : 240, now);
    osc.frequency.exponentialRampToValueAtTime(active ? 160 : 460, now + 0.28);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playSpeedboatEngine(knots: number, nitro: boolean, active: boolean): void {
    if (!this.initialized || !this.ctx || !this.speedboatGain || !this.speedboatOsc) return;
    const t = this.ctx.currentTime;
    if (!active) {
      this.speedboatGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const norm = Math.min(1, Math.abs(knots) / 84);
    this.speedboatGain.gain.setTargetAtTime(0.025 + norm * (nitro ? 0.1 : 0.065), t, 0.08);
    this.speedboatOsc.frequency.setTargetAtTime(62 + norm * (nitro ? 115 : 82), t, 0.08);
  }

  public dispose(): void {
    try {
      if (this.radioIntervalId !== null) {
        window.clearInterval(this.radioIntervalId);
        this.radioIntervalId = null;
      }
      if (this.bgmAudio) {
        this.bgmAudio.pause();
        this.bgmAudio.removeAttribute('src');
        this.bgmAudio.load();
        this.bgmAudio = null;
      }
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      this.speedboatOsc?.stop();
      void this.ctx?.close();
    } catch {
      // ignore close errors
    }
    this.ctx = null;
    this.initialized = false;
  }
}
