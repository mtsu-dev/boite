import { CHAT_PREVIEW_IMAGES, decodedBytes, imageSize, projectLivePart, type Message, type MessagePart } from '@boite/contracts';

export type PreviewSource = string | { chars: number; read: () => string | null };
export type AttachmentPreviewLookup = (messageId: string, index: number, source: PreviewSource) => string | null;
export interface AttachmentPreviewOptions {
  compactFiles?: boolean;
  compactImages?: boolean;
  attachmentPreviews?: AttachmentPreviewLookup;
}

export type AttachmentPart = Extract<MessagePart, { type: 'file' | 'image' }>;
type Metadata = { bytes: number; width?: number; height?: number };

export const isAttachment = (part: MessagePart | null): part is AttachmentPart => part?.type === 'file' || part?.type === 'image';

export function attachmentMetadata(data: string): Metadata {
  return { bytes: decodedBytes(data), ...imageSize(data) };
}

/** The proof covers the original fields and keeps the byte digest apart from thumbnail metadata. */
export const attachmentProofs = new WeakMap<object, AttachmentPart>();
export const previewDigests = new WeakMap<object, string>();

export function compactAttachment(part: AttachmentPart, id: string, role: Message['role'], index: number, options: AttachmentPreviewOptions,
  stored?: { metadata: Metadata; digest: string; source: PreviewSource }): AttachmentPart {
  // Moved attachments already exceed the inline character threshold. With
  // empty data the contract makes the same decision and we supply its metadata.
  const lookup = options.attachmentPreviews;
  const projected = projectLivePart(part, options, role, id, index, lookup && ((_id, _index, data) => lookup(id, index, stored?.source ?? data))) as AttachmentPart;
  if (projected === part) return part;
  if (stored) {
    const { bytes, ...size } = stored.metadata;
    Object.assign(projected, { bytes }, part.type === 'image' || CHAT_PREVIEW_IMAGES.test(part.mimeType) ? size : {});
  }
  attachmentProofs.set(projected, { ...part, data: '' });
  previewDigests.set(projected, stored?.digest ?? Bun.hash(part.data).toString(36));
  return projected;
}
