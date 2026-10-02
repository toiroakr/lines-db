import { describe, it, expect } from 'vitest';
import { renderPage } from './page.js';

describe('studio page', () => {
  it('embeds a script that parses as JavaScript, as escapes inside the template literal are easy to break', () => {
    const script = renderPage('nonce').split('<script nonce="nonce">')[1].split('</script>')[0];

    expect(() => new Function(script)).not.toThrow();
  });
});
