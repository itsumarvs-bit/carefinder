import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('plays the intro once per app launch, even if the root component is recreated', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const firstFixture = TestBed.createComponent(AppComponent);
    firstFixture.detectChanges();
    expect(firstFixture.componentInstance.introVisible).toBe(true);
    firstFixture.destroy();

    const nextFixture = TestBed.createComponent(AppComponent);
    nextFixture.detectChanges();
    expect(nextFixture.componentInstance.introVisible).toBe(false);
    nextFixture.destroy();
  });
});
