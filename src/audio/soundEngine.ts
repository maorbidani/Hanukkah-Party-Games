declare global {
  interface Window {
    currentUtterance?: SpeechSynthesisUtterance | null;
  }
}

export interface SpeakHebrewOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  duckLevel?: number;
  maxApiWaitMs?: number;
  onEnd?: () => void;
}

export interface VoiceDebugInfo {
  engine: 'gemini' | 'browser' | 'none';
  label: string;
  lang: string | null;
  isHebrew: boolean;
  count: number;
  supported: boolean;
  lastEvent?: string;
}

interface ClientTtsEntry {
  bytes: Uint8Array;
  mimeType: string;
  provider: 'gemini' | 'web';
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private bgMusicGain: GainNode | null = null;
  private muted: boolean = false;
  private lastSpinSoundTime: number = 0;

  // Background epic music state & Audio Ducking
  private bgMusicTimer: number | null = null;
  private bgMusicStep: number = 0;
  private bgMusicEnabled: boolean = false;
  private musicDucked: boolean = false;
  private currentDuckLevel: number = 0.2;

  // Server Gemini TTS cache & active playback state
  private ttsCache = new Map<string, ClientTtsEntry>();
  private ttsInFlight = new Map<string, Promise<ClientTtsEntry | null>>();
  private ttsUnavailableUntil: number = 0;
  private activeTtsAbort: AbortController | null = null;
  private activeBufferSource: AudioBufferSourceNode | null = null;
  private activeHtmlAudio: HTMLAudioElement | null = null;
  private activeHtmlAudioUrl: string | null = null;

  // Browser SpeechSynthesis fallback state & voice cache
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private selectedIsHebrew: boolean = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private speechStartTimer: number | null = null;
  private speechFallbackTimer: number | null = null;
  private speechKeepAliveTimer: number | null = null;
  private voicesInitialized: boolean = false;
  private speechGenerationId: number = 0;
  private isSpeakingFlag: boolean = false;
  private speechEndCallbacks = new Set<() => void>();
  private voiceListeners = new Set<(info: VoiceDebugInfo) => void>();
  private voiceDebugInfo: VoiceDebugInfo = {
    engine: 'gemini',
    label: 'קריין AI (Gemini TTS) + גיבוי דפדפן',
    lang: 'he-IL',
    isHebrew: true,
    count: 0,
    supported: true,
    lastEvent: 'מוכן',
  };

  constructor() {
    this.initVoices();
  }

  private isHebrewVoice(v: SpeechSynthesisVoice): boolean {
    const lang = v.lang.toLowerCase();
    return (
      lang === 'he-il' ||
      lang.startsWith('he') ||
      lang === 'iw-il' ||
      lang.startsWith('iw') ||
      /hebrew|עברית|carmit|asaf|avri|hila/i.test(v.name)
    );
  }

  private updateVoiceDebug(voices: SpeechSynthesisVoice[]): void {
    const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const prevEvent = this.voiceDebugInfo.lastEvent;
    const prevEngine = this.voiceDebugInfo.engine;

    if (supported && voices.length > 0) {
      const heExact = voices.find((v) => v.lang.toLowerCase() === 'he-il');
      const heAny = voices.find((v) => this.isHebrewVoice(v));
      const hebrewVoice = heExact || heAny || null;
      if (hebrewVoice) {
        this.selectedVoice = hebrewVoice;
        this.selectedIsHebrew = true;
      } else {
        this.selectedVoice = voices[0];
        this.selectedIsHebrew = false;
      }
    } else {
      this.selectedVoice = null;
      this.selectedIsHebrew = false;
    }

    const label =
      prevEngine === 'gemini'
        ? 'קריין AI (Gemini TTS) + גיבוי דפדפן'
        : this.selectedIsHebrew && this.selectedVoice
        ? `קול דפדפן עברי: ${this.selectedVoice.name}`
        : this.selectedVoice
        ? `קול דפדפן: ${this.selectedVoice.name} (${this.selectedVoice.lang})`
        : supported
        ? 'קול דפדפן (he-IL)'
        : 'שמע AI (Gemini TTS)';

    this.voiceDebugInfo = {
      engine: prevEngine,
      label,
      lang: prevEngine === 'gemini' ? 'he-IL' : this.selectedVoice?.lang ?? 'he-IL',
      isHebrew: prevEngine === 'gemini' ? true : this.selectedIsHebrew,
      count: voices.length,
      supported: true,
      lastEvent: prevEvent,
    };

    this.voiceListeners.forEach((cb) => cb(this.voiceDebugInfo));
  }

