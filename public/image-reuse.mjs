// Only nodes in the currently displayed message can be reused. This is DOM
// presentation state, not a message cache; removed official items disappear.
export function imageReuse(previous) {
  const images = [...(previous?.querySelectorAll('.message-image, .remote-message-image') ?? [])];
  return {
    take(key, accepts = () => true) {
      const index = images.findIndex(image => image.imageIdentity === key && accepts(image));
      return index < 0 ? null : images.splice(index, 1)[0];
    },
  };
}

// Rendering can move nodes through a detached staging tree in one JS turn.
// Release only images that are still detached when the mutation is delivered.
export function releaseDetachedImages(root) {
  new MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) {
      const images = [node, ...(node.querySelectorAll?.('.message-image') ?? [])];
      for (const image of images) if (!image.isConnected) image.releaseImage?.();
    }
  }).observe(root, { childList: true, subtree: true });
}
