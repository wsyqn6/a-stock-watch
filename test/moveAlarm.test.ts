import { describe, expect, it } from 'bun:test';
import { MoveAlarmState, hitDirection } from '../src/moveAlarmCore';

describe('hitDirection', () => {
  it('up above threshold', () => {
    expect(hitDirection(5.2, 5)).toBe('up');
  });

  it('threshold boundary counts as hit', () => {
    expect(hitDirection(5, 5)).toBe('up');
    expect(hitDirection(-5, 5)).toBe('down');
  });

  it('down below negative threshold', () => {
    expect(hitDirection(-5.2, 5)).toBe('down');
  });

  it('null inside threshold', () => {
    expect(hitDirection(4.9, 5)).toBeNull();
    expect(hitDirection(-4.9, 5)).toBeNull();
  });

  it('null on flat', () => {
    expect(hitDirection(0, 5)).toBeNull();
  });
});

describe('MoveAlarmState', () => {
  const now = 1_000_000_000_000;
  const cooldown = 30 * 60_000;

  it('fires first hit', () => {
    const s = new MoveAlarmState(cooldown);
    expect(s.shouldNotify('sh600519', 'up', now)).toBe(true);
  });

  it('suppresses within cooldown', () => {
    const s = new MoveAlarmState(cooldown);
    s.shouldNotify('sh600519', 'up', now);
    expect(s.shouldNotify('sh600519', 'up', now + 10_000)).toBe(false);
  });

  it('fires again after cooldown', () => {
    const s = new MoveAlarmState(cooldown);
    s.shouldNotify('sh600519', 'up', now);
    expect(s.shouldNotify('sh600519', 'up', now + cooldown)).toBe(true);
  });

  it('tracks directions separately', () => {
    const s = new MoveAlarmState(cooldown);
    s.shouldNotify('sh600519', 'up', now);
    expect(s.shouldNotify('sh600519', 'down', now + 1000)).toBe(true);
  });

  it('tracks symbols separately', () => {
    const s = new MoveAlarmState(cooldown);
    s.shouldNotify('sh600519', 'up', now);
    expect(s.shouldNotify('sz000001', 'up', now + 1000)).toBe(true);
  });
});
