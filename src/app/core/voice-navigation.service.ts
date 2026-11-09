import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class VoiceNavigationService {
  muted = false;

  get supported(): boolean {
    return typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  prime(): void {
    if (!this.supported) return;
    const unlockUtterance = new SpeechSynthesisUtterance(' ');
    unlockUtterance.volume = 0;
    window.speechSynthesis.speak(unlockUtterance);
  }

  speak(text: string): void {
    if (!this.supported || this.muted) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  repeat(text: string): void {
    this.speak(text);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted && this.supported) window.speechSynthesis.cancel();
    return this.muted;
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
