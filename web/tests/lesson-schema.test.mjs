import { describe, expect, it } from 'vitest';
import { lessonSchema } from '../lib/schemas.js';

describe('lessonSchema', () => {
  it('accepts a valid lesson payload and defaults published to true', () => {
    const parsed = lessonSchema.parse({
      title: 'Volume 1',
      contentType: 'pdf',
      url: 'https://example.com/v1.pdf',
      position: 10
    });
    expect(parsed.published).toBe(true);
    expect(parsed.title).toBe('Volume 1');
  });

  it('rejects an invalid contentType', () => {
    expect(() =>
      lessonSchema.parse({ title: 'x', contentType: 'audio', url: 'https://x.com', position: 1 })
    ).toThrow();
  });

  it('rejects an invalid url', () => {
    expect(() =>
      lessonSchema.parse({ title: 'x', contentType: 'pdf', url: 'not-a-url', position: 1 })
    ).toThrow();
  });

  it('rejects a javascript: URL', () => {
    expect(() =>
      lessonSchema.parse({ title: 'x', contentType: 'pdf', url: 'javascript:alert(1)', position: 1 })
    ).toThrow();
  });

  it('accepts a valid https URL', () => {
    const parsed = lessonSchema.parse({
      title: 'x',
      contentType: 'pdf',
      url: 'https://example.com/file.pdf',
      position: 1
    });
    expect(parsed.url).toBe('https://example.com/file.pdf');
  });

  it('coerces position to a number', () => {
    const parsed = lessonSchema.parse({
      title: 'x',
      contentType: 'pdf',
      url: 'https://x.com',
      position: '20'
    });
    expect(parsed.position).toBe(20);
  });
});
