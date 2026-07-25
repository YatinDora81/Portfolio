import { ImageResponse } from 'next/og';
import { SITE_NAME } from './lib/site';

export const alt = `${SITE_NAME} — Software Developer`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #171717 100%)',
          color: '#fafafa',
        }}
      >
        <div style={{ display: 'flex', fontSize: 40, color: '#a3a3a3', marginBottom: 16 }}>
          yatindora.in
        </div>
        <div style={{ display: 'flex', fontSize: 88, fontWeight: 700, lineHeight: 1.1 }}>
          {SITE_NAME}
        </div>
        <div style={{ display: 'flex', fontSize: 44, color: '#18CCFC', marginTop: 24 }}>
          Software Developer
        </div>
      </div>
    ),
    { ...size }
  );
}