  private setEngineDebug(engine: 'gemini' | 'browser', lastEvent: string): void {
    const label =
      engine === 'gemini'
        ? 'קריין AI (Gemini TTS)'
        : this.selectedIsHebrew && this.selectedVoice
        ? `גיבוי דפדפן: ${this.selectedVoice.name}`
        : this.selectedVoice
        ? `גיבוי דפדפן: ${this.selectedVoice.name} (${this.selectedVoice.lang})`
        : 'גיבוי דפדפן (he-IL)';
    this.voiceDebugInfo = {
      ...this.voiceDebugInfo,
      engine,
      label,
      isHebrew: engine === 'gemini' ? true : this.selectedIsHebrew,
      lastEvent,
    };
    this.voiceListeners.forEach((cb) => cb(this.voiceDebugInfo));
  }

  public getVoiceDebugInfo(): VoiceDebugInfo {
    return this.voiceDebugInfo;
  }

  public onVoiceChange(cb: (info: VoiceDebugInfo) => void): () => void {
    this.voiceListeners.add(cb);
    cb(this.voiceDebugInfo);
    return () => {
      this.voiceListeners.delete(cb);
    };
  }

  public initVoices(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.updateVoiceDebug([]);
      return;
    }
    if (this.voicesInitialized) return;
    this.voicesInitialized = true;

    const load = () => {
      try {
        const list = window.speechSynthesis.getVoices();
        if (list && list.length > 0) {
          this.cachedVoices = list;
        }
        this.updateVoiceDebug(this.cachedVoices);
      } catch {
        this.updateVoiceDebug([]);
      }
    };

    load();
    window.speechSynthesis.onvoiceschanged = load;

