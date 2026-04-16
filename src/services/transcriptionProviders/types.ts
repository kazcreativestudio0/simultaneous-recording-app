export type TranscriptionMode = 'standard' | 'high-accuracy';
export type NetworkMode = 'balanced' | 'low-bandwidth';
export type TranscriptionStatus =
  | 'idle'
  | 'listening'
  | 'reconnecting'
  | 'processing'
  | 'waiting-network'
  | 'fallback';

export interface TranscriptionProviderHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onStatusChange: (status: TranscriptionStatus) => void;
  onActivity: () => void;
  onError: (error: unknown) => void;
}

export interface TranscriptionProvider {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface TranscriptionSettings {
  transcriptionMode: TranscriptionMode;
  networkMode: NetworkMode;
}
