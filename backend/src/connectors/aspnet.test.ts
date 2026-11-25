import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CookieJar, readHiddenFields } from './aspnet.ts';

describe('readHiddenFields', () => {
  it('collects named hidden inputs of the form and ignores everything else', () => {
    const fields = readHiddenFields(`
      <form action="./"><input type="hidden" name="__VIEWSTATE" value="abc=" />
      <input type="hidden" name="empty" /><input type="hidden" value="no name" />
      <input type="text" name="visible" value="x" /><input type="submit" name="go" value="Go" />
      </form><input type="hidden" name="outside" value="1" />`);
    assert.deepEqual(
      [...fields],
      [
        ['__VIEWSTATE', 'abc='],
        ['empty', ''],
      ],
    );
  });
});

describe('CookieJar', () => {
  it('is empty at first, keeps name=value of Set-Cookie headers and overwrites by name', () => {
    const jar = new CookieJar();
    assert.equal(jar.header(), undefined);
    const first = new Response('', {
      headers: [
        ['set-cookie', 'ASP.NET_SessionId=abc; path=/; HttpOnly'],
        ['set-cookie', 'lang=cs; path=/'],
      ],
    });
    jar.store(first);
    assert.equal(jar.header(), 'ASP.NET_SessionId=abc; lang=cs');
    jar.store(new Response('', { headers: [['set-cookie', 'lang=en; path=/']] }));
    assert.equal(jar.header(), 'ASP.NET_SessionId=abc; lang=en');
    jar.store(new Response(''));
    assert.equal(jar.header(), 'ASP.NET_SessionId=abc; lang=en');
  });
});
