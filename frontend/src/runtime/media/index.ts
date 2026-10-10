import { map, unmap } from '../core/context';

export function installMedia() {
  if (typeof MediaMetadata === 'undefined') return;
  const NativeMetadata = MediaMetadata;
  const descriptor = Object.getOwnPropertyDescriptor(NativeMetadata.prototype, 'artwork');
  if (!descriptor?.get || !descriptor.set) return;
  const getArtwork = descriptor.get, setArtwork = descriptor.set;
  const authored = new WeakMap<MediaMetadata, readonly MediaImage[]>();
  const routeArtwork = (metadata: MediaMetadata, images: readonly MediaImage[]) => {
    const logical = Object.freeze(images.map(image => Object.freeze({ ...image, src: unmap(image.src) })));
    // Artwork is loaded by the media session, outside DOM resource setters.
    setArtwork.call(metadata, logical.map(image => ({ ...image, src: map(image.src) })));
    authored.set(metadata, logical);
  };
  Object.defineProperty(NativeMetadata.prototype, 'artwork', { ...descriptor,
    get() {
      const actual = getArtwork.call(this); // Keep the native receiver validation.
      return authored.get(this) ?? actual;
    },
    set(value) {
      getArtwork.call(this);
      // Let a detached native object validate and convert the iterable exactly
      // once, before updating an active session with mapped resource URLs.
      const validated = new NativeMetadata({ artwork: value });
      routeArtwork(this, getArtwork.call(validated));
    }
  });
  const VirtualMetadata = new Proxy(NativeMetadata, {
    construct(target, args, newTarget) {
      const metadata = Reflect.construct(target, args, newTarget);
      routeArtwork(metadata, getArtwork.call(metadata));
      return metadata;
    }
  });
  globalThis.MediaMetadata = VirtualMetadata;
  const constructor = Object.getOwnPropertyDescriptor(NativeMetadata.prototype, 'constructor');
  if (constructor?.configurable) Object.defineProperty(NativeMetadata.prototype, 'constructor', { ...constructor, value: VirtualMetadata });
}
