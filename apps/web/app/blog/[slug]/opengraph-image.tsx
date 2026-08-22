import { ImageResponse } from 'next/og';
import { getBlogBySlug } from '@/lib/data';
import { SITE_NAME } from '@/lib/site';

export const alt = 'Blog post';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function BlogOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const blog = await getBlogBySlug(slug);
  const title = blog?.title ?? 'Blog';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #171717 100%)',
          color: '#fafafa',
        }}
      >
        <div style={{ display: 'flex', fontSize: 36, color: '#18CCFC' }}>{SITE_NAME}</div>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, lineHeight: 1.15 }}>
          {title}
        </div>
        <div style={{ display: 'flex', fontSize: 32, color: '#a3a3a3' }}>
          yatindora.in/blog
        </div>
      </div>
    ),
    { ...size }
  );
}
