/** Mock the layout media query, with the same change notification as resizing a browser. */
export function mockPhoneViewport(narrow = false) {
  const original = window.matchMedia;
  const layout = Object.assign(new EventTarget(), {
    media: '(max-width: 720px)', matches: narrow, onchange: null, addListener() {}, removeListener() {}
  });
  window.matchMedia = (media) => media === layout.media ? layout : original(media);
  return {
    resize(phone: boolean) {
      layout.matches = phone;
      layout.dispatchEvent(new Event('change'));
    },
    restore() { window.matchMedia = original; }
  };
}

/** A phone-width window until the returned function puts it back. */
export function phoneWidth(): () => void {
  return mockPhoneViewport(true).restore;
}
