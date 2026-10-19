import { payloadHash } from './payload-hash';

const base = {
  deviceId: 'sim-device-001',
  intervalStart: '2026-10-20T03:05:00.000Z',
  solarWh: 1840,
  demands: [
    { apartmentId: 'apt-a', demandWh: 210 },
    { apartmentId: 'apt-b', demandWh: 90 },
  ],
};

describe('payloadHash', () => {
  it('is 64 lowercase hex characters', () => {
    expect(payloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores demand order and the ISO spelling of the same instant', () => {
    const same = {
      ...base,
      intervalStart: '2026-10-20T13:05:00+10:00',
      demands: [...base.demands].reverse(),
    };
    expect(payloadHash(same)).toBe(payloadHash(base));
  });

  it.each([
    ['deviceId', { ...base, deviceId: 'other' }],
    ['intervalStart', { ...base, intervalStart: '2026-10-20T03:10:00Z' }],
    ['solarWh', { ...base, solarWh: 1841 }],
    [
      'a demand',
      {
        ...base,
        demands: [{ ...base.demands[0], demandWh: 211 }, base.demands[1]],
      },
    ],
  ])('changes when %s changes', (_field, changed) => {
    expect(payloadHash(changed)).not.toBe(payloadHash(base));
  });

  it('does not mutate the demands array', () => {
    const demands = [...base.demands].reverse();
    payloadHash({ ...base, demands });
    expect(demands[0].apartmentId).toBe('apt-b');
  });
});
