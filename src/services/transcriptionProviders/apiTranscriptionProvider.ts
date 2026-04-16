import { LatestOnlyQueue } from '../networkQueue';
import {
  NetworkMode,
  TranscriptionProvider,
  TranscriptionProviderHandlers,
} from './types';

const blobToBase64 = async (blob: Blob) => {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

interface QueueItem {
  mimeType: string;
  base64Audio: string;
}

export class ApiTranscriptionProvider implements TranscriptionProvider {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private active = false;
  private retryBuffer: QueueItem | null = null;
  private queue: LatestOnlyQueue<QueueItem>;

  constructor(
    private readonly handlers: TranscriptionProviderHandlers,
    private readonly networkMode: NetworkMode
  ) {
    this.queue = new LatestOnlyQueue(async (item) => {
      await this.sendChunk(item);
    });
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording for high accuracy mode is not supported.');
    }

    this.active = true;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: preferredMimeType,
    });

    this.mediaRecorder.ondataavailable = async (event) => {
      if (!this.active || !event.data || event.data.size === 0) return;
      this.handlers.onActivity();
      this.handlers.onStatusChange('processing');
      this.handlers.onInterim('音声を高精度で解析中...');
      const base64Audio = await blobToBase64(event.data);
      this.queue.enqueue({
        mimeType: event.data.type || preferredMimeType,
        base64Audio,
      });
    };

    this.mediaRecorder.onerror = (event) => {
      this.handlers.onError((event as any).error || event);
    };

    this.handlers.onStatusChange('listening');
    this.mediaRecorder.start(this.networkMode === 'low-bandwidth' ? 8000 : 4500);
  }

  async stop() {
    this.active = false;
    this.queue.clear();
    this.retryBuffer = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.handlers.onInterim('');
    this.handlers.onStatusChange('idle');
  }

  private async sendChunk(item: QueueItem) {
    try {
      const response = await fetch('/api/transcribe-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(item),
      });

      if (!response.ok) {
        throw new Error(`Transcription API returned ${response.status}`);
      }

      const result = await response.json();
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      if (text) {
        this.handlers.onFinal(text);
      }
      this.retryBuffer = null;
      this.handlers.onInterim('');
      this.handlers.onStatusChange('listening');
    } catch (error) {
      this.retryBuffer = item;
      this.handlers.onError(error);
      this.handlers.onStatusChange('waiting-network');
      window.setTimeout(() => {
        if (this.active && this.retryBuffer) {
          this.queue.enqueue(this.retryBuffer);
        }
      }, 2000);
    }
  }
}
