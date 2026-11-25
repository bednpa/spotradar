import * as cheerio from 'cheerio';

/** Name and value of every named hidden input of the page's form (ViewState etc.). */
export function readHiddenFields(html: string): URLSearchParams {
  const $ = cheerio.load(html);
  const fields = new URLSearchParams();
  $('form input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) fields.set(name, $(el).attr('value') ?? '');
  });
  return fields;
}

/** Minimal cookie jar for one scripted ASP.NET session (name -> value, no expiry handling). */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Stores the `name=value` part of every Set-Cookie header of a response. */
  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /** Value of the Cookie request header, or undefined while the jar is empty. */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}
