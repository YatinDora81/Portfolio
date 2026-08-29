'use client';

import * as React from 'react';

interface VTProps {
  name: string;
  children: React.ReactNode;
}

const exportsMap = React as unknown as Record<string, unknown>;
const Impl = (exportsMap.ViewTransition ?? exportsMap.unstable_ViewTransition) as
  | React.ComponentType<VTProps>
  | undefined;

export default function VT({ name, children }: VTProps) {
  if (!Impl) return <>{children}</>;
  return <Impl name={name}>{children}</Impl>;
}
