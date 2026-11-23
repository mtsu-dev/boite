import { expect, test } from 'bun:test';
import { desktopFeedTag } from './desktop-feed.ts';

test('a channel feed advances only to a published version with its manifest', () => {
  const release = { tag_name: 'v2.0.0-nightly.20261120.10', draft: false, assets: [{ name: 'latest.json' }] };
  expect(desktopFeedTag('nightly', release, 'v2.0.0-nightly.20261120.9')).toBe(release.tag_name);
  expect(desktopFeedTag('nightly', release, 'v2.0.0-nightly.20261121.1')).toBeNull();
  expect(desktopFeedTag('nightly', release, release.tag_name)).toBeNull();
  expect(() => desktopFeedTag('stable', release)).toThrow('stable');
  expect(() => desktopFeedTag('nightly', { ...release, draft: true })).toThrow('published');
  expect(() => desktopFeedTag('nightly', { ...release, assets: [] })).toThrow('latest.json');
});
