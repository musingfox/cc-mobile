class VoiceInputService {
  private recognition: any = null;
  private listening = false;

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }

  startListening(onResult: (transcript: string) => void, onError?: (error: string) => void): void {
    if (!this.isSupported()) {
      console.warn("[voice-input] not supported");
      onError?.("Speech recognition not supported");
      return;
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognitionAPI();
    this.recognition.lang = "en-US";
    this.recognition.interimResults = false;
    this.recognition.continuous = false;

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
      this.listening = false;
    };

    this.recognition.onerror = (event: any) => {
      console.error("[voice-input] error:", event.error);
      this.listening = false;
      onError?.(event.error);
    };

    this.recognition.onend = () => {
      this.listening = false;
    };

    this.recognition.start();
    this.listening = true;
  }

  stopListening(): void {
    if (this.recognition) {
      this.recognition.stop();
      this.listening = false;
    }
  }

  isListening(): boolean {
    return this.listening;
  }
}

export const voiceInputService = new VoiceInputService();
