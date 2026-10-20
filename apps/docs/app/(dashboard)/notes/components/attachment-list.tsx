import { cdnUrl } from "@/lib/utils";
import type { VaultAttachment } from "@/lib/notes/view-types";

const isImage = (mimeType: string) => mimeType.startsWith("image/");

const sizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const kindLabel = (mimeType: string): string => {
  if (mimeType === "application/pdf") return "PDF";
  if (isImage(mimeType)) return mimeType.slice(6).toUpperCase();
  if (mimeType === "text/markdown") return "MD";
  if (mimeType === "text/plain") return "TXT";
  return "FILE";
};

export function AttachmentList({ items }: { items: VaultAttachment[] }) {
  if (!items.length) return null;

  const images = items.filter((a) => isImage(a.mimeType));
  const files = items.filter((a) => !isImage(a.mimeType));

  return (
    <section className="nt-att" aria-label="Attachments">
      <div className="nt-att-lb">
        {items.length} {items.length === 1 ? "attachment" : "attachments"}
      </div>

      {images.length ? (
        <div className="nt-att-grid">
          {images.map((a) => (
            <figure className="nt-att-fig" key={a.id}>
              <a href={cdnUrl(a.url)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={a.altText || a.caption || a.filename}
                  height={a.height ?? undefined}
                  loading="lazy"
                  src={cdnUrl(a.url)}
                  width={a.width ?? undefined}
                />
              </a>
              {a.caption ? <figcaption>{a.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}

      {files.length ? (
        <ul className="nt-att-files">
          {files.map((a) => (
            <li key={a.id}>
              <a className="nt-att-file" href={cdnUrl(a.url)} target="_blank" rel="noreferrer">
                <span className="nt-att-kind">{kindLabel(a.mimeType)}</span>
                <span className="nt-att-name">{a.caption || a.filename}</span>
                <span className="nt-att-size">{sizeLabel(a.bytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
