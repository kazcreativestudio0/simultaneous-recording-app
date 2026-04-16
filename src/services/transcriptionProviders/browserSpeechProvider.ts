import { TranscriptionProvider, TranscriptionProviderHandlers } from './types';

export class BrowserSpeechProvider implements TranscriptionProvider {
  private recognition: any = null;
  private active = false;
  private restartAttempts = 0;

  constructor(private readonly handlers: TranscriptionProviderHandlers) {}

  async start() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      throw new Error('Browser speech recognition is not available.');
    }

    this.active = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ja-JP';

    recognition.onstart = () => {
      this.restartAttempts = 0;
      this.handlers.onStatusChange('listening');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      this.handlers.onActivity();

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          this.handlers.onFinal(transcript);
        } else {
          interim = `${interim} ${transcript}`.trim();
        }
      }

      this.handlers.onInterim(interim);
    };

    recognition.onerror = (event: any) => {
      this.handlers.onError(event?.error || event);
      if (event?.error === 'network') {
        this.handlers.onStatusChange('waiting-network');
      }
    };

    recognition.onend = () => {
      if (!this.active) return;
      this.restartAttempts += 1;
      this.handlers.onStatusChange('reconnecting');
      window.setTimeout(() => {
        if (!this.active) return;
        try {
          recognition.start();
        } catch (error) {
          this.handlers.onError(error);
          this.handlers.onStatusChange('fallback');
        }
      }, Math.min(1500, 250 * this.restartAttempts));
    };

    this.recognition = recognition;
    recognition.start();
  }

  async stop() {
    this.active = false;
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // Ignore stop races from browser SpeechRecognition.
      }
      this.recognition = null;
    }
    this.handlers.onStatusChange('idle');
  }
}