    window.setTimeout(load, 200);
    window.setTimeout(load, 750);
    window.setTimeout(load, 1800);
  }

  private getSmartVoice(): { voice: SpeechSynthesisVoice | null; isHebrew: boolean } {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return { voice: null, isHebrew: false };
    }
    try {
      const fresh = window.speechSynthesis.getVoices();
      if (fresh && fresh.length > 0) {
        this.cachedVoices = fresh;
        this.updateVoiceDebug(fresh);
      }
    } catch {
      // Ignore getVoices error
    }

    return { voice: this.selectedVoice, isHebrew: this.selectedIsHebrew };
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.bgMusicGain) {
      this.bgMusicGain = this.ctx.createGain();
      this.bgMusicGain.gain.setValueAtTime(
        this.musicDucked ? this.currentDuckLevel : 1.0,
        this.ctx.currentTime
      );
      this.bgMusicGain.connect(this.ctx.destination);
    }

    return this.ctx;
  }

  public setMusicDucking(ducked: boolean, duckLevel: number = 0.2): void {
    this.musicDucked = ducked;
    if (ducked) {
      this.currentDuckLevel = duckLevel;
    }
    if (!this.ctx || !this.bgMusicGain) return;

    try {
      const now = this.ctx.currentTime;
      const targetGain = ducked ? this.currentDuckLevel : 1.0;
      const rampSeconds = ducked ? 0.12 : 0.38;
      this.bgMusicGain.gain.cancelScheduledValues(now);
      this.bgMusicGain.gain.setValueAtTime(this.bgMusicGain.gain.value, now);
      this.bgMusicGain.gain.linearRampToValueAtTime(targetGain, now + rampSeconds);
    } catch {
      // Ignore gain scheduling edge cases
    }
  }

  public unlock(): void {
    this.initVoices();
    this.ensureContext();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
      } catch {
        // Ignore
      }
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopSpeech();
      this.clearBgTimer();
    } else if (this.bgMusicEnabled) {
      this.startBackgroundMusic();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private clearActiveSpeechTimersAndHandlers(cancelSynth: boolean): void {
    if (this.activeTtsAbort) {
      this.activeTtsAbort.abort();
      this.activeTtsAbort = null;
    }

    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.onended = null;
        this.activeBufferSource.stop();
        this.activeBufferSource.disconnect();
      } catch {
        // Ignore stop errors
      }
      this.activeBufferSource = null;
    }

    if (this.activeHtmlAudio) {
      try {
        this.activeHtmlAudio.onended = null;
        this.activeHtmlAudio.onerror = null;
        this.activeHtmlAudio.pause();
        this.activeHtmlAudio.src = '';
      } catch {
        // Ignore audio cleanup errors
      }
      this.activeHtmlAudio = null;
    }

    if (this.activeHtmlAudioUrl) {
      URL.revokeObjectURL(this.activeHtmlAudioUrl);
      this.activeHtmlAudioUrl = null;
    }

    if (this.speechStartTimer !== null) {
      window.clearTimeout(this.speechStartTimer);
      this.speechStartTimer = null;
    }

    if (this.speechFallbackTimer !== null) {
      window.clearTimeout(this.speechFallbackTimer);
      this.speechFallbackTimer = null;
    }

    if (this.speechKeepAliveTimer !== null) {
      window.clearInterval(this.speechKeepAliveTimer);
      this.speechKeepAliveTimer = null;
    }

    if (this.currentUtterance) {
      this.currentUtterance.onstart = null;
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }

    if (typeof window !== 'undefined') {
      window.currentUtterance = null;
      if (cancelSynth && 'speechSynthesis' in window) {
        try {
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            window.speechSynthesis.cancel();
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  public stopSpeech(): void {
    this.speechGenerationId++;
    this.isSpeakingFlag = false;
    this.speechEndCallbacks.clear();
    this.clearActiveSpeechTimersAndHandlers(true);
    this.setMusicDucking(false);
  }

  public isSpeaking(): boolean {
    return this.isSpeakingFlag;
  }

  public onCurrentSpeechEnd(cb: () => void): () => void {
    if (!this.isSpeakingFlag) {
      cb();
      return () => {};
    }
    this.speechEndCallbacks.add(cb);
    return () => {
      this.speechEndCallbacks.delete(cb);
    };
  }

  private lastQuotaWarning: string | null = null;

  private async fetchFromEndpoint(
    endpoint: '/api/tts' | '/api/tts-web',
    text: string,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<ClientTtsEntry | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (endpoint === '/api/tts') {
          if (res.status === 429) {
            this.ttsUnavailableUntil = Date.now() + 60000;
            this.lastQuotaWarning = 'מכסת Gemini החינמית (10/יום) הסתיימה — פעיל בקריין רשת';
          } else if (res.status === 403 || res.status === 503) {
            this.ttsUnavailableUntil = Date.now() + 60000;
            this.lastQuotaWarning = 'מפתח Gemini לא זמין — פעיל בקריין רשת';
          }
        }
        return null;
      }

      const data = (await res.json()) as { audioBase64?: string; mimeType?: string };
      if (!data?.audioBase64) return null;

      if (endpoint === '/api/tts') {
        this.lastQuotaWarning = null;
      }

      return {
        bytes: base64ToUint8Array(data.audioBase64),
        mimeType: data.mimeType || (endpoint === '/api/tts' ? 'audio/wav' : 'audio/mpeg'),
        provider: endpoint === '/api/tts' ? 'gemini' : 'web',
      };
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private async fetchServerTtsEntry(
    text: string,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<ClientTtsEntry | null> {
    const normalized = text.trim();
    if (!normalized) return null;

    const cached = this.ttsCache.get(normalized);
    if (cached) return cached;

    const existing = this.ttsInFlight.get(normalized);
    if (existing) return existing;

    const task = (async (): Promise<ClientTtsEntry | null> => {
      let entry: ClientTtsEntry | null = null;

      // Tier 1: Gemini TTS (unless in cooldown from 429/403/503)
      if (Date.now() >= this.ttsUnavailableUntil) {
        entry = await this.fetchFromEndpoint('/api/tts', normalized, timeoutMs, externalSignal);
      }

      // Tier 2: Unlimited server-side Hebrew MP3 speech if Gemini TTS unavailable/quota exceeded
      if (!entry && !externalSignal?.aborted) {
        if (this.lastQuotaWarning) {
          this.setEngineDebug('gemini', this.lastQuotaWarning);
        }
        entry = await this.fetchFromEndpoint('/api/tts-web', normalized, timeoutMs, externalSignal);
      }

      if (entry) {
        if (this.ttsCache.size >= 60) {
          const oldest = this.ttsCache.keys().next().value;
          if (oldest !== undefined) this.ttsCache.delete(oldest);
        }
        this.ttsCache.set(normalized, entry);
      }

      return entry;
    })();

    this.ttsInFlight.set(normalized, task);
    try {
      return await task;
    } finally {
      this.ttsInFlight.delete(normalized);
    }
  }

  public async prefetchWebSpeech(texts: string[]): Promise<void> {
    if (typeof window === 'undefined' || this.muted) return;
    for (const raw of texts) {
      const text = raw.trim();
      if (!text || this.ttsCache.has(text)) continue;
      const entry = await this.fetchFromEndpoint('/api/tts-web', text, 8000);
      if (!entry) break;
      if (this.ttsCache.size >= 60) {
        const oldest = this.ttsCache.keys().next().value;
        if (oldest !== undefined) this.ttsCache.delete(oldest);
      }
      this.ttsCache.set(text, entry);
    }
  }

  private async playTtsEntry(
    entry: ClientTtsEntry,
    volume: number,
    myGenId: number
  ): Promise<boolean> {
    if (myGenId !== this.speechGenerationId || this.muted) return false;

    const ctx = this.ensureContext();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const copyBytes = new Uint8Array(entry.bytes);
        const audioBuffer = await ctx.decodeAudioData(copyBytes.buffer);
        if (myGenId !== this.speechGenerationId || this.muted) return false;

        return await new Promise<boolean>((resolve) => {
          let done = false;
          const finishPlay = (ok: boolean) => {
            if (done) return;
            done = true;
            if (this.speechFallbackTimer !== null) {
              window.clearTimeout(this.speechFallbackTimer);
              this.speechFallbackTimer = null;
            }
            if (this.activeBufferSource === source) {
              this.activeBufferSource = null;
            }
            resolve(ok);
          };

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(Math.min(1.5, volume * 1.25), ctx.currentTime);
          source.connect(gainNode);
          gainNode.connect(ctx.destination);

          this.activeBufferSource = source;
          source.onended = () => finishPlay(true);

          const maxWaitMs = Math.max(4000, Math.ceil(audioBuffer.duration * 1000) + 1800);
          this.speechFallbackTimer = window.setTimeout(() => finishPlay(true), maxWaitMs);

          this.setEngineDebug(
            'gemini',
            entry.provider === 'gemini' ? 'מקריא עכשיו (Gemini AI)' : 'מקריא עכשיו (קריין רשת)'
          );
          source.start(0);
        });
      } catch {
        // Fall through to HTMLAudioElement playback
      }
    }

    if (myGenId !== this.speechGenerationId || this.muted) return false;

    return await new Promise<boolean>((resolve) => {
      try {
        const blobBytes = new Uint8Array(entry.bytes.byteLength);
        blobBytes.set(entry.bytes);
        const blob = new Blob([blobBytes], { type: entry.mimeType || 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = Math.min(1.0, volume);
        this.activeHtmlAudio = audio;
        this.activeHtmlAudioUrl = url;

        let done = false;
        const finishHtml = (ok: boolean) => {
          if (done) return;
          done = true;
          if (this.speechFallbackTimer !== null) {
            window.clearTimeout(this.speechFallbackTimer);
            this.speechFallbackTimer = null;
          }
          if (this.activeHtmlAudio === audio) {
            this.activeHtmlAudio = null;
          }
          if (this.activeHtmlAudioUrl === url) {
            URL.revokeObjectURL(url);
            this.activeHtmlAudioUrl = null;
          }
          resolve(ok);
        };

        audio.onended = () => finishHtml(true);
        audio.onerror = () => finishHtml(false);
        this.speechFallbackTimer = window.setTimeout(() => finishHtml(true), 16000);

        audio
          .play()
          .then(() => {
            this.setEngineDebug(
              'gemini',
              entry.provider === 'gemini' ? 'מקריא עכשיו (Gemini AI)' : 'מקריא עכשיו (קריין רשת)'
            );
          })
          .catch(() => finishHtml(false));
      } catch {
        resolve(false);
      }
    });
  }

  private speakWithBrowserFallback(
    text: string,
    myGenId: number,
    options?: SpeakHebrewOptions
  ): Promise<'browser' | 'skipped'> {
    if (
      this.muted ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      myGenId !== this.speechGenerationId
    ) {
      return Promise.resolve('skipped');
    }

    const synth = window.speechSynthesis;
    const wasBusy = synth.speaking || synth.pending;
    if (wasBusy) {
      try {
        synth.cancel();
      } catch {
        // Ignore
      }
    }

    return new Promise<'browser' | 'skipped'>((resolve) => {
      let settled = false;

      const finish = (engine: 'browser' | 'skipped', eventLabel?: string) => {
        if (settled) return;
        settled = true;

        if (this.speechStartTimer !== null) {
          window.clearTimeout(this.speechStartTimer);
          this.speechStartTimer = null;
        }
        if (this.speechFallbackTimer !== null) {
          window.clearTimeout(this.speechFallbackTimer);
          this.speechFallbackTimer = null;
        }
        if (this.speechKeepAliveTimer !== null) {
          window.clearInterval(this.speechKeepAliveTimer);
          this.speechKeepAliveTimer = null;
        }
        if (this.currentUtterance) {
          this.currentUtterance.onstart = null;
          this.currentUtterance.onend = null;
          this.currentUtterance.onerror = null;
          this.currentUtterance = null;
        }
        window.currentUtterance = null;

        if (eventLabel) {
          this.setEngineDebug('browser', eventLabel);
        }

        resolve(myGenId === this.speechGenerationId ? engine : 'skipped');
      };

      const startUtterance = (useSelectedVoice: boolean, allowRetryWithoutVoice: boolean) => {
        if (settled || myGenId !== this.speechGenerationId || this.muted) {
          finish('skipped');
          return;
        }

        try {
          const utterance = new SpeechSynthesisUtterance(text);
          const { voice, isHebrew } = this.getSmartVoice();

          if (useSelectedVoice && voice) {
            utterance.voice = voice;
            utterance.lang = isHebrew ? voice.lang || 'he-IL' : 'he-IL';
          } else {
            utterance.lang = 'he-IL';
          }

          utterance.rate = options?.rate ?? 0.95;
          utterance.pitch = options?.pitch ?? 0.85;
          utterance.volume = options?.volume ?? 1.0;

          const startMs = performance.now();
          let started = false;

          utterance.onstart = () => {
            started = true;
            this.setEngineDebug('browser', 'מקריא (גיבוי דפדפן)');
          };

          utterance.onend = () => {
            const elapsed = performance.now() - startMs;
            if (!started && elapsed < 250 && allowRetryWithoutVoice && useSelectedVoice && !isHebrew) {
              startUtterance(false, false);
              return;
            }
            finish('browser', 'הסתיים (דפדפן)');
          };

          utterance.onerror = (ev) => {
            const errCode = ev?.error || 'error';
            if ((errCode === 'canceled' || errCode === 'interrupted') && myGenId !== this.speechGenerationId) {
              finish('skipped');
              return;
            }
            if (allowRetryWithoutVoice && useSelectedVoice && !isHebrew) {
              startUtterance(false, false);
              return;
            }
            finish('browser', `שגיאת דפדפן: ${errCode}`);
          };

          this.currentUtterance = utterance;
          window.currentUtterance = utterance;

          synth.resume();
          synth.speak(utterance);
          synth.resume();
        } catch {
          finish('skipped', 'חריגה בגיבוי דפדפן');
        }
      };

      this.speechKeepAliveTimer = window.setInterval(() => {
        if (settled || myGenId !== this.speechGenerationId) {
          if (this.speechKeepAliveTimer !== null) {
            window.clearInterval(this.speechKeepAliveTimer);
            this.speechKeepAliveTimer = null;
          }
          return;
        }
        try {
          synth.resume();
        } catch {
          // Ignore
        }
      }, 3000);

      this.speechFallbackTimer = window.setTimeout(() => finish('browser', 'פסק זמן דפדפן'), 15000);

      if (wasBusy) {
        this.speechStartTimer = window.setTimeout(() => {
          this.speechStartTimer = null;
          startUtterance(true, true);
        }, 80);
      } else {
        startUtterance(true, true);
      }
    });
  }

  /**
   * Universal Hebrew Narrator:
   * 1. Primary: Server-side Gemini TTS (gemini-3.8-flash-lite-tts WAV) decoded & played through
   *    already-unlocked AudioContext (works reliably on desktop, mobile iOS/Android, and embedded iframes).
   * 2. Instant memory cache + background prefetching for zero-latency clicks.
   * 3. Automatic fallback to hardened browser window.speechSynthesis if server/network is unavailable.
   */
  public speakHebrew(
    text: string,
    onCompleteCallback?: () => void
  ): Promise<'gemini' | 'browser' | 'skipped'>;
  public speakHebrew(
    text: string,
    options?: SpeakHebrewOptions
  ): Promise<'gemini' | 'browser' | 'skipped'>;
  public async speakHebrew(
    text: string,
    optionsOrCallback?: SpeakHebrewOptions | (() => void)
  ): Promise<'gemini' | 'browser' | 'skipped'> {
    const options: SpeakHebrewOptions | undefined =
      typeof optionsOrCallback === 'function' ? { onEnd: optionsOrCallback } : optionsOrCallback;
    const onEnd = options?.onEnd;

    const notifyComplete = () => {
      this.isSpeakingFlag = false;
      this.setMusicDucking(false);
      onEnd?.();
      const cbs = Array.from(this.speechEndCallbacks);
      this.speechEndCallbacks.clear();
      cbs.forEach((fn) => fn());
    };

    const trimmed = text.trim();
    if (this.muted || typeof window === 'undefined' || !trimmed) {
      notifyComplete();
      return 'skipped';
    }

    this.speechGenerationId++;
    const myGenId = this.speechGenerationId;
    this.speechEndCallbacks.clear();
    this.clearActiveSpeechTimersAndHandlers(true);

    const duckLevel = options?.duckLevel ?? 0.2;
    this.isSpeakingFlag = true;
    this.setMusicDucking(true, duckLevel);

    const abortController = new AbortController();
    this.activeTtsAbort = abortController;
    const maxApiWaitMs = options?.maxApiWaitMs ?? 7000;
    const volume = options?.volume ?? 1.0;

    if (!this.ttsCache.has(trimmed)) {
      this.setEngineDebug('gemini', 'מכין קריינות...');
    }

    const entry = await this.fetchServerTtsEntry(trimmed, maxApiWaitMs, abortController.signal);
    if (this.activeTtsAbort === abortController) {
      this.activeTtsAbort = null;
    }

    if (myGenId !== this.speechGenerationId || this.muted) {
      return 'skipped';
    }

    if (entry) {
      const played = await this.playTtsEntry(entry, volume, myGenId);
      if (myGenId !== this.speechGenerationId) {
        return 'skipped';
      }
      if (played) {
        this.setEngineDebug(
          'gemini',
          entry.provider === 'gemini'
            ? 'הסתיים (Gemini AI)'
            : this.lastQuotaWarning || 'הסתיים (קריין רשת)'
        );
        notifyComplete();
        return 'gemini';
      }
    }

    // Automatic fallback to browser speechSynthesis if Gemini TTS failed or timed out
    this.setEngineDebug('browser', 'עבר לגיבוי דפדפן');
    const fallbackResult = await this.speakWithBrowserFallback(trimmed, myGenId, options);
    if (myGenId !== this.speechGenerationId) {
      return 'skipped';
    }
    notifyComplete();
    return fallbackResult;
  }

  private clearBgTimer(): void {
    if (this.bgMusicTimer !== null) {
      window.clearInterval(this.bgMusicTimer);
      this.bgMusicTimer = null;
    }
  }

  /**
   * Epic, dramatic Web Audio API intro & briefing music:
   * Deep minor chords + rhythmic timpani/bass drum hits routed through bgMusicGain
   * so narration automatically ducks music to 20% and restores to 100% on completion.
   */
  public startBackgroundMusic(): void {
    this.bgMusicEnabled = true;
    if (this.muted || this.bgMusicTimer !== null) return;
    if (typeof window === 'undefined') return;

    this.bgMusicStep = 0;

    // Dramatic D-minor epic chord progression (Dm -> Bb -> Gm -> A)
    const chords: Array<{ bass: number; notes: number[] }> = [
      { bass: 73.42, notes: [146.83, 174.61, 220.0] },
      { bass: 58.27, notes: [116.54, 146.83, 174.61] },
      { bass: 98.0, notes: [196.0, 233.08, 293.66] },
      { bass: 55.0, notes: [110.0, 138.59, 164.81] },
    ];

    this.bgMusicTimer = window.setInterval(() => {
      if (this.muted || !this.bgMusicEnabled) return;
      const ctx = this.ensureContext();
      if (!ctx || !this.bgMusicGain) return;

      const musicOut = this.bgMusicGain;
      const step = this.bgMusicStep++;
      const barStep = step % 8;
      const chordIdx = Math.floor(step / 8) % chords.length;
      const chord = chords[chordIdx];

      const intensity = Math.min(1.0, 0.45 + (step / 32) * 0.55);
      const now = ctx.currentTime;

      // 1. Deep epic brass/string chord pad on beat 0 of every bar
      if (barStep === 0) {
        chord.notes.forEach((freq) => {
          const osc = ctx.createOscillator();
          const filter = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(340 + intensity * 260, now);

          const padVol = 0.022 * intensity;
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(padVol, now + 0.18);
          gain.gain.setValueAtTime(padVol * 0.85, now + 1.4);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.95);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(musicOut);
          osc.start(now);
          osc.stop(now + 2.0);
        });
      }

      // 2. Rhythmic deep bass pulse
      if (barStep % 2 === 0 || (intensity > 0.7 && barStep === 7)) {
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(chord.bass, now);

        const bVol = (barStep === 0 ? 0.11 : 0.075) * intensity;
        bassGain.gain.setValueAtTime(0.001, now);
        bassGain.gain.linearRampToValueAtTime(bVol, now + 0.015);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        bassOsc.connect(bassGain);
        bassGain.connect(musicOut);
        bassOsc.start(now);
        bassOsc.stop(now + 0.24);
      }

      // 3. Dramatic Timpani / Taiko Drum hits
      const drumHit =
        barStep === 0 ||
        barStep === 3 ||
        barStep === 4 ||
        barStep === 6 ||
        (intensity > 0.8 && barStep === 7);

      if (drumHit) {
        const drumOsc = ctx.createOscillator();
        const drumGain = ctx.createGain();
        drumOsc.type = 'sine';
        drumOsc.frequency.setValueAtTime(barStep === 0 ? 115 : 95, now);
        drumOsc.frequency.exponentialRampToValueAtTime(34, now + 0.19);

        const dVol = (barStep === 0 ? 0.18 : 0.12) * intensity;
        drumGain.gain.setValueAtTime(dVol, now);
        drumGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        drumOsc.connect(drumGain);
        drumGain.connect(musicOut);
        drumOsc.start(now);
        drumOsc.stop(now + 0.24);
      }
    }, 240);
  }

  public stopBackgroundMusic(): void {
    this.bgMusicEnabled = false;
    this.clearBgTimer();
  }

  public playCountdownBeep(number: 3 | 2 | 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqMap: Record<3 | 2 | 1, number> = {
      3: 392.0,
      2: 440.0,
      1: 523.25,
    };

    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqMap[number], now);
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freqMap[number] * 0.5, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    sub.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    sub.start(now);
    osc.stop(now + 0.28);
    sub.stop(now + 0.28);
  }

  public playGoFanfare(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.14 },
      { freq: 659.25, time: 0.09, dur: 0.14 },
      { freq: 783.99, time: 0.18, dur: 0.16 },
      { freq: 1046.5, time: 0.28, dur: 0.45 },
    ];

    notes.forEach(({ freq, time, dur }) => {
      const start = now + time;
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      sub.type = 'sine';
      sub.frequency.setValueAtTime(freq * 0.5, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain);
      sub.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      sub.start(start);
      osc.stop(start + dur + 0.02);
      sub.stop(start + dur + 0.02);
    });
  }

  public playEndWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [2450, 2680].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 0.94, now + 0.48);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.03);
      gain.gain.setValueAtTime(0.14, now + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.54);
    });
  }

  public playCoinCollect(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [987.77, 1318.51].forEach((freq, idx) => {
      const start = now + idx * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  }

  public playJackpotBag(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [1046.5, 1318.51, 1567.98, 2093.0].forEach((freq, idx) => {
      const start = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  public playSugarThrow(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.14);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playSugarSplat(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playTorchTone(torchIndex: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [329.63, 440.0, 554.37, 659.25];
    const freq = notes[torchIndex % notes.length];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playWrongTorch(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(115, now + 0.28);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playSwordSlash(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Sharp Whoosh (sweeping bandpass white noise)
    const bufferSize = Math.floor(ctx.sampleRate * 0.16);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(2800, now + 0.12);
    filter.Q.setValueAtTime(1.6, now);

    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0.28, now);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    noise.connect(filter);
    filter.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    noise.start(now);

    // 2. Strong Metallic Blade Clang
    const partials = [920, 1560, 2380, 3120];
    partials.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now + 0.015);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.9, now + 0.28);

      const amp = idx === 0 ? 0.28 : 0.16 / idx;
      gain.gain.setValueAtTime(amp, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + 0.015);
      osc.stop(now + 0.3);
    });
  }

  public playLightningShoot(side: 'left' | 'right'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    const startFreq = side === 'left' ? 760 : 680;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.Q.setValueAtTime(1.8, now);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playLightningHit(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Electric crackle burst
    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(2200, now);
    hp.Q.setValueAtTime(1.2, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.28, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(hp);
    hp.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);

    // 2. Heavy punch thud
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(175, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.18);

    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.21);
  }

  public playKnockoutBell(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [0, 0.2, 0.4].forEach((offset) => {
      const start = now + offset;
      [660, 1320, 1980].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(idx === 0 ? 0.24 : 0.12 / idx, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.57);
      });
    });
  }

  public playJarBreak(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Ceramic clay shatter crunch
    const bufferSize = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1400, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.26, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);

    // 2. Low warning descend tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, now + 0.03);
    osc.frequency.linearRampToValueAtTime(110, now + 0.3);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, now);

    gain.gain.setValueAtTime(0.2, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + 0.03);
    osc.stop(now + 0.34);
  }

  public playShieldBlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const partials = [420, 785, 1290, 1980];
    partials.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.88, now + 0.22);

      const amp = idx === 0 ? 0.22 : 0.14 / idx;
      gain.gain.setValueAtTime(amp, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  public playShamashGrab(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [587.33, 880.0, 1174.66];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  public playBite(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const bufferSize = Math.floor(ctx.sampleRate * 0.08);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(1.8, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.26, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now + 0.02);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain.gain.setValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + 0.02);
    osc.stop(now + 0.17);
  }

  public playBomb(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.32);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.32);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  public playCandleLight(candleIndex: number = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(2200, now + 0.14);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.14, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);

    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
    const freq = scale[candleIndex % scale.length];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + 0.03);

    gain.gain.setValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + 0.03);
    osc.stop(now + 0.3);
  }

  public playHanukkiahComplete(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }

  public playDreidelWhistle(speedRatio: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const nowMs = performance.now();
    const interval = Math.max(95, 280 - speedRatio * 185);
    if (nowMs - this.lastSpinSoundTime < interval) return;
    this.lastSpinSoundTime = nowMs;

    const now = ctx.currentTime;
    const baseFreq = 260 + speedRatio * 560;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.16, now + 0.07);

    const vol = Math.min(0.11, 0.03 + speedRatio * 0.08);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playCountdownTick(urgent: boolean = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(urgent ? 920 : 660, now);

    gain.gain.setValueAtTime(urgent ? 0.14 : 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playVictoryMusic(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const melody: Array<{ freq: number; time: number; dur: number }> = [
      { freq: 523.25, time: 0.0, dur: 0.18 },
      { freq: 392.0, time: 0.18, dur: 0.18 },
      { freq: 523.25, time: 0.36, dur: 0.18 },
      { freq: 587.33, time: 0.54, dur: 0.18 },
      { freq: 659.25, time: 0.72, dur: 0.24 },
      { freq: 587.33, time: 0.98, dur: 0.16 },
      { freq: 659.25, time: 1.15, dur: 0.18 },
      { freq: 783.99, time: 1.34, dur: 0.26 },
      { freq: 659.25, time: 1.62, dur: 0.16 },
      { freq: 783.99, time: 1.8, dur: 0.2 },
      { freq: 1046.5, time: 2.02, dur: 0.55 },
    ];

    melody.forEach(({ freq, time, dur }) => {
      const start = now + time;
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      sub.type = 'sine';
      sub.frequency.setValueAtTime(freq * 0.5, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain);
      sub.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      sub.start(start);
      osc.stop(start + dur + 0.02);
      sub.stop(start + dur + 0.02);
    });
  }
}

export const soundEngine = new SoundEngine();

export function speakHebrew(
  text: string,
  onCompleteCallback?: (() => void) | SpeakHebrewOptions
): Promise<'gemini' | 'browser' | 'skipped'> {
  return typeof onCompleteCallback === 'function'
    ? soundEngine.speakHebrew(text, onCompleteCallback)
    : soundEngine.speakHebrew(text, onCompleteCallback);
}
