// The bridge picks which request templates to use from the platform's currentHost data.
// A wrong pick sends every call to the wrong host, so these cases are worth pinning down.
await import('../app/scripts/bridge.js');
const { normalizeHost, pickProduct } = globalThis.FSX.bridge;

describe('normalizeHost', () => {
  test('strips protocol, path and case', () => {
    expect(normalizeHost('HTTPS://Acme.MyFreshworks.com/crm/sales?x=1')).toBe('acme.myfreshworks.com');
    expect(normalizeHost(' acme.freshsales.io ')).toBe('acme.freshsales.io');
    expect(normalizeHost(undefined)).toBe('');
  });
});

describe('pickProduct', () => {
  test('Freshworks CRM account uses the crm templates', () => {
    expect(pickProduct({ freshworks_crm: 'https://acme.myfreshworks.com' }))
      .toEqual({ product: 'freshworks_crm', host: 'acme.myfreshworks.com' });
  });

  test('classic freshsales.io account uses the classic templates, even when both keys are listed', () => {
    const urls = { freshsales: 'https://acme.freshsales.io', freshworks_crm: 'https://acme.freshsales.io' };
    expect(pickProduct(urls)).toEqual({ product: 'freshsales', host: 'acme.freshsales.io' });
  });

  test('no Freshsales product means nothing to export', () => {
    expect(pickProduct({ freshdesk: 'https://acme.freshdesk.com' })).toBeNull();
    expect(pickProduct(undefined)).toBeNull();
  });
});
