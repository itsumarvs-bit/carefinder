import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceNavigationService } from './voice-navigation.service';

class MockUtterance {
  volume = 1;

  constructor(readonly text: string) {}
}

describe('VoiceNavigationService', () => {
  const originalSpeechSynthesis = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
  const synthesis = { cancel: vi.fn(), speak: vi.fn() };

  beforeEach(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: synthesis,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    synthesis.cancel.mockReset();
    synthesis.speak.mockReset();
  });

  afterEach(() => {
    if (originalSpeechSynthesis) {
      Object.defineProperty(window, 'speechSynthesis', originalSpeechSynthesis);
    } else {
      Reflect.deleteProperty(window, 'speechSynthesis');
    }
    vi.unstubAllGlobals();
  });

  it('speaks instructions and cancels pending speech when muted', () => {
    const voice = new VoiceNavigationService();

    voice.speak('Turn right in 100 meters.');
    expect(synthesis.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Turn right in 100 meters.',
    }));

    expect(voice.toggleMute()).toBe(true);
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    voice.speak('This instruction should be muted.');
    expect(synthesis.speak).toHaveBeenCalledTimes(1);

    expect(voice.toggleMute()).toBe(false);
    voice.repeat('Turn right in 100 meters.');
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
  });

  it('primes speech from the explicit start action without audible output', () => {
    new VoiceNavigationService().prime();

    const utterance = synthesis.speak.mock.calls[0]?.[0] as MockUtterance | undefined;
    expect(utterance?.volume).toBe(0);
  });

  it('does not throw when speech synthesis is unavailable', () => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    const voice = new VoiceNavigationService();

    expect(voice.supported).toBe(false);
    expect(() => voice.speak('Turn left.')).not.toThrow();
  });
});
