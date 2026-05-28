'use client';

import { useEffect } from 'react';
import Clarity from '@microsoft/clarity';

export default function ClarityAnalytics() {
  useEffect(() => {
    const isProd = process.env.NODE_ENV === 'production';
    const clarityEnabled = process.env.NEXT_PUBLIC_ENABLE_CLARITY === 'true';
    const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
    if (!isProd || !clarityEnabled || !projectId) return;
    Clarity.init(projectId);
  }, []);

  return null;
}
